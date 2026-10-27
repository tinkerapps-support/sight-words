// Offline cache: network first (so updates show up), cache as the fallback.
// A slow or stuck network must never hold the app on the launch screen: if the network hasn't
// answered within NET_WAIT and a cached copy exists, the cached copy is used (the fetch still
// finishes in the background and refreshes the cache for next time).
const CACHE = 'sightwords-v3';
const NET_WAIT = 3000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  const network = fetch(e.request, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  });
  e.waitUntil(network.catch(() => {}));
  e.respondWith(new Promise(resolve => {
    let settled = false;
    const useCache = async () => {
      const hit = await caches.match(e.request, { ignoreSearch: true });
      if (hit && !settled) { settled = true; resolve(hit); }
      return hit;
    };
    const timer = setTimeout(useCache, NET_WAIT);
    network.then(res => { clearTimeout(timer); if (!settled) { settled = true; resolve(res); } })
      .catch(async () => {
        clearTimeout(timer);
        if (!(await useCache()) && !settled) { settled = true; resolve(Response.error()); }
      });
  }));
});
