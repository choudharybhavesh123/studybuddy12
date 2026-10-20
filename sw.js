// Caches the page shell so the app opens fast. AI answers always go to the network.
const CACHE = "studybuddy-v1";
const SHELL = ["/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))));
self.addEventListener("activate", (e) =>
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))))
);
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.pathname.startsWith("/api/")) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
