const CACHE_PREFIX = "turtleneck-ai-web-";
const CACHE_NAME = `${CACHE_PREFIX}v078`;
const APP_PAGES = ["./", "./index.html", "./index-22.html"]
  .map(path => new URL(path, self.registration.scope).href);
const ASSETS = [
  ...APP_PAGES,
  "./styles.css?v=0.7.8",
  "./app.js?v=0.7.8",
  "./camera-device.js?v=0.7.1",
  "./camera-background.js?v=0.7.8",
  "./focus-timer.js?v=0.7.0",
  "./mini-window.js?v=0.7.8",
  "./mini-window.css?v=0.7.8",
  "./manifest.webmanifest",
  "./backgrounds/meeting-room.jpg",
  "./backgrounds/cafe.jpg"
].map(path => new URL(path, self.registration.scope).href);

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS.map(url => new Request(url, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || !ASSETS.includes(event.request.url)) return;
  event.respondWith(caches.match(event.request, { cacheName: CACHE_NAME })
    .then(cached => cached || fetch(event.request)));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const app = windows.find(client => {
      const url = new URL(client.url);
      url.search = "";
      url.hash = "";
      return APP_PAGES.includes(url.href);
    });
    if (app) await app.focus();
    else await self.clients.openWindow(self.registration.scope);
  })());
});
