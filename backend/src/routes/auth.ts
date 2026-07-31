/**
 * routes/auth.ts
 *
 * POST /api/auth/register
 *   Body: { installId: string }
 *   Returns: { token: string, userId: string }
 *
 * Idempotent — calling this with the same installId always returns the same
 * userId and a fresh JWT. The extension calls this on every service worker
 * startup and only stores the result if it doesn't already have a token.
 */
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../db/client';
import { config } from '../config';
import { logger } from '../services/logger';

const router = Router();

const registerSchema = z.object({
  installId: z.string().uuid('installId must be a UUID'),
});

router.post('/register', async (req, res) => {
  const parse = registerSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const { installId } = parse.data;

  try {
    // upsert — creates on first call, returns existing record on subsequent calls
    const user = await prisma.user.upsert({
      where: { installId },
      create: { installId },
      update: {},
      select: { id: true, installId: true, createdAt: true },
    });

    const token = jwt.sign({ userId: user.id }, config.jwtSecret, {
      expiresIn: '365d',
    });

    logger.info(`[auth] Registered installId=${installId} → userId=${user.id}`);
    res.json({ token, userId: user.id });
  } catch (err) {
    logger.error('[auth] Register failed', { error: String(err) });
    res.status(500).json({ error: 'Registration failed' });
  }
});

export default router;
