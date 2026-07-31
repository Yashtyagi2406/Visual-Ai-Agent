import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import { logger } from './services/logger';
import { prisma } from './db/client';
import authRouter from './routes/auth';
import eventsRouter from './routes/events';

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({ origin: '*' })); // Extension can run from any origin
app.use(express.json());

// Serve local screenshots (only used when STORAGE_PROVIDER=local)
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/api/auth', authRouter);
app.use('/api/events', eventsRouter);

// Health check — useful for docker compose dependency checks
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── Error handler ─────────────────────────────────────────────────────────────

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    logger.error('Unhandled error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
  },
);

// ── Start ─────────────────────────────────────────────────────────────────────

const server = app.listen(config.port, () => {
  logger.info(`🚀  NeoFlo API listening on port ${config.port}`);
  logger.info(`   Vision provider:  ${config.visionProvider}`);
  logger.info(`   Storage provider: ${config.storageProvider}`);
});

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down…');
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

export default app;
