/**
 * content.ts — DOM-level signal collector
 *
 * Injected into every page (run_at: document_idle).
 * Tracks:
 *   - scroll depth (max %, reset each reporting interval)
 *   - click count (reset each interval)
 *   - focus/blur state
 *
 * Reports a DOMSignal bundle to the background SW every 10 seconds.
 * The background merges this into the next capture event.
 *
 * Note: This runs in the renderer process, not the service worker.
 * chrome.runtime.sendMessage is the only channel available here.
 */

interface DOMSignalPayload {
  scrollDepthPercent: number;
  clickCount: number;
  isFocused: boolean;
  timestamp: number;
}

// ── State ─────────────────────────────────────────────────────────────────────

let clickCount = 0;
let maxScrollDepth = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentScrollDepth(): number {
  const scrolled = window.scrollY;
  const total = document.documentElement.scrollHeight - window.innerHeight;
  if (total <= 0) return 100;
  return Math.round(Math.min(100, (scrolled / total) * 100));
}

// ── Event listeners ───────────────────────────────────────────────────────────

document.addEventListener(
  'scroll',
  () => {
    const depth = currentScrollDepth();
    if (depth > maxScrollDepth) maxScrollDepth = depth;
  },
  { passive: true },
);

document.addEventListener('click', () => { clickCount++; }, { passive: true });

// ── Reporting loop ────────────────────────────────────────────────────────────

const REPORT_INTERVAL_MS = 10_000; // 10 seconds

setInterval(() => {
  const payload: DOMSignalPayload = {
    scrollDepthPercent: maxScrollDepth,
    clickCount,
    isFocused: document.hasFocus(),
    timestamp: Date.now(),
  };

  // Send to background SW — ignore errors (SW may be dormant)
  chrome.runtime
    .sendMessage({ type: 'DOM_SIGNAL', payload })
    .catch(() => {
      // Silent — background SW wakes up on the next alarm
    });

  // Reset per-interval counters (keep maxScrollDepth at current position)
  clickCount = 0;
  maxScrollDepth = currentScrollDepth();
}, REPORT_INTERVAL_MS);
