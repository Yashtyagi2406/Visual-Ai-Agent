/**
 * storage.ts — chrome.storage.local wrappers
 *
 * All extension state is persisted here so it survives
 * service worker restarts (MV3 SWs can be killed at any time).
 */
import type { TrackingState, AILabel, SessionStats } from '../types';

// Stable keys — never rename these without a migration
const KEYS = {
  TRACKING_STATE: 'tracking_state',
  API_TOKEN: 'api_token',
  INSTALL_ID: 'install_id',
  PENDING_QUEUE: 'pending_queue',
  LATEST_LABEL: 'latest_label',
  SESSION_STATS: 'session_stats',
} as const;

// ── Tracking state ────────────────────────────────────────────────────────────

export async function getTrackingState(): Promise<TrackingState> {
  const result = await chrome.storage.local.get(KEYS.TRACKING_STATE);
  return (
    result[KEYS.TRACKING_STATE] ?? {
      enabled: false,
      consentGiven: false,
      pauseUntilNavigation: false,
    }
  );
}

export async function setTrackingState(patch: Partial<TrackingState>): Promise<void> {
  const current = await getTrackingState();
  await chrome.storage.local.set({
    [KEYS.TRACKING_STATE]: { ...current, ...patch },
  });
}

// ── Auth token (JWT from backend) ─────────────────────────────────────────────

export async function getApiToken(): Promise<string | null> {
  const result = await chrome.storage.local.get(KEYS.API_TOKEN);
  return result[KEYS.API_TOKEN] ?? null;
}

export async function setApiToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [KEYS.API_TOKEN]: token });
}

// ── Install ID (stable identifier, generated once per browser profile) ─────────

export async function getInstallId(): Promise<string> {
  const result = await chrome.storage.local.get(KEYS.INSTALL_ID);
  if (result[KEYS.INSTALL_ID]) return result[KEYS.INSTALL_ID] as string;

  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [KEYS.INSTALL_ID]: id });
  return id;
}

// ── Latest AI label (shown in popup) ─────────────────────────────────────────

export async function getLatestLabel(): Promise<AILabel | null> {
  const result = await chrome.storage.local.get(KEYS.LATEST_LABEL);
  return result[KEYS.LATEST_LABEL] ?? null;
}

export async function setLatestLabel(label: AILabel): Promise<void> {
  await chrome.storage.local.set({ [KEYS.LATEST_LABEL]: label });
}

// ── Offline queue (events captured while backend was unreachable) ─────────────

export interface PendingEvent {
  tabUrl: string;
  tabTitle: string;
  screenshotDataUrl: string;
  capturedAt: string;
}

export async function getPendingQueue(): Promise<PendingEvent[]> {
  const result = await chrome.storage.local.get(KEYS.PENDING_QUEUE);
  return result[KEYS.PENDING_QUEUE] ?? [];
}

export async function enqueuePending(event: PendingEvent): Promise<void> {
  const queue = await getPendingQueue();
  // Cap at 20 items — chrome.storage.local has a 10 MB quota
  const trimmed = [...queue, event].slice(-20);
  await chrome.storage.local.set({ [KEYS.PENDING_QUEUE]: trimmed });
}

export async function flushPendingQueue(): Promise<PendingEvent[]> {
  const queue = await getPendingQueue();
  if (queue.length === 0) return [];
  await chrome.storage.local.set({ [KEYS.PENDING_QUEUE]: [] });
  return queue;
}

// ── Session stats (displayed in popup) ───────────────────────────────────────

export async function getSessionStats(): Promise<SessionStats> {
  const result = await chrome.storage.local.get(KEYS.SESSION_STATS);
  return result[KEYS.SESSION_STATS] ?? { eventsToday: 0, activeMinutesToday: 0 };
}

export async function incrementEventCount(): Promise<void> {
  const stats = await getSessionStats();
  await chrome.storage.local.set({
    [KEYS.SESSION_STATS]: {
      eventsToday: stats.eventsToday + 1,
      // Each capture alarm fires every ~12 seconds = 0.2 minutes
      activeMinutesToday: Math.round((stats.activeMinutesToday + 0.2) * 10) / 10,
    },
  });
}
