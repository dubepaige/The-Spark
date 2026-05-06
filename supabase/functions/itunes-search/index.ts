// iTunes Search Proxy — avoids WKWebView/CORS blocks in the iOS app

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url   = new URL(req.url)
  const term  = url.searchParams.get('term') ?? ''
  const limit = url.searchParams.get('limit') ?? '10'

  if (!term) return new Response(JSON.stringify({ results: [] }), {
    headers: { 'Content-Type': 'application/json', ...CORS }
  })

  const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&limit=${limit}`
  const res  = await fetch(itunesUrl)
  const data = await res.json()

  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...CORS }
  })
})
