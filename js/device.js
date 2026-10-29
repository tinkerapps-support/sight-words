// Full screen, portrait lock and keep-screen-on (PLAN.md §7).
// Chrome only enters full screen from a tap, and leaves it on Back / edge swipe / app switch.

export function isFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

// iPhone Safari has no page full screen at all (iPad has the webkit-prefixed one); there, the home
// screen icon is the way to get it.
export function fullscreenSupported() {
  const el = document.documentElement;
  return Boolean(el.requestFullscreen || el.webkitRequestFullscreen);
}

// Running from the home screen icon (manifest display: fullscreen) needs none of this.
export function isInstalled() {
  return matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true;
}

export async function enterFullscreen() {
  if (isFullscreen() || !fullscreenSupported()) return isFullscreen();
  try {
    const el = document.documentElement;
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else el.webkitRequestFullscreen();
    // Only allowed while full screen; harmless if it fails.
    await screen.orientation?.lock?.('portrait').catch(() => {});
  } catch { /* not from a tap, or refused */ }
  return isFullscreen();
}

export async function exitFullscreen() {
  try { screen.orientation?.unlock?.(); } catch { /* ignore */ }
  if (!isFullscreen()) return;
  if (document.exitFullscreen) await document.exitFullscreen().catch(() => {});
  else document.webkitExitFullscreen?.();
}

export function onFullscreenChange(fn) {
  document.addEventListener('fullscreenchange', fn);
  document.addEventListener('webkitfullscreenchange', fn);
}

// ---- Wake lock (secure contexts only: https or localhost, not a LAN http address) ----

let lock = null;
let wanted = false;

export function wakeLockSupported() {
  return 'wakeLock' in navigator && window.isSecureContext;
}

export async function keepAwake(on) {
  wanted = on;
  if (!on) { await lock?.release().catch(() => {}); lock = null; return; }
  if (!wakeLockSupported() || lock) return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
  } catch { lock = null; }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wanted) keepAwake(true);
});
