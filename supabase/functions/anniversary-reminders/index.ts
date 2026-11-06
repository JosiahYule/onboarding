import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

// Emails HR about work anniversaries coming up in the next 30 days. Run once a
// day by the `daily-anniversary-reminders` pg_cron job (see
// supabase/migrations/20261106_02_branches_holidays_care_days_anniversaries.sql).
//
// Each anniversary is mentioned once: public.anniversary_notifications records
// what was sent. Anyone whose anniversary is 30 days out shows up the day they
// enter that window; if a day is missed, the next run picks them up. Nothing
// is sent while the `anniversary_notification_email` setting is empty.
//
// Who may call it (anything else gets 403):
// - the cron job, which sends an `x-cron-token` header checked against the
//   `anniversary_cron_token` Vault secret via public.verify_anniversary_token();
// - a caller presenting the service role key;
// - a signed-in admin or super admin (to send it now, from the app).

const BRANCH_NAMES: Record<string, string> = {
  halifax: 'Halifax', st_johns: "St. John's", charlottetown: 'Charlottetown', moncton: 'Moncton', saint_john: 'Saint John',
};
const BRAND_NAMES: Record<string, string> = { ISL: 'Integrated Staffing', AS: 'Accountant Staffing', ADS: 'Administrative Staffing' };

interface Due {
  employee_id: string; full_name: string; email: string | null; brand: string | null; branch: string | null;
  hire_date: string; anniversary_date: string; years: number; days_away: number;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' }
})

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Dates arrive as YYYY-MM-DD. Formatted without a time zone so they can't
// shift by a day.
function longDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

async function isAuthorized(req: Request, admin: SupabaseClient, serviceKey: string): Promise<boolean> {
  const cronToken = req.headers.get('x-cron-token')
  if (cronToken) {
    const { data, error } = await admin.rpc('verify_anniversary_token', { p_token: cronToken })
    return !error && data === true
  }
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!bearer) return false
  if (serviceKey && bearer === serviceKey) return true
  const { data: { user } } = await admin.auth.getUser(bearer)
  if (!user) return false
  const { data: profile } = await admin.from('user_profiles').select('role').eq('id', user.id).maybeSingle()
  return profile?.role === 'admin' || profile?.role === 'super_admin'
}

function buildEmail(due: Due[]) {
  const rows = due.map(d => {
    const where = [d.brand ? BRAND_NAMES[d.brand] || d.brand : null, d.branch ? BRANCH_NAMES[d.branch] || d.branch : null].filter(Boolean).join(' · ')
    const when = d.days_away === 0 ? 'today' : d.days_away === 1 ? 'tomorrow' : `in ${d.days_away} days`
    return `<tr>
  <td style="padding:8px 16px 8px 0;border-bottom:1px solid #eee;"><strong>${escapeHtml(d.full_name)}</strong>${where ? `<br/><span style="color:#888;font-size:13px;">${escapeHtml(where)}</span>` : ''}</td>
  <td style="padding:8px 16px 8px 0;border-bottom:1px solid #eee;">${ordinal(d.years)} anniversary<br/><span style="color:#888;font-size:13px;">${d.years} year${d.years === 1 ? '' : 's'}</span></td>
  <td style="padding:8px 0;border-bottom:1px solid #eee;">${escapeHtml(longDate(d.anniversary_date))}<br/><span style="color:#888;font-size:13px;">${when}</span></td>
</tr>`
  }).join('\n')
  const intro = due.length === 1
    ? `${escapeHtml(due[0].full_name.split(' ')[0])} has a work anniversary coming up.`
    : `${due.length} people have work anniversaries coming up.`
  return `<p>${intro}</p>
<table style="border-collapse:collapse;font-size:14px;">
<thead><tr>
  <th align="left" style="padding:0 16px 6px 0;color:#888;font-weight:600;font-size:12px;">Who</th>
  <th align="left" style="padding:0 16px 6px 0;color:#888;font-weight:600;font-size:12px;">Milestone</th>
  <th align="left" style="padding:0 0 6px;color:#888;font-weight:600;font-size:12px;">Date</th>
</tr></thead>
<tbody>
${rows}
</tbody>
</table>
<p style="color:#888;font-size:13px;">Sent by Integrated Launch about 30 days ahead of each start-date anniversary. Each anniversary is only mentioned once.</p>`
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  try {
    if (!(await isAuthorized(req, admin, serviceKey))) return json({ error: 'Forbidden' }, 403)

    const { data: setting } = await admin.from('system_settings').select('value').eq('key', 'anniversary_notification_email').maybeSingle()
    const to = String(setting?.value ?? '').trim()
    if (!to) return json({ sent: 0, skipped: 'anniversary_notification_email is not set' })

    const { data: due, error } = await admin.rpc('due_anniversary_reminders')
    if (error) return json({ error: error.message }, 500)
    const list = (due ?? []) as Due[]
    if (list.length === 0) return json({ sent: 0 })

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    if (!RESEND_API_KEY) return json({ error: 'Missing RESEND_API_KEY' }, 500)

    const subject = list.length === 1
      ? `Work anniversary coming up: ${list[0].full_name}, ${list[0].years} year${list[0].years === 1 ? '' : 's'}`
      : `${list.length} work anniversaries coming up`
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Integrated Launch <onboarding@integratedstaffing.ca>', to: [to], subject, html: buildEmail(list) }),
    })
    if (!res.ok) {
      // Nothing is marked as sent, so tomorrow's run tries again.
      return json({ error: await res.text() }, 502)
    }

    const items = list.map(d => ({ employee_id: d.employee_id, anniversary_date: d.anniversary_date, years: d.years }))
    const { error: markErr } = await admin.rpc('mark_anniversary_reminders_sent', { p_items: items, p_sent_to: to })
    if (markErr) return json({ sent: list.length, warning: `Sent, but not recorded: ${markErr.message}` })
    return json({ sent: list.length })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
});
