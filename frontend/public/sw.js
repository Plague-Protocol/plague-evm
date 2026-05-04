/**
 * Service-worker kill-switch.
 *
 * A previous app (or stale install) left a service worker registered on this
 * origin that caches JS chunks. When the Next.js dev server rebuilds, the
 * stale cached chunks no longer match the server's RSC module IDs, causing
 *   TypeError: Cannot read properties of undefined (reading 'call')
 * during webpack module hydration.
 *
 * This worker immediately activates, deletes every cache, and unregisters
 * itself so fresh assets are always fetched from the network.
 */

self.addEventListener('install', () => {
  // Skip the "waiting" phase so this SW activates straight away.
  self.skipWaiting()
})

self.addEventListener('activate', async () => {
  // 1. Clear every cache entry left by the old service worker.
  const cacheNames = await caches.keys()
  await Promise.all(cacheNames.map(name => caches.delete(name)))

  // 2. Unregister this service worker so it never runs again.
  await self.registration.unregister()

  // 3. Force-reload all open clients so they load fresh assets.
  const clients = await self.clients.matchAll({ type: 'window' })
  clients.forEach(client => client.navigate(client.url))
})
