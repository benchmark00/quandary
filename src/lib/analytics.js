// ============================================================================
//  analytics.js — PostHog wrapper.
//  Every function is a safe no-op until VITE_POSTHOG_KEY is set, so the app
//  runs identically before/without analytics configured.
// ============================================================================
import posthog from "posthog-js";

const KEY = import.meta.env.VITE_POSTHOG_KEY;
const HOST = import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";

export const analyticsEnabled = !!KEY;

export function initAnalytics() {
  if (!KEY) return;
  posthog.init(KEY, {
    api_host: HOST,
    capture_pageview: true,     // sessions + time-on-app come from this
    autocapture: true,          // generic clicks; custom events cover the rest
    persistence: "localStorage",
  });
}

// Tie events to a real account (called on login and after profile load).
export function identifyUser(id, props) {
  if (KEY) posthog.identify(id, props);
}

// Custom events: track("question_posted", { flair: "wyr" })
export function track(event, props) {
  if (KEY) posthog.capture(event, props);
}

// On sign-out, detach the identity so a shared device doesn't mix people.
export function resetAnalytics() {
  if (KEY) posthog.reset();
}
