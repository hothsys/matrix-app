// Matrix — Service Worker for offline support
const CACHE_VERSION = 'matrix-v15';
const APP_CACHE = `${CACHE_VERSION}-app`;
const TILE_CACHE = `${CACHE_VERSION}-tiles`;

// App shell files to pre-cache on install
const APP_SHELL = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/utils.js',
  '/js/state.js',
  '/js/map.js',
  '/js/pins.js',
  '/js/photos.js',
  '/js/albums.js',
  '/js/modals.js',
  '/js/search.js',
  '/js/media.js',
  '/js/data.js',
  '/vendor/maplibre-gl.js',
  '/vendor/maplibre-gl.css',
  '/vendor/supercluster.min.js',
  '/vendor/exif.js',
  '/vendor/fonts.css',
];

// Tile URL patterns to cache (raster + vector tiles, sprites, glyphs)
const TILE_PATTERNS = [
  /tiles\.openfreemap\.org\/planet\//,  // vector tiles only (not style JSON)
  /server\.arcgisonline\.com/,
  /\.pbf(\?|$)/,     // vector tile protobuf files
  /sprites?\//,       // map sprites
  /glyphs?\//,        // map font glyphs
];

// Max cached tiles (LRU eviction when exceeded)
const MAX_TILES = 10000;

// Local server port for disk-cached tile proxy
let serverPort = 8765;

console.log(`SW: ${CACHE_VERSION} loaded`);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => {
      return cache.addAll(APP_SHELL).catch((err) => {
        // Don't fail install if some files aren't available yet
        console.warn('SW: Some app shell files not cached:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'set-port') serverPort = event.data.port;
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        // Keep current app + tile caches, and preserve tile caches from older
        // versions (tiles are map data — still valid across app updates)
        keys.filter((k) => k !== APP_CACHE && k !== TILE_CACHE && !k.endsWith('-tiles')).map((k) => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

function isTileRequest(url) {
  return TILE_PATTERNS.some((p) => p.test(url));
}

function isLocalApi(url) {
  return new URL(url).pathname.startsWith('/api/');
}

function isNominatim(url) {
  return url.includes('nominatim.openstreetmap.org');
}

function isFontFile(url) {
  return url.includes('/vendor/fonts/') || url.includes('fonts.gstatic.com');
}

// Network-first for app shell, cache-first for tiles
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;

  // Only handle http(s) requests — ignore chrome-extension://, etc.
  if (!url.startsWith('http')) return;

  // Don't intercept local API calls or POST/DELETE requests
  if (isLocalApi(url) || request.method !== 'GET') {
    return;
  }

  // Don't cache Nominatim — it's transient geocoding data
  if (isNominatim(url)) {
    return;
  }

  // Map tiles: cache-first (tiles don't change often)
  if (isTileRequest(url)) {
    event.respondWith(tileStrategy(request));
    return;
  }

  // Font files: cache-first
  if (isFontFile(url)) {
    event.respondWith(cacheFirst(request, APP_CACHE));
    return;
  }

  // Everything else (app shell): network-first with cache fallback
  event.respondWith(networkFirst(request, APP_CACHE));
});

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    throw err;
  }
}

const TRANSPARENT_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII='), c => c.charCodeAt(0));

async function tileStrategy(request) {
  // L1: browser Cache API (instant) — ignoreVary prevents misses from header differences
  const cached = await caches.match(request, { ignoreVary: true });
  if (cached) return cached;

  const cacheAndReturn = async (body, ct) => {
    const cacheResp = new Response(body, { status: 200, headers: { 'Content-Type': ct } });
    const cache = await caches.open(TILE_CACHE);
    cache.put(request, cacheResp.clone());
    evictOldTiles(cache);
    return cacheResp;
  };

  // Online: skip disk proxy, fetch directly from origin (fast, no Python overhead)
  // Offline: try disk cache first, then fail gracefully
  if (navigator.onLine) {
    try {
      const oc = new AbortController();
      const ot = setTimeout(() => oc.abort(), 8000);
      const resp = await fetch(request, { signal: oc.signal });
      clearTimeout(ot);
      if (!resp.ok) throw new Error('origin error');
      const body = await resp.arrayBuffer();
      const ct = resp.headers.get('Content-Type') || 'application/octet-stream';
      // Save to disk cache in background (fire-and-forget) for offline use
      const cacheUrl = `http://localhost:${serverPort}/api/tiles/cache?url=${encodeURIComponent(request.url)}`;
      fetch(cacheUrl, { method: 'POST', body: body.slice(0) }).catch(() => {});
      return cacheAndReturn(body, ct);
    } catch {
      // Origin failed while online — try disk as fallback
    }
  }

  // Offline or origin failed: try disk cache (L2)
  try {
    const proxyUrl = `http://localhost:${serverPort}/api/tiles/proxy?url=${encodeURIComponent(request.url)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    const resp = await fetch(proxyUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (resp.ok) {
      const body = await resp.arrayBuffer();
      const ct = resp.headers.get('Content-Type') || 'application/octet-stream';
      return cacheAndReturn(body, ct);
    }
  } catch {}

  return new Response(TRANSPARENT_PNG, {
    status: 200,
    headers: { 'Content-Type': 'image/png' }
  });
}

function zoomFromUrl(url) {
  // Tile URLs contain /{z}/{x}/{y} — extract z from the path
  const m = url.match(/\/(\d+)\/\d+\/\d+(?:\.pbf)?(?:\?|$)/);
  return m ? parseInt(m[1], 10) : 99;
}

async function evictOldTiles(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_TILES) return;
  // Protect low-zoom tiles (z ≤ 8) — they cover the most area
  const protectedKeys = [];
  const evictableKeys = [];
  keys.forEach((k) => {
    if (zoomFromUrl(k.url) <= 8) protectedKeys.push(k);
    else evictableKeys.push(k);
  });
  let excess = keys.length - MAX_TILES;
  // Evict high-zoom tiles first (oldest first)
  const toDelete = evictableKeys.slice(0, Math.min(excess, evictableKeys.length));
  excess -= toDelete.length;
  // If still over limit, evict protected tiles too
  if (excess > 0) toDelete.push(...protectedKeys.slice(0, excess));
  await Promise.all(toDelete.map((k) => cache.delete(k)));
}
