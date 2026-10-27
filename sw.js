// Offline cache: network first (so updates show up), cache as the fallback.
// A slow or stuck network must never hold the app on the launch screen: if the network hasn't
// answered within NET_WAIT and a cached copy exists, the cached copy is used (the fetch still
// finishes in the background and refreshes the cache for next time).
const CACHE = 'sightwords-v4';
const NET_WAIT = 3000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

// Voice clips and art (assets/) are served from the cache straight away, so a tapped word plays
// at once instead of waiting on the network; the cached copy is refreshed in the background.
// Audio asks for byte ranges, so the cache always stores (and serves) the whole file.
// Each file is refreshed at most once per worker start, not on every play.
const refreshed = new Set();
function assetFirst(e, url) {
  const refresh = () => fetch(new Request(url, { cache: 'no-cache' })).then(res => {
    if (res.status === 200) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(url, copy)); }
    return res;
  });
  e.respondWith(caches.match(url).then(hit => {
    if (!hit) return refresh();
    if (!refreshed.has(url)) { refreshed.add(url); e.waitUntil(refresh().catch(() => {})); }
    return hit;
  }));
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  const url = new URL(e.request.url);
  if (url.pathname.includes('/assets/')) { url.search = ''; assetFirst(e, url.href); return; }
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
