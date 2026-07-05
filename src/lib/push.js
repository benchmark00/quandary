// ============================================================================
//  push.js — registers the service worker and manages the Web Push subscription.
//  Tie enablePush() to the onboarding "I've added it" step / an Alerts toggle.
//
//  iOS reality check: Web Push only works once the user has added Quandary to
//  their Home Screen (iOS 16.4+). In a normal Safari tab it silently no-ops, so
//  gate the prompt behind `isStandalone()` on iOS.
// ============================================================================
import { supabase } from "./supabase";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export const pushSupported = () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

export async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/sw.js");
}

export async function enablePush() {
  if (!pushSupported()) throw new Error("Push isn't supported on this device/browser.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications were not allowed.");

  const reg = await navigator.serviceWorker.ready;

  // If this device already holds a subscription (possibly registered under a
  // different account previously), discard it and mint a fresh one. A fresh
  // endpoint can't collide with any other account's row.
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    try { await supabase.from("push_subscriptions").delete().eq("endpoint", existing.endpoint); } catch { /* not ours — fine */ }
    try { await existing.unsubscribe(); } catch { /* already gone — fine */ }
  }

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  const json = sub.toJSON();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("You're not signed in.");
  const { error } = await supabase.from("push_subscriptions").upsert({
    user_id: user.id,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    user_agent: navigator.userAgent,
  }, { onConflict: "endpoint" });
  if (error) throw error;

  return sub;
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}

// VAPID public key (base64url) -> Uint8Array, as the Push API expects.
function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
