// ===== The Spark — Service Worker =====
const CACHE   = 'spark-v1'
const SHELL   = [
  '/The-Spark/',
  '/The-Spark/css/main.css',
  '/The-Spark/js/app.js',
  '/The-Spark/manifest.json',
  '/The-Spark/icon-192.png',
  '/The-Spark/icon-512.png',
  '/The-Spark/apple-touch-icon.png',
]

// Install: cache the app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL))
  )
  self.skipWaiting()
})

// Activate: clean up old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Fetch: serve shell from cache, everything else from network
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)

  // Always hit the network for Supabase API calls
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('esm.sh')      ||
      url.hostname.includes('fonts.g')) {
    return // let browser handle it normally
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached
      return fetch(e.request).then(res => {
        // Cache new local assets on the fly
        if (res.ok && url.hostname === self.location.hostname) {
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, copy))
        }
        return res
      }).catch(() => cached || new Response('Offline', { status: 503 }))
    })
  )
})
