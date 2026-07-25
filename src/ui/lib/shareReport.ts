// Share a clinician-output report's text (Stage 23, FR-23.8). Uses the device
// share sheet where available, else a `mailto:` draft. Nothing leaves the device
// except by this user-initiated action; a cancelled share sheet is a no-op and
// never falls back to email mid-gesture.

export async function shareReport(title: string, text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text });
    } catch {
      // User dismissed or the platform refused — do not fall back mid-gesture.
    }
    return;
  }
  const href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`;
  window.location.href = href;
}
