// ── Shared types for background ↔ popup ↔ content communication ──────────────

export interface AILabel {
  activity: string; // e.g. "reading documentation"
  app: string; // e.g. "GitHub"
  confidence: number; // 0.0 – 1.0
}

export interface DOMSignal {
  scrollDepthPercent: number; // 0–100
  clickCount: number; // clicks since last report
  isFocused: boolean; // document.hasFocus()
  timestamp: number; // Date.now()
}

export interface CaptureEvent {
  tabUrl: string;
  tabTitle: string;
  screenshotDataUrl: string; // base64 JPEG data URL
  domSignals: DOMSignal | null;
  capturedAt: string; // ISO 8601
}

export interface TrackingState {
  enabled: boolean;
  consentGiven: boolean;
  pauseUntilNavigation: boolean;
}

export interface SessionStats {
  eventsToday: number;
  activeMinutesToday: number;
}

// ── Message protocol (background ↔ popup) ─────────────────────────────────────

export type BackgroundMessage =
  | { type: 'GET_STATE' }
  | { type: 'SET_TRACKING'; enabled: boolean }
  | { type: 'SET_PAUSE_UNTIL_NAV'; paused: boolean }
  | { type: 'DOM_SIGNAL'; payload: DOMSignal };

export type BackgroundResponse =
  | { type: 'STATE'; state: TrackingState }
  | { type: 'OK' };
