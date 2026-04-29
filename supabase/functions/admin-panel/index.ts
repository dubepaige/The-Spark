// Admin Panel Edge Function
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // Verify caller JWT and admin flag
  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  const { data: caller } = await admin.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!caller?.is_admin) return json({ error: 'Forbidden — admins only' }, 403)

  const body = await req.json()
  const { action, userId, newPassword } = body

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

    // Step 1: confirm the auth user exists
    const { data: existing, error: fetchErr } = await admin.auth.admin.getUserById(userId)
    if (fetchErr || !existing?.user) {
      return json({ error: `User not found in auth: ${fetchErr?.message ?? 'unknown'}` }, 404)
    }

    // Step 2: update the password
    const { data: updated, error: updateErr } = await admin.auth.admin.updateUserById(
      userId, { password: newPassword }
    )
    if (updateErr) return json({ error: updateErr.message }, 500)
    if (!updated?.user) return json({ error: 'Update returned no user — password may not have changed' }, 500)

    return json({ ok: true, email: updated.user.email })
  }

  return json({ error: 'Unknown action' }, 400)
})
