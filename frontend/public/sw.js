// Only public shell assets are cached. Never cache authenticated APIs or signed file URLs.
const CACHE = "kuku-static-v7";
const PRECACHE = ["/", "/manifest.json", "/pwa-192.png", "/pwa-512.png", "/register-sw.js"];
// Persist only the notification account ID, never credentials or private message content.
function accountStore(mode, action) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("kuku-notification-account", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("account");
    request.onerror = () => reject(new Error("Account storage unavailable"));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("account", mode);
      const operation = action(tx.objectStore("account"));
      tx.oncomplete = () => {const value = operation.result; db.close(); resolve(value);};
      tx.onerror = () => {db.close(); reject(new Error("Account storage unavailable"));};
    };
  });
}
self.addEventListener("message", event => {
  if(event.data?.type !== "KUKU_ACCOUNT") return;
  const uid = event.data.userId;
  if(uid !== null && (typeof uid !== "string" || !/^[a-f0-9-]{36}$/.test(uid)))return;
  event.waitUntil(accountStore("readwrite", store => store.put(uid, "userId")).then(async () => {
    for(const notification of await self.registration.getNotifications()) notification.close();
    event.ports[0]?.postMessage({ok: true});
  }));
});
self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let data; try {data = event.data.json();} catch {return;}
    const uid = await accountStore("readonly", store => store.get("userId"));
    if(!uid || uid !== data.userId || !/^[a-f0-9-]{36}$/.test(data.chatId) || !/^[a-f0-9-]{36}$/.test(data.messageId))return;
    const windows = await self.clients.matchAll({type: "window", includeUncontrolled: true});
    const foreground = windows.some(client => client.visibilityState === "visible");
    await self.registration.showNotification("KUKU", {
      body: "You have a new message.", icon: "/pwa-192.png", badge: "/pwa-192.png",
      tag: data.messageId, silent: foreground, data: {chatId: data.chatId, userId: uid},
    });
  })());
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const data = event.notification.data;
    const uid = await accountStore("readonly", store => store.get("userId"));
    if(!uid || uid !== data?.userId || !/^[a-f0-9-]{36}$/.test(data.chatId))return;
    const path = "/chat/" + data.chatId;
    for(const client of await self.clients.matchAll({type: "window", includeUncontrolled: true})) {
      if(new URL(client.url).origin === self.location.origin) {await client.navigate(path); await client.focus(); return;}
    }
    await self.clients.openWindow(path);
  })());
});
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
