import React from "react";
import { createRoot } from "react-dom/client";
import Root from "./Root.jsx";

createRoot(document.getElementById("root")).render(<Root />);

// Register the service worker (push + icon badges).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

/* ---- clear the home-screen icon badge whenever the app is opened/seen ---- */
function resetBadgeStore() {
  try {
    const req = indexedDB.open("quandary-badge", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => {
      try {
        const tx = req.result.transaction("kv", "readwrite");
        tx.objectStore("kv").put(0, "count");
      } catch { /* noop */ }
    };
  } catch { /* noop */ }
}
function clearBadge() {
  resetBadgeStore();
  if ("clearAppBadge" in navigator) navigator.clearAppBadge().catch(() => {});
}
clearBadge();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") clearBadge();
});
