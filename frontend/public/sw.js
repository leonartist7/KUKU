// Only public shell assets are cached. Never cache authenticated APIs or signed file URLs.
const CACHE = "kuku-static-v4";
const PRECACHE = ["/", "/manifest.json", "/pwa-192.png", "/pwa-512.png", "/register-sw.js"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("connect-") || (key.startsWith("kuku-") && key !== CACHE)).map((key) => caches.delete(key)),
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.search || request.headers.has("Authorization")) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname === "/api") return;
  const isAsset = PRECACHE.includes(url.pathname) || url.pathname.startsWith("/_expo/static/");
  if (!isAsset && request.mode !== "navigate") return;
  event.respondWith(fetch(request).then((response) => {
    if (isAsset && response.ok && !/no-store|private/.test(response.headers.get("Cache-Control") || "")) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then((c) => c.put(request, copy)));
    }
    return response;
  }).catch(async () => (await caches.match(request.mode === "navigate" ? "/" : request)) || Response.error()));
});
