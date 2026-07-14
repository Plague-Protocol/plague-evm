const CACHE_NAME = 'z-plague-v2'

const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/z-plague-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/images/bg-home.webp',
  '/images/bg-game.webp',
  '/images/bg-lobby.webp',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Network-first for API/socket; cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET, cross-origin, and socket.io requests
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/socket.io')
  ) {
    return
  }

  // Cache-first for images and fonts
  if (
    request.destination === 'image' ||
    request.destination === 'font' ||
    url.pathname.startsWith('/images/') ||
    url.pathname.startsWith('/fonts/')
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) => cached || fetch(request).then((res) => {
          // Only cache complete 200s — cache.put() throws on 206 Partial
          // Content (range requests, e.g. audio), and errors aren't worth keeping.
          if (res.status === 200) {
            const clone = res.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          }
          return res
        })
      )
    )
    return
  }

  // Network-first for pages, API routes, JS chunks
  event.respondWith(
    fetch(request)
      .then((res) => {
        // res.ok is true for 206 too, but the Cache API rejects partial
        // responses ("Failed to execute 'put' on 'Cache'") — require full 200.
        if (res.status === 200) {
          const clone = res.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        }
        return res
      })
      // On a genuine network failure (e.g. a transient RPC/API blip taking the
      // backend unreachable), fall back to cache. caches.match resolves to
      // `undefined` on a miss, and respondWith(undefined) throws
      // "Failed to convert value to 'Response'" — which previously broke the
      // whole /game navigation. Always resolve to a real Response: the cached
      // copy if we have one, otherwise a network-error Response the browser can
      // handle gracefully (and a reload recovers once the network returns).
      .catch(async () => (await caches.match(request)) || Response.error())
  )
})
