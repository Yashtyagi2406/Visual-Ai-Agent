/**
 * queue/worker.ts
 *
 * BullMQ Worker — consumes vision classification jobs.
 * Run as a separate process: npm run worker
 * (or as the "worker" docker-compose service)
 *
 * Per-job flow:
 *   1. Load Event record from Postgres (get screenshotKey)
 *   2. Fetch screenshot buffer from blob storage (local or S3)
 *   3. Call classifyScreenshot() — delegated to the active vision provider
 *   4. Update Event: aiActivity, aiApp, aiConfidence, status=LABELED
 *   5. On failure: mark status=FAILED, store errorMessage, BullMQ retries up to 3×
 */
import { Worker, Job } from 'bullmq';
import { prisma } from '../db/client';
import { redisConnection, VISION_QUEUE_NAME, VisionJobData } from './producer';
import { classifyScreenshot } from '../services/visionClient';
import { getScreenshotBuffer } from '../services/blobStorage';
import { logger } from '../services/logger';
import { config } from '../config';

async function processVisionJob(job: Job<VisionJobData>): Promise<void> {
  const { eventId } = job.data;
  logger.info(`[worker] Processing job ${job.id} — eventId=${eventId}`);

  // 1. Load event
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id:            true,
      screenshotKey: true,
      tabUrl:        true,
      tabTitle:      true,
      capturedAt:    true,
      status:        true,
    },
  });

  if (!event) {
    throw new Error(`Event ${eventId} not found in DB`);
  }

  if (event.status === 'LABELED') {
    logger.info(`[worker] eventId=${eventId} already labeled — skipping`);
    return;
  }

  if (!event.screenshotKey) {
    throw new Error(`Event ${eventId} has no screenshotKey`);
  }

  // 2. Fetch screenshot buffer from storage
  const imageBuffer = await getScreenshotBuffer(event.screenshotKey);

  // 3. Classify via the configured vision provider
  const label = await classifyScreenshot(imageBuffer, {
    tabUrl:     event.tabUrl,
    tabTitle:   event.tabTitle,
    capturedAt: event.capturedAt.toISOString(),
  });

  // 4. Write label back to DB
  await prisma.event.update({
    where: { id: eventId },
    data: {
      aiActivity:   label.activity,
      aiApp:        label.app,
      aiConfidence: label.confidence,
      status:       'LABELED',
      labeledAt:    new Date(),
    },
  });

  logger.info(
    `[worker] ✅ eventId=${eventId} → "${label.activity}" (${label.app}) @ ${label.confidence}`,
  );
}

// ── Worker process ─────────────────────────────────────────────────────────────

const worker = new Worker<VisionJobData>(
  VISION_QUEUE_NAME,
  processVisionJob,
  {
    connection: redisConnection,
    concurrency: 2, // process up to 2 screenshots in parallel
  },
);

worker.on('completed', (job) => {
  logger.info(`[worker] Job ${job.id} completed`);
});

worker.on('failed', async (job, err) => {
  logger.error(`[worker] Job ${job?.id} failed (attempt ${job?.attemptsMade})`, {
    error: err.message,
  });

  // On final failure (no more retries), mark event as FAILED in DB
  if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
    await prisma.event
      .update({
        where: { id: job.data.eventId },
        data: {
          status:       'FAILED',
          errorMessage: err.message.slice(0, 500),
        },
      })
      .catch(console.error);
  }
});

worker.on('error', (err) => {
  logger.error('[worker] Worker error', { error: err.message });
});

logger.info(
  `[worker] 🚀 Vision worker started — provider=${config.visionProvider}, concurrency=2`,
);

// Graceful shutdown
async function shutdown() {
  logger.info('[worker] Shutting down…');
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT',  () => void shutdown());
process.on('SIGTERM', () => void shutdown());
