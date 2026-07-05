import React from "react";
import { createRoot } from "react-dom/client";
import Root from "./Root.jsx";

createRoot(document.getElementById("root")).render(<Root />);

// Register the service worker (enables Add to Home Screen + push later).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
