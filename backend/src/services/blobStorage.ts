/**
 * services/blobStorage.ts
 *
 * Provider-abstraction for screenshot storage.
 * Same pattern as visionClient.ts — switch via STORAGE_PROVIDER=local|s3.
 *
 * Local provider (default):
 *   - Writes to ./uploads/<filename>
 *   - URL: ${BASE_URL}/uploads/<filename>  (served by Express static middleware)
 *   - Zero cloud credentials needed — any reviewer can run with docker compose up
 *
 * S3 provider (optional):
 *   - Uploads to AWS S3 with PutObjectCommand
 *   - Returns a 1-hour pre-signed GetObject URL
 *   - Enabled by setting STORAGE_PROVIDER=s3 and AWS_* env vars
 *
 * Tradeoff (worth mentioning in the write-up):
 *   We store a key + URL reference in Postgres, never the raw image bytes.
 *   Storing images in Postgres as bytea/JSONB bloats the DB, kills replication
 *   performance, and makes backup retention painful. S3/local disk + a DB
 *   reference is the standard production pattern.
 */
import fs from 'fs/promises';
import path from 'path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config';
import { logger } from './logger';

// ── Shared result type ─────────────────────────────────────────────────────────

export interface StoredBlob {
  key: string; // stable identifier (S3 key or local filename)
  url: string; // accessible URL (presigned or static)
}

// ── Local disk provider ────────────────────────────────────────────────────────

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

async function localSave(buffer: Buffer, filename: string): Promise<StoredBlob> {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const key = filename;
  await fs.writeFile(path.join(UPLOADS_DIR, key), buffer);
  const url = `${config.baseUrl}/uploads/${key}`;
  logger.debug(`[storage:local] Saved ${key} (${buffer.length} bytes)`);
  return { key, url };
}

async function localGetBuffer(key: string): Promise<Buffer> {
  return fs.readFile(path.join(UPLOADS_DIR, key));
}

// ── S3 provider ────────────────────────────────────────────────────────────────

function buildS3Client(): S3Client {
  return new S3Client({
    region: config.awsRegion ?? 'us-east-1',
    credentials:
      config.awsAccessKeyId && config.awsSecretAccessKey
        ? {
            accessKeyId:     config.awsAccessKeyId,
            secretAccessKey: config.awsSecretAccessKey,
          }
        : undefined, // fall back to instance profile / env creds
  });
}

async function s3Save(buffer: Buffer, filename: string): Promise<StoredBlob> {
  if (!config.s3Bucket) throw new Error('S3_BUCKET env var is not set');

  const s3  = buildS3Client();
  const key = `screenshots/${filename}`;

  await s3.send(
    new PutObjectCommand({
      Bucket:      config.s3Bucket,
      Key:         key,
      Body:        buffer,
      ContentType: 'image/jpeg',
    }),
  );

  // Presigned URL valid for 1 hour (vision API call will happen within seconds)
  const presignedUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }),
    { expiresIn: 3600 },
  );

  logger.debug(`[storage:s3] Uploaded ${key}`);
  return { key, url: presignedUrl };
}

async function s3GetBuffer(key: string): Promise<Buffer> {
  if (!config.s3Bucket) throw new Error('S3_BUCKET env var is not set');

  const s3       = buildS3Client();
  const response = await s3.send(
    new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }),
  );

  if (!response.Body) throw new Error(`S3 object ${key} has no body`);

  // Convert readable stream to Buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// ── Provider map ───────────────────────────────────────────────────────────────

interface StorageProvider {
  save(buffer: Buffer, filename: string): Promise<StoredBlob>;
  getBuffer(key: string): Promise<Buffer>;
}

const PROVIDERS: Record<string, StorageProvider> = {
  local: { save: localSave, getBuffer: localGetBuffer },
  s3:    { save: s3Save,    getBuffer: s3GetBuffer    },
};

function getProvider(): StorageProvider {
  const name     = config.storageProvider;
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(
      `Unknown STORAGE_PROVIDER="${name}". Valid values: ${Object.keys(PROVIDERS).join(' | ')}`,
    );
  }
  return provider;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function saveScreenshot(
  buffer: Buffer,
  filename: string,
): Promise<StoredBlob> {
  return getProvider().save(buffer, filename);
}

export async function getScreenshotBuffer(key: string): Promise<Buffer> {
  return getProvider().getBuffer(key);
}
