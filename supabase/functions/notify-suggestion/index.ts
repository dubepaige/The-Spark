// Supabase Edge Function — called by a Database Webhook on suggestions INSERT
// Sends an email to the site owner via Resend (resend.com — free tier)

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const TO         = 'paigedube27@gmail.com'

Deno.serve(async (req) => {
  try {
    const { record } = await req.json()
    const name    = record?.name    || 'Anonymous'
    const message = record?.message || '(no message)'
    const time    = record?.created_at ?? new Date().toISOString()

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    'The Spark <onboarding@resend.dev>',
        to:      [TO],
        subject: '💡 New suggestion on The Spark',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:auto">
            <h2 style="color:#8B5CF6">💡 New suggestion on The Spark</h2>
            <p><strong>From:</strong> ${escHtml(name)}</p>
            <p><strong>Message:</strong></p>
            <blockquote style="border-left:3px solid #8B5CF6;padding:8px 16px;margin:0;color:#333">
              ${escHtml(message)}
            </blockquote>
            <p style="color:#888;font-size:0.85em;margin-top:16px">Received: ${time}</p>
          </div>`,
      }),
    })

    const body = await res.json()
    return new Response(JSON.stringify({ ok: res.ok, resend: body }), {
      status: res.ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

function escHtml(str: string) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
