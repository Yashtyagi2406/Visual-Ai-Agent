/// <reference types="vite/client" />
/**
 * api.ts — Backend communication layer
 *
 * Handles:
 *  - Self-registration (POST /api/auth/register, idempotent)
 *  - Posting capture events (multipart POST /api/events)
 *  - Fetching recent AI-labeled events for popup display
 *  - Offline fallback: queues events in chrome.storage if backend is unreachable
 */
import type { CaptureEvent, AILabel } from '../types';
import {
  getApiToken,
  setApiToken,
  getInstallId,
  enqueuePending,
} from './storage';

// Injected at build time via Vite's import.meta.env
const BACKEND_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'http://localhost:3000';

// ── Auth ──────────────────────────────────────────────────────────────────────

/**
 * Registers this extension install with the backend if not already registered.
 * Idempotent — safe to call on every service worker startup.
 * Returns the JWT token, or null if registration fails.
 */
export async function ensureRegistered(): Promise<string | null> {
  const existing = await getApiToken();
  if (existing) return existing;

  try {
    const installId = await getInstallId();
    const res = await fetch(`${BACKEND_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installId }),
    });

    if (!res.ok) throw new Error(`Registration returned ${res.status}`);

    const data = (await res.json()) as { token: string };
    await setApiToken(data.token);
    return data.token;
  } catch (err) {
    console.error('[NeoFlo] Registration failed:', err);
    return null;
  }
}

// ── Events ────────────────────────────────────────────────────────────────────

/**
 * POSTs a capture event to the backend as multipart/form-data.
 * On failure, saves the event to the offline queue for later retry.
 */
export async function postEvent(event: CaptureEvent): Promise<void> {
  const token = await ensureRegistered();

  if (!token) {
    // Can't authenticate — queue for later
    await enqueuePending({
      tabUrl: event.tabUrl,
      tabTitle: event.tabTitle,
      screenshotDataUrl: event.screenshotDataUrl,
      capturedAt: event.capturedAt,
    });
    return;
  }

  try {
    // Convert base64 data URL → binary Blob for multipart upload
    const [header, base64Data] = event.screenshotDataUrl.split(',');
    const mimeType = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
    const byteString = atob(base64Data);
    const bytes = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      bytes[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType });

    const form = new FormData();
    form.append('screenshot', blob, `capture-${Date.now()}.jpg`);
    form.append(
      'metadata',
      JSON.stringify({
        tabUrl: event.tabUrl,
        tabTitle: event.tabTitle,
        capturedAt: event.capturedAt,
        domSignals: event.domSignals,
      }),
    );

    const res = await fetch(`${BACKEND_URL}/api/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    if (!res.ok) throw new Error(`POST /api/events → ${res.status}`);
  } catch (err) {
    console.error('[NeoFlo] postEvent failed, queuing offline:', err);
    await enqueuePending({
      tabUrl: event.tabUrl,
      tabTitle: event.tabTitle,
      screenshotDataUrl: event.screenshotDataUrl,
      capturedAt: event.capturedAt,
    });
  }
}

// ── Recent labels (for popup display) ────────────────────────────────────────

/**
 * Returns the most recent AI-labeled event for this install, or null.
 */
export async function fetchLatestLabel(): Promise<AILabel | null> {
  const token = await getApiToken();
  if (!token) return null;

  try {
    const res = await fetch(`${BACKEND_URL}/api/events/recent?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      events: Array<{ aiActivity: string; aiApp: string; aiConfidence: number }>;
    };

    const first = data.events?.[0];
    if (!first?.aiActivity) return null;

    return {
      activity: first.aiActivity,
      app: first.aiApp,
      confidence: first.aiConfidence,
    };
  } catch {
    return null;
  }
}
