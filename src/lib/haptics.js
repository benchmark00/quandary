// ============================================================================
//  haptics.js — real device vibration on Android, silent no-op on iOS
//
//  The Vibration API (navigator.vibrate) is supported on Android Chrome and
//  most Android browsers, including installed PWAs. iOS Safari has never
//  implemented it — on iPhone this is a hard platform restriction, not a bug
//  or a missing polyfill. Calling navigator.vibrate() where it's unsupported
//  is safe (it's simply undefined / a no-op), so every call below just does
//  nothing on iOS rather than erroring.
// ============================================================================
const KEY = "quandary-haptics";

export function hapticsSupported() {
  try { return typeof navigator !== "undefined" && "vibrate" in navigator; } catch { return false; }
}

export function getHapticsPref() {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}
export function setHapticsPref(on) {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* noop */ }
}

function buzz(pattern) {
  if (!getHapticsPref() || !hapticsSupported()) return;
  try { navigator.vibrate(pattern); } catch { /* noop */ }
}

// Pull-to-refresh: two short pulses — a light "got it, reloading" tap.
export function hapticRefresh() { buzz([12, 40, 12]); }

// Posting a question or an answer: one slightly longer, satisfying pulse.
export function hapticPost() { buzz(22); }

// Reacting to a reply: the shortest of the three — fires often, stays subtle.
export function hapticReact() { buzz(10); }
