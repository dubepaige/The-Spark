// Admin Panel Edge Function
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Verify caller JWT
  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  // Check admin flag
  const { data: caller } = await admin.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!caller?.is_admin) return json({ error: 'Forbidden — admins only' }, 403)

  const { action, userId, newPassword } = await req.json()

  // ── LIST USERS ──────────────────────────────────────────────────
  if (action === 'list-users') {
    const { data: profiles, error } = await admin
      .from('profiles')
      .select('id, username, full_name, email, created_at, is_admin')
      .order('created_at', { ascending: false })
    if (error) return json({ error: error.message }, 500)
    return json({ users: profiles })
  }

  // ── SET PASSWORD ─────────────────────────────────────────────────
  if (action === 'set-password') {
    if (!userId || !newPassword || newPassword.length < 6)
      return json({ error: 'userId and newPassword (min 6 chars) required' }, 400)

    // Use the REST API directly — more reliable in Deno than the JS client admin method
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method:  'PUT',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey':        SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ password: newPassword }),
    })

    const data = await res.json()
    if (!res.ok) return json({ error: data?.msg || data?.message || 'Auth API error' }, 500)
    return json({ ok: true })
  }

  return json({ error: 'Unknown action' }, 400)
})
