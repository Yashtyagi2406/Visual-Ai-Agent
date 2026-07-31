/**
 * services/visionClient.ts
 *
 * Provider-abstraction layer for multimodal AI classification.
 *
 * Design (echoes the AI-GCM pattern):
 *   A single public function — classifyScreenshot() — delegates to whichever
 *   provider is configured via VISION_PROVIDER=openai|anthropic.
 *   Adding a new provider means adding one function + one entry in PROVIDERS.
 *   The worker, queue, and routes never import OpenAI/Anthropic directly.
 *
 * Providers:
 *   openai    → GPT-4o  (default; cheaper + faster than gpt-4-vision-preview)
 *   anthropic → Claude 3.5 Sonnet (claude-3-5-sonnet-20241022)
 *
 * Both providers receive the image as a base64 string in the API request body,
 * not as a URL — this avoids the "localhost URL unreachable from cloud API" problem.
 */
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../config';
import { logger } from './logger';

// ── Shared types ───────────────────────────────────────────────────────────────

export interface AILabel {
  activity: string;   // e.g. "reading documentation"
  app: string;        // e.g. "GitHub"
  confidence: number; // 0.0 – 1.0
}

export interface EventMetadata {
  tabUrl: string;
  tabTitle: string;
  capturedAt: string; // ISO 8601
}

// Zod schema used by both providers to validate the JSON response
const aiLabelSchema = z.object({
  activity:   z.string().max(120),
  app:        z.string().max(80),
  confidence: z.number().min(0).max(1),
});

// ── Prompt ─────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  `You are a browser-activity classifier for a productivity monitor. ` +
  `Analyse the screenshot and return a single JSON object with exactly three keys:\n` +
  `  "activity"   — concise description of what the user is doing ` +
  `(e.g. "reading documentation", "writing code", "watching a video", "browsing social media")\n` +
  `  "app"        — the primary website or app visible (e.g. "GitHub", "YouTube", "Google Docs")\n` +
  `  "confidence" — your confidence from 0.0 to 1.0\n` +
  `Return ONLY the JSON object. No markdown fences, no explanation.`;

function userPrompt(meta: EventMetadata): string {
  return `URL: ${meta.tabUrl}\nTitle: ${meta.tabTitle}\nCaptured: ${meta.capturedAt}`;
}

// ── OpenAI provider ────────────────────────────────────────────────────────────

async function classifyWithOpenAI(
  imageBuffer: Buffer,
  meta: EventMetadata,
): Promise<AILabel> {
  if (!config.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is not set. Add it to .env or set VISION_PROVIDER=anthropic');
  }

  const client = new OpenAI({ apiKey: config.openaiApiKey });
  const base64  = imageBuffer.toString('base64');
  const dataUrl = `data:image/jpeg;base64,${base64}`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
          { type: 'text',      text: userPrompt(meta) },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens:  200,
    temperature: 0.1,
  });

  const raw = response.choices[0]?.message?.content ?? '{}';
  return aiLabelSchema.parse(JSON.parse(raw));
}

// ── Anthropic provider ─────────────────────────────────────────────────────────

async function classifyWithAnthropic(
  imageBuffer: Buffer,
  meta: EventMetadata,
): Promise<AILabel> {
  if (!config.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to .env or set VISION_PROVIDER=openai');
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const base64  = imageBuffer.toString('base64');

  const response = await client.messages.create({
    model:      'claude-3-5-sonnet-20241022',
    max_tokens: 200,
    system:     SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type:   'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
          },
          { type: 'text', text: userPrompt(meta) },
        ],
      },
    ],
  });

  const raw =
    response.content[0]?.type === 'text' ? response.content[0].text : '{}';
  return aiLabelSchema.parse(JSON.parse(raw));
}

// ── Provider map ───────────────────────────────────────────────────────────────

type ProviderFn = (buf: Buffer, meta: EventMetadata) => Promise<AILabel>;

const PROVIDERS: Record<string, ProviderFn> = {
  openai:    classifyWithOpenAI,
  anthropic: classifyWithAnthropic,
};

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Classify a screenshot using the configured vision provider.
 * Switch providers by setting VISION_PROVIDER=openai|anthropic in .env.
 */
export async function classifyScreenshot(
  imageBuffer: Buffer,
  meta: EventMetadata,
): Promise<AILabel> {
  const providerName = config.visionProvider;
  const provider     = PROVIDERS[providerName];

  if (!provider) {
    throw new Error(
      `Unknown VISION_PROVIDER="${providerName}". Valid values: ${Object.keys(PROVIDERS).join(' | ')}`,
    );
  }

  logger.info(`[vision] Classifying via ${providerName}`, {
    url:        meta.tabUrl,
    bufferSize: `${(imageBuffer.length / 1024).toFixed(1)} KB`,
  });

  const label = await provider(imageBuffer, meta);

  logger.info(
    `[vision] Result: "${label.activity}" (${label.app}) confidence=${label.confidence}`,
  );

  return label;
}
