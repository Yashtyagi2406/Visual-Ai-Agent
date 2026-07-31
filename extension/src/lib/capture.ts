/**
 * capture.ts — chrome.tabs.captureVisibleTab wrapper
 *
 * Returns a base64 JPEG data URL, or null on failure.
 * Common failure cases handled:
 *   - chrome:// / about: pages (not capturable by design)
 *   - No focused window
 *   - Extension page itself
 */
export async function captureActiveTab(): Promise<string | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.windowId) return null;

    // Skip pages the API cannot capture
    const url = tab.url ?? '';
    if (
      url.startsWith('chrome://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('about:') ||
      url.startsWith('edge://') ||
      url === ''
    ) {
      return null;
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 72, // Good visual quality, ~50–100 KB for a typical page
    });

    return dataUrl;
  } catch (err) {
    // This is expected when the window is not focused or has no active tab
    console.warn('[NeoFlo] captureVisibleTab skipped:', (err as Error).message);
    return null;
  }
}
