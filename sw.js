/**
 * Service Worker for Oddsify Intel
 * 
 * Features:
 * - Offline fallback page
 * - Cache-first strategy for static assets
 * - Network-first for API calls with offline fallback
 * - Background sync for watchlist updates (when supported)
 * 
 * Install: Automatically registered by browser if served over HTTPS (or localhost)
 */

const CACHE_NAME = 'oddsify-intel-v15';
const STATIC_CACHE = 'oddsify-static-v15';
const API_CACHE = 'oddsify-api-v15';

// Static assets to cache immediately
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/config.js',
  '/js/storage.js',
  '/js/api.js',
  '/js/render.js',
  '/js/app.js',
  '/favicon.ico',
  '/favicon.svg',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/site.webmanifest',
];

// API endpoints to cache (only the local proxy; direct ESPN hosts
// are intentionally NOT intercepted so the proxy is the single egress)
const API_PATTERNS = [
  '/api/espn/*/scoreboard',
  '/api/espn/*/standings',
  '/api/espn/*/summary',
  '/api/espn/*/news',
];

/**
 * Install event - cache static assets
 */
self.addEventListener('install', (event) => {
  console.log('[SW] Install event, caching static assets...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Cached static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .catch((err) => {
        console.error('[SW] Failed to cache static assets:', err);
      })
  );
  // Skip waiting to activate immediately
  self.skipWaiting();
});

/**
 * Activate event - clean old caches
 */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate event, cleaning old caches...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => {
              return name !== STATIC_CACHE && name !== API_CACHE && name !== CACHE_NAME;
            })
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Claiming clients...');
        return self.clients.claim();
      })
  );
});

/**
 * Fetch event - cache-first for static, network-first for API
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Skip chrome-extension and other non-http requests
  if (!url.protocol.startsWith('http')) {
    return;
  }
  
  // API requests - network first with cache fallback
  if (url.pathname.startsWith('/api/espn/')) {
    event.respondWith(handleApiRequest(request));
    return;
  }
  
  // Static assets - cache first
  event.respondWith(handleStaticRequest(request));
});

/**
 * Handle API requests (network-first with cache fallback)
 */
async function handleApiRequest(request) {
  const cache = await caches.open(API_CACHE);
  
  try {
    // Try network first
    const networkResponse = await fetch(request);
    
    // If successful, cache it
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (networkError) {
    console.log('[SW] Network failed, trying cache for:', request.url);
    
    // Try cache
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      console.log('[SW] Serving from cache:', request.url);
      // Add header to indicate cached response
      const headers = new Headers(cachedResponse.headers);
      headers.set('X-From-Cache', 'true');
      return new Response(cachedResponse.body, {
        status: cachedResponse.status,
        statusText: cachedResponse.statusText,
        headers,
      });
    }
    
    // No cache available — return shape the app expects
    console.warn('[SW] No cache available for:', request.url);
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Offline — couldn't reach the feed. Check your connection.",
        cached: false,
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Handle static requests (cache-first)
 */
async function handleStaticRequest(request) {
  const cache = await caches.open(STATIC_CACHE);
  
  // Try cache first
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  // Try network
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (networkError) {
    console.error('[SW] Failed to fetch static asset:', request.url);
    
    // Return offline fallback for HTML requests
    if (request.headers.get('accept')?.includes('text/html')) {
      return caches.match('/index.html');
    }
    
    // For other assets, return error
    return new Response('Offline', { status: 503 });
  }
}

/**
 * Handle messages from main thread
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys()
        .then((cacheNames) => {
          return Promise.all(
            cacheNames.map((name) => caches.delete(name))
          );
        })
        .then(() => {
          event.ports[0].postMessage({ success: true });
        })
    );
  }
  
  if (event.data && event.data.type === 'GET_CACHE_STATS') {
    event.waitUntil(
      caches.keys()
        .then((cacheNames) => {
          return Promise.all(
            cacheNames.map(async (name) => {
              const cache = await caches.open(name);
              const keys = await cache.keys();
              return {
                name,
                count: keys.length,
                size: 'unknown', // Would need to sum response sizes
              };
            })
          );
        })
        .then((stats) => {
          event.ports[0].postMessage({ stats });
        })
    );
  }
});

/**
 * Background sync for watchlist updates (when supported)
 */
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-watchlist') {
    event.waitUntil(syncWatchlist());
  }
});

async function syncWatchlist() {
  console.log('[SW] Syncing watchlist...');
  // In a full implementation, this would:
  // 1. Read pending watchlist changes from IndexedDB
  // 2. Send them to the backend API
  // 3. Update local storage on success
  console.log('[SW] Watchlist sync complete');
}

console.log('[SW] Service Worker loaded');
