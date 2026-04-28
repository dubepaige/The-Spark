// ===== The Spark — Service Worker =====
const CACHE = 'spark-v5'
const STATIC = [
  '/The-Spark/manifest.json',
  '/The-Spark/icon-192.png',
  '/The-Spark/icon-512.png',
  '/The-Spark/apple-touch-icon.png',
]

// Install: pre-cache only static assets (not JS/CSS — those are network-first)
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)))
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

// Fetch strategy:
//   • Supabase / esm.sh / fonts  → always network (bypass SW entirely)
//   • JS and CSS                 → network-first  (updates show on normal refresh)
//   • Everything else            → cache-first    (fast, offline-friendly)
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)

  // Bypass SW for external APIs and CDNs
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('esm.sh')      ||
      url.hostname.includes('fonts.g')) {
    return
  }

  const isCodeAsset = url.pathname.endsWith('.js') || url.pathname.endsWith('.css')

  if (isCodeAsset) {
    // Network-first: always fetch fresh JS/CSS, cache as fallback
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, copy))
        }
        return res
      }).catch(() => caches.match(e.request))
    )
    return
  }

  // Cache-first for images, HTML, manifest, etc.
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached
      return fetch(e.request).then(res => {
        if (res.ok && url.hostname === self.location.hostname) {
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, copy))
        }
        return res
      }).catch(() => cached || new Response('Offline', { status: 503 }))
    })
  )
})
