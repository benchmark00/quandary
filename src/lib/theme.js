// ============================================================================
//  theme.js — night mode
//  Preference is one of "system" | "light" | "dark", stored in localStorage.
//  applyTheme() sets data-theme="light"|"dark" on <html>, which every CSS
//  override in App.jsx / Root.jsx keys off. initTheme() must run BEFORE the
//  app renders (see main.jsx) so there's no flash of the wrong theme.
// ============================================================================
const KEY = "quandary-theme";

export function getThemePref() {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch { return "system"; }
}

export function resolveTheme(pref) {
  if (pref === "dark" || pref === "light") return pref;
  try {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  } catch { /* noop */ }
  return "light";
}

export function applyTheme(pref) {
  const resolved = resolveTheme(pref);
  document.documentElement.setAttribute("data-theme", resolved);
  return resolved;
}

export function setThemePref(pref) {
  try { localStorage.setItem(KEY, pref); } catch { /* noop */ }
  return applyTheme(pref);
}

// Call once, as early as possible (before React renders).
export function initTheme() {
  applyTheme(getThemePref());
  try {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if (getThemePref() === "system") applyTheme("system"); };
    mq.addEventListener ? mq.addEventListener("change", onChange) : mq.addListener(onChange);
  } catch { /* noop */ }
}
