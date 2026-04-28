// Admin Panel Edge Function
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase — no secrets to add.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  // Pull JWT from Authorization header
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  if (!token) return json({ error: 'Unauthorized' }, 401)

  // Use service-role client throughout (service role bypasses RLS)
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Verify the caller's JWT and check admin flag
  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

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

    const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword })
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true })
  }

  return json({ error: 'Unknown action' }, 400)
})
