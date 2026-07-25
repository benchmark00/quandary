// ============================================================================
//  sound.js — tasteful, tiny UI sound effects
//  Every sound is synthesized in code (Web Audio oscillators) — no audio
//  files to host or load. Each clip is well under 300ms and designed to be
//  pleasant at low volume, not arcade-game loud.
//
//  Respects a per-device "sound effects" preference (localStorage), same
//  pattern as theme.js. iOS Safari's hardware silent switch does not reliably
//  mute Web Audio, so this in-app toggle is the dependable mute control.
// ============================================================================
const KEY = "quandary-sound";

export function getSoundPref() {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}
export function setSoundPref(on) {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* noop */ }
}

let ctx = null;
function getCtx() {
  if (!getSoundPref()) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  } catch { return null; }
}

// Call once on any early user gesture (e.g. first tap) so the AudioContext is
// unlocked before the first real sound needs to play — browsers block audio
// until a user interaction has occurred.
export function unlockAudio() { getCtx(); }

// A single soft tone: a sine wave with a quick attack and gentle decay.
function tone(ac, { freq, start, dur, gain = 0.09, type = "sine" }) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime + start);
  g.gain.setValueAtTime(0, ac.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, ac.currentTime + start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(ac.currentTime + start);
  osc.stop(ac.currentTime + start + dur + 0.02);
}

// Pull-to-refresh: a quick soft upward whoosh (two rising tones, airy).
export function playRefresh() {
  const ac = getCtx(); if (!ac) return;
  tone(ac, { freq: 480, start: 0, dur: 0.12, gain: 0.05, type: "sine" });
  tone(ac, { freq: 720, start: 0.05, dur: 0.14, gain: 0.06, type: "sine" });
}

// Posting a question or an answer: a satisfying little two-note "confirmed"
// chime, rising — the same shape people associate with "sent successfully."
export function playPost() {
  const ac = getCtx(); if (!ac) return;
  tone(ac, { freq: 523.25, start: 0, dur: 0.11, gain: 0.08, type: "sine" });   // C5
  tone(ac, { freq: 783.99, start: 0.07, dur: 0.16, gain: 0.09, type: "sine" }); // G5
}

// Reacting to a reply: a tiny, light tick/pop — fires often, so it stays the
// shortest and quietest of the three by design.
export function playReact() {
  const ac = getCtx(); if (!ac) return;
  tone(ac, { freq: 900, start: 0, dur: 0.06, gain: 0.06, type: "triangle" });
}
