import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';
import { logger } from '../services/logger';

export interface VisionJobData {
  eventId: string;
}

// Shared Redis connection (reused by worker in same process, if applicable)
export const redisConnection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
});

redisConnection.on('error', (err) => {
  logger.error('[redis] Connection error', { error: err.message });
});

export const VISION_QUEUE_NAME = 'vision-classification';

const visionQueue = new Queue<VisionJobData>(VISION_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5_000, // 5s → 25s → 125s
    },
    removeOnComplete: { count: 200 }, // keep last 200 completed jobs for inspection
    removeOnFail: { count: 100 },
  },
});

/**
 * Enqueue a vision classification job for the given eventId.
 * The worker will:
 *   1. Load the Event from DB (gets screenshotKey)
 *   2. Read screenshot buffer from storage
 *   3. Call the vision provider
 *   4. Update Event with aiActivity / aiApp / aiConfidence
 */
export async function enqueueVisionJob(data: VisionJobData): Promise<void> {
  const job = await visionQueue.add('classify', data, {
    jobId: `vision-${data.eventId}`, // deduplicate by eventId
  });
  logger.info(`[queue] Enqueued job ${job.id} for eventId=${data.eventId}`);
}

export default visionQueue;
