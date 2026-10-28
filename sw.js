// WayBack offline helper. Saves the app on the phone so it opens with data off.
// Change VERSION whenever index.html changes so phones pick up the update.
const VERSION = "wayback-2026-10-29d";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function withTimeout(p, ms) {
  return new Promise((ok, fail) => { const t = setTimeout(() => fail(new Error("timeout")), ms); p.then(r => { clearTimeout(t); ok(r); }, err => { clearTimeout(t); fail(err); }); });
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // The app page: try the internet first (to get updates), fall back to the saved copy.
  if (req.mode === "navigate" || (url.origin === location.origin && /\/(index\.html)?$/.test(url.pathname))) {
    e.respondWith(
      withTimeout(fetch(req), 4000)
        .then(res => { const copy = res.clone(); if (res.ok) caches.open(VERSION).then(c => c.put("./index.html", copy)); return res; })
        .catch(() => caches.match("./index.html").then(r => r || caches.match("./")))
    );
    return;
  }

  // Adverts are saved by the app itself; just pass these through.
  if (url.pathname.endsWith("/ads.json")) return;

  // Fonts and the app's own files: use the saved copy, refresh it in the background.
  if (url.origin === location.origin || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(VERSION).then(c => c.match(req).then(hit => {
      const net = fetch(req).then(res => { if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })));
  }
});
