/**
 * routes/events.ts
 *
 * POST /api/events  (authenticated, multipart/form-data)
 *   Fields:
 *     screenshot — JPEG image file
 *     metadata   — JSON string: { tabUrl, tabTitle, capturedAt, domSignals? }
 *   Returns: { eventId, status: "queued" }
 *
 * GET /api/events/recent?limit=N  (authenticated)
 *   Returns the last N labeled events for this user (default: 20)
 */
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { prisma } from '../db/client';
import { saveScreenshot } from '../services/blobStorage';
import { enqueueVisionJob } from '../queue/producer';
import { logger } from '../services/logger';

const router = Router();

// ── Multer: in-memory storage (we pipe the buffer to blobStorage ourselves) ──
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB cap
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are accepted'));
  },
});

// ── Validation ─────────────────────────────────────────────────────────────────

const metadataSchema = z.object({
  tabUrl:     z.string().url(),
  tabTitle:   z.string().max(500),
  capturedAt: z.string().datetime(),
  domSignals: z
    .object({
      scrollDepthPercent: z.number(),
      clickCount:         z.number(),
      isFocused:          z.boolean(),
      timestamp:          z.number(),
    })
    .nullable()
    .optional(),
});

// ── POST /api/events ───────────────────────────────────────────────────────────

router.post(
  '/',
  requireAuth,
  upload.single('screenshot'),
  async (req, res) => {
    // Parse metadata
    let metadata: z.infer<typeof metadataSchema>;
    try {
      const raw = JSON.parse((req.body as Record<string, string>)['metadata'] ?? '{}');
      metadata = metadataSchema.parse(raw);
    } catch (err) {
      res.status(400).json({ error: 'Invalid metadata', details: String(err) });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'screenshot field is required' });
      return;
    }

    const userId = req.userId!;

    try {
      // 1. Upload screenshot to blob storage (local or S3)
      const filename = `${userId}-${Date.now()}.jpg`;
      const { key, url } = await saveScreenshot(req.file.buffer, filename);

      // 2. Create Event record (status: PENDING)
      const event = await prisma.event.create({
        data: {
          userId,
          tabUrl:       metadata.tabUrl,
          tabTitle:     metadata.tabTitle,
          screenshotKey: key,
          screenshotUrl: url,
          domSignals:   metadata.domSignals ?? undefined,
          capturedAt:   new Date(metadata.capturedAt),
          status:       'PENDING',
        },
        select: { id: true },
      });

      // 3. Push job onto Bull queue — worker will call vision API asynchronously
      await enqueueVisionJob({ eventId: event.id });

      logger.info(`[events] Queued eventId=${event.id} for userId=${userId}`);
      res.status(202).json({ eventId: event.id, status: 'queued' });
    } catch (err) {
      logger.error('[events] POST /api/events failed', { error: String(err) });
      res.status(500).json({ error: 'Failed to process event' });
    }
  },
);

// ── GET /api/events/recent ─────────────────────────────────────────────────────

router.get('/recent', requireAuth, async (req, res) => {
  const userId = req.userId!;
  const limit = Math.min(Number(req.query['limit'] ?? 20), 50);

  try {
    const events = await prisma.event.findMany({
      where: { userId, status: 'LABELED' },
      orderBy: { capturedAt: 'desc' },
      take: limit,
      select: {
        id:           true,
        tabUrl:       true,
        tabTitle:     true,
        screenshotUrl: true,
        aiActivity:   true,
        aiApp:        true,
        aiConfidence: true,
        capturedAt:   true,
        labeledAt:    true,
        domSignals:   true,
      },
    });

    res.json({ events });
  } catch (err) {
    logger.error('[events] GET /api/events/recent failed', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

export default router;
