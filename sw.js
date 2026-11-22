// App shell cache. Data is never cached here (it lives in Supabase and, for offline viewing, in localStorage).
const CACHE = "nsd-crm-v2";
const SHELL = ["./", "index.html", "app.css", "app.js", "config.js", "manifest.webmanifest", "icon.svg", "icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // Supabase, fonts, CDN: straight to network
  // network first, fall back to cache (so updates show up as soon as you're online)
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))));
});
