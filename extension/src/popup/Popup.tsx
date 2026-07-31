import { useCallback, useEffect, useState } from 'react';
import type { AILabel, TrackingState, SessionStats } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = 'loading' | 'consent' | 'main';
type StatusMode = 'recording' | 'paused' | 'off';

// ── Helpers ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sendMsg<T = unknown>(msg: Record<string, unknown>): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Inline SVG Icons ──────────────────────────────────────────────────────────

const EyeIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

const BrainIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.16Z" />
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.16Z" />
  </svg>
);

const ActivityIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const PauseIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
);

const ShieldIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const PlayIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

// ── Main Component ────────────────────────────────────────────────────────────

export function Popup() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [trackingState, setTrackingState] = useState<TrackingState>({
    enabled: false,
    consentGiven: false,
    pauseUntilNavigation: false,
  });
  const [latestLabel, setLatestLabel] = useState<AILabel | null>(null);
  const [stats, setStats] = useState<SessionStats>({ eventsToday: 0, activeMinutesToday: 0 });
  const [isToggling, setIsToggling] = useState(false);

  // ── Load state on mount ──────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const [stateRes, storageRes] = await Promise.all([
        sendMsg<{ type: string; state: TrackingState }>({ type: 'GET_STATE' }),
        chrome.storage.local.get(['latest_label', 'session_stats']),
      ]);

      const state: TrackingState = stateRes?.state ?? {
        enabled: false,
        consentGiven: false,
        pauseUntilNavigation: false,
      };

      setTrackingState(state);
      setLatestLabel(storageRes['latest_label'] ?? null);
      setStats(storageRes['session_stats'] ?? { eventsToday: 0, activeMinutesToday: 0 });
      setPhase(state.consentGiven ? 'main' : 'consent');
    }

    load().catch(console.error);
  }, []);

  // ── Consent ──────────────────────────────────────────────────────────────────

  const handleConsentAccept = useCallback(async () => {
    const newState: TrackingState = { enabled: true, consentGiven: true, pauseUntilNavigation: false };
    await sendMsg({ type: 'SET_TRACKING', enabled: true });
    await chrome.storage.local.set({ tracking_state: newState });
    setTrackingState(newState);
    setPhase('main');
  }, []);

  const handleConsentDecline = useCallback(() => {
    window.close();
  }, []);

  // ── Toggle tracking ──────────────────────────────────────────────────────────

  const handleToggle = useCallback(async () => {
    if (isToggling) return;
    setIsToggling(true);
    const newEnabled = !trackingState.enabled;
    try {
      await sendMsg({ type: 'SET_TRACKING', enabled: newEnabled });
      setTrackingState((prev) => ({ ...prev, enabled: newEnabled }));
    } finally {
      setIsToggling(false);
    }
  }, [trackingState.enabled, isToggling]);

  // ── Pause until navigation ────────────────────────────────────────────────────

  const handlePauseUntilNav = useCallback(async () => {
    const next = !trackingState.pauseUntilNavigation;
    await sendMsg({ type: 'SET_PAUSE_UNTIL_NAV', paused: next });
    setTrackingState((prev) => ({ ...prev, pauseUntilNavigation: next }));
  }, [trackingState.pauseUntilNavigation]);

  // ── Derived state ─────────────────────────────────────────────────────────────

  const status: StatusMode = !trackingState.enabled
    ? 'off'
    : trackingState.pauseUntilNavigation
      ? 'paused'
      : 'recording';

  const statusLabel =
    status === 'recording'
      ? 'Recording activity'
      : status === 'paused'
        ? 'Paused until next tab'
        : 'Tracking disabled';

  // ── Render ────────────────────────────────────────────────────────────────────

  if (phase === 'loading') {
    return (
      <div className="popup-root">
        <div className="loading-wrap">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (phase === 'consent') {
    return (
      <div className="popup-root">
        <div className="consent-screen">
          <div className="consent-icon-wrap">
            <ShieldIcon />
          </div>
          <h1 className="consent-title">Before we begin</h1>
          <p className="consent-desc">
            NeoFlo Visual Agent monitors your browser activity by taking periodic screenshots
            and classifying what you&apos;re working on using AI.
          </p>
          <ul className="consent-list">
            <li>📸&nbsp; Screenshots every ~12 seconds</li>
            <li>🤖&nbsp; Classified by GPT-4o into activity labels</li>
            <li>🔒&nbsp; Data stored locally &amp; on your own backend</li>
            <li>⏸&nbsp; Pause or stop tracking at any time</li>
          </ul>
          <div className="consent-actions">
            <button
              id="consent-accept-btn"
              className="btn-primary"
              onClick={handleConsentAccept}
            >
              Allow &amp; Start Tracking
            </button>
            <button
              id="consent-decline-btn"
              className="btn-ghost"
              onClick={handleConsentDecline}
            >
              Decline
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="popup-root">
      {/* Ambient glow */}
      <div className="ambient-glow" aria-hidden="true" />

      {/* ── Header ── */}
      <div className="header">
        <div className="header-left">
          <div className={`status-dot ${status}`} aria-label={`Status: ${status}`} />
          <div>
            <div className="brand">NeoFlo</div>
            <div className="status-label">{statusLabel}</div>
          </div>
        </div>

        <button
          id="tracking-toggle"
          className={`toggle ${trackingState.enabled ? 'on' : 'off'}`}
          onClick={handleToggle}
          disabled={isToggling}
          aria-label={trackingState.enabled ? 'Disable tracking' : 'Enable tracking'}
          aria-pressed={trackingState.enabled}
        >
          <span className="toggle-thumb">
            {trackingState.enabled ? <EyeIcon /> : <EyeOffIcon />}
          </span>
        </button>
      </div>

      {/* ── Current Activity Card ── */}
      <div className="card activity-card">
        <div className="card-eyebrow">
          <BrainIcon />
          Current Activity
        </div>

        {latestLabel ? (
          <>
            <div className="activity-name">{latestLabel.activity}</div>
            <div className="activity-meta">
              <span className="app-pill">{latestLabel.app}</span>
              <div className="confidence-track">
                <div
                  className="confidence-fill"
                  style={{ width: `${latestLabel.confidence * 100}%` }}
                />
              </div>
              <span className="confidence-pct">
                {Math.round(latestLabel.confidence * 100)}%
              </span>
            </div>
          </>
        ) : (
          <div className="activity-empty">
            {trackingState.enabled ? (
              <>
                <div className="pulse-ring" />
                <span>Waiting for first capture…</span>
              </>
            ) : (
              <span>Enable tracking to start classifying activity</span>
            )}
          </div>
        )}
      </div>

      {/* ── Session Stats Card ── */}
      <div className="card stats-card">
        <div className="card-eyebrow">
          <ActivityIcon />
          Today&apos;s Session
        </div>
        <div className="stats-row">
          <div className="stat">
            <span className="stat-value">{stats.eventsToday}</span>
            <span className="stat-sub">captures</span>
          </div>
          <div className="stat-sep" />
          <div className="stat">
            <span className="stat-value">{formatMinutes(stats.activeMinutesToday)}</span>
            <span className="stat-sub">tracked</span>
          </div>
          <div className="stat-sep" />
          <div className="stat">
            <span className={`stat-value status-glyph ${status}`}>
              {status === 'recording' ? '●' : status === 'paused' ? '⏸' : '○'}
            </span>
            <span className="stat-sub">{status}</span>
          </div>
        </div>
      </div>

      {/* ── Controls ── */}
      {trackingState.enabled && (
        <div className="controls-wrap">
          <button
            id="pause-until-nav-btn"
            className={`btn-control ${trackingState.pauseUntilNavigation ? 'active' : ''}`}
            onClick={handlePauseUntilNav}
          >
            {trackingState.pauseUntilNavigation ? <PlayIcon /> : <PauseIcon />}
            {trackingState.pauseUntilNavigation
              ? 'Resume tracking'
              : 'Pause until next tab'}
          </button>
        </div>
      )}

      {/* ── Footer ── */}
      <div className="footer">
        <span>NeoFlo Visual Agent</span>
        <span className="footer-dot" />
        <span>v1.0.0</span>
      </div>
    </div>
  );
}
