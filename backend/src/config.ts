/**
 * config.ts — Typed, validated configuration
 *
 * Uses Zod to parse process.env at startup. If any required var is missing
 * the process exits immediately with a clear error message — no silent misconfigs.
 */
import { z } from 'zod';

const schema = z.object({
  port:    z.coerce.number().int().positive().default(3000),
  baseUrl: z.string().url().default('http://localhost:3000'),

  // Database
  databaseUrl: z.string().min(1, 'DATABASE_URL is required'),

  // Redis / queue
  redisUrl: z.string().default('redis://localhost:6379'),

  // Auth
  jwtSecret: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),

  // Vision provider — switchable via env var (the key design decision)
  visionProvider:   z.enum(['openai', 'anthropic']).default('openai'),
  openaiApiKey:     z.string().optional(),
  anthropicApiKey:  z.string().optional(),

  // Storage provider — switchable via env var
  storageProvider:     z.enum(['local', 's3']).default('local'),
  s3Bucket:            z.string().optional(),
  awsRegion:           z.string().optional(),
  awsAccessKeyId:      z.string().optional(),
  awsSecretAccessKey:  z.string().optional(),

  // Logging
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

const result = schema.safeParse({
  port:                process.env['PORT'],
  baseUrl:             process.env['BASE_URL'],
  databaseUrl:         process.env['DATABASE_URL'],
  redisUrl:            process.env['REDIS_URL'],
  jwtSecret:           process.env['JWT_SECRET'],
  visionProvider:      process.env['VISION_PROVIDER'],
  openaiApiKey:        process.env['OPENAI_API_KEY'],
  anthropicApiKey:     process.env['ANTHROPIC_API_KEY'],
  storageProvider:     process.env['STORAGE_PROVIDER'],
  s3Bucket:            process.env['S3_BUCKET'],
  awsRegion:           process.env['AWS_REGION'],
  awsAccessKeyId:      process.env['AWS_ACCESS_KEY_ID'],
  awsSecretAccessKey:  process.env['AWS_SECRET_ACCESS_KEY'],
  logLevel:            process.env['LOG_LEVEL'],
});

if (!result.success) {
  console.error('❌  Invalid configuration:');
  for (const [field, errors] of Object.entries(result.error.flatten().fieldErrors)) {
    console.error(`   ${field}: ${(errors as string[]).join(', ')}`);
  }
  process.exit(1);
}

export const config = result.data;
