// Bump this version string whenever index.html/styles.css/app.js change.
// The service worker only re-caches the shell when this file's contents
// change, so without a version bump, returning visitors keep getting the
// old cached app.js/styles.css even after a new deploy.
const CACHE_NAME = "da-dashboard-v2";
const SHELL_FILES = [
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// Install: cache the app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch strategy:
// - Shell files: cache-first
// - /api/monday proxy calls: network-first (live data), no offline fallback
//   since they are POST requests and not cacheable in the usual sense
self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return; // let POSTs (the /api/monday proxy) pass straight through
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
