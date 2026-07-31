/**
 * background.ts — MV3 Service Worker
 *
 * Responsibilities:
 *  1. Track the active tab (URL + title) via chrome.tabs events
 *  2. Run a periodic alarm (every ~12 s) to capture a screenshot
 *  3. Aggregate DOM signals sent by content.ts
 *  4. POST events to the backend; fall back to offline queue on failure
 *  5. Drain the offline queue on reconnect
 *  6. Handle messages from the popup (state reads/writes)
 *
 * MV3 note: Service workers are ephemeral — they can be killed at any time
 * and restarted on the next event. This means:
 *   - State MUST be persisted in chrome.storage, not in module-level variables
 *   - chrome.alarms is used instead of setInterval (alarms survive SW restarts)
 *   - initialize() is called on every SW wakeup to re-acquire current tab
 */

import { captureActiveTab } from './lib/capture';
import { postEvent, ensureRegistered, fetchLatestLabel } from './lib/api';
import {
  getTrackingState,
  setTrackingState,
  flushPendingQueue,
  incrementEventCount,
  setLatestLabel,
} from './lib/storage';
import type { DOMSignal, BackgroundMessage } from './types';

// ── Constants ─────────────────────────────────────────────────────────────────

const ALARM_NAME = 'neoflo-capture';

/**
 * 12 seconds expressed in minutes (chrome.alarms unit).
 * Note: Chrome enforces a 1-minute minimum for production extensions,
 * but when loaded unpacked in Developer Mode there is no minimum.
 * See: https://developer.chrome.com/docs/extensions/reference/api/alarms
 */
const CAPTURE_INTERVAL_MINUTES = 12 / 60;

// ── Per-wakeup state (not persisted) ─────────────────────────────────────────
// These are reset every time the service worker restarts, which is why
// we re-acquire currentTabUrl/Title on every initialize() call.

let currentTabUrl = '';
let currentTabTitle = '';
let latestDOMSignal: DOMSignal | null = null;

// ── Initialization ────────────────────────────────────────────────────────────

async function initialize(): Promise<void> {
  // Re-acquire the active tab — may have changed while SW was asleep
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    currentTabUrl = tab.url ?? '';
    currentTabTitle = tab.title ?? '';
  }

  // Ensure the capture alarm is always running (create is no-op if it exists)
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: CAPTURE_INTERVAL_MINUTES });
    console.log(`[NeoFlo] Alarm created — firing every ${CAPTURE_INTERVAL_MINUTES * 60}s`);
  }

  // Register with the backend (idempotent — skips if token already stored)
  await ensureRegistered();

  // Drain any events captured while offline
  await drainOfflineQueue();
}

initialize().catch(console.error);

// ── Tab tracking ──────────────────────────────────────────────────────────────

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    currentTabUrl = tab.url ?? '';
    currentTabTitle = tab.title ?? '';

    // Clear pause-until-navigation when the user switches tabs
    const state = await getTrackingState();
    if (state.pauseUntilNavigation) {
      await setTrackingState({ pauseUntilNavigation: false });
    }
  } catch {
    // Tab may have been closed before we got the event
  }
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  // Only update when the tab that's currently active finishes loading
  if (changeInfo.status === 'complete') {
    currentTabUrl = tab.url ?? currentTabUrl;
    currentTabTitle = tab.title ?? currentTabTitle;
  }
});

// ── Capture alarm ─────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const state = await getTrackingState();

  // Respect all three pause conditions
  if (!state.enabled || !state.consentGiven || state.pauseUntilNavigation) return;

  // Skip internal browser pages — captureVisibleTab will throw on these
  if (
    !currentTabUrl ||
    currentTabUrl.startsWith('chrome://') ||
    currentTabUrl.startsWith('chrome-extension://') ||
    currentTabUrl.startsWith('about:') ||
    currentTabUrl.startsWith('edge://')
  ) {
    return;
  }

  const screenshotDataUrl = await captureActiveTab();
  if (!screenshotDataUrl) return;

  await postEvent({
    tabUrl: currentTabUrl,
    tabTitle: currentTabTitle,
    screenshotDataUrl,
    domSignals: latestDOMSignal,
    capturedAt: new Date().toISOString(),
  });

  latestDOMSignal = null; // reset — each event gets at most one DOM signal bundle
  await incrementEventCount();

  // Refresh the latest AI label for the popup (non-blocking — failure is silent)
  fetchLatestLabel()
    .then((label) => {
      if (label) return setLatestLabel(label);
    })
    .catch(console.warn);
});

// ── Offline queue drain ───────────────────────────────────────────────────────

async function drainOfflineQueue(): Promise<void> {
  const pending = await flushPendingQueue();
  if (pending.length === 0) return;

  console.log(`[NeoFlo] Draining ${pending.length} offline events`);
  for (const item of pending) {
    await postEvent({
      tabUrl: item.tabUrl,
      tabTitle: item.tabTitle,
      screenshotDataUrl: item.screenshotDataUrl,
      domSignals: null,
      capturedAt: item.capturedAt,
    });
  }
}

// Also drain when the network comes back online
self.addEventListener('online', () => {
  drainOfflineQueue().catch(console.error);
});

// ── Message handler (popup + content script) ──────────────────────────────────

chrome.runtime.onMessage.addListener(
  (msg: BackgroundMessage, _sender, sendResponse) => {
    switch (msg.type) {
      case 'DOM_SIGNAL':
        // Merge — keep the latest signal bundle from content.ts
        latestDOMSignal = msg.payload;
        sendResponse({ type: 'OK' });
        return false; // synchronous response

      case 'GET_STATE':
        getTrackingState()
          .then((state) => sendResponse({ type: 'STATE', state }))
          .catch(console.error);
        return true; // async — keep channel open

      case 'SET_TRACKING':
        setTrackingState({ enabled: msg.enabled })
          .then(() => sendResponse({ type: 'OK' }))
          .catch(console.error);
        return true;

      case 'SET_PAUSE_UNTIL_NAV':
        setTrackingState({ pauseUntilNavigation: msg.paused })
          .then(() => sendResponse({ type: 'OK' }))
          .catch(console.error);
        return true;

      default:
        return false;
    }
  },
);

// ── Installation hook ─────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    console.log('[NeoFlo] Extension installed — first-run consent will be shown on popup open');
  }
});
