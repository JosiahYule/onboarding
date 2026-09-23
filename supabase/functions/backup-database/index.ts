import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

// Exports every public table to backup-YYYY-MM-DD.json in the private
// `backups` storage bucket. Run weekly by the `weekly-database-backup` pg_cron
// job (see supabase/migrations/20260923_02_secure_weekly_backup.sql).
//
// Who may call it (anything else gets 403):
// - the cron job, which sends an `x-backup-token` header checked against the
//   `backup_cron_token` Vault secret via public.verify_backup_token();
// - a caller presenting the service role key;
// - a signed-in super admin (for an on-demand backup).
//
// Version 1 had no check beyond Supabase's JWT gate, which the public anon key
// passes, so anyone could trigger it. It also exported only 8 of the 15 tables
// and read each in a single request, which Supabase caps at 1,000 rows.

// Every table in the public schema, with the column used to page through it.
const TABLES: Array<[string, string]> = [
  ['employees', 'id'],
  ['onboarding_instances', 'id'],
  ['task_completions', 'id'],
  ['onboarding_templates', 'id'],
  ['roles', 'id'],
  ['documents', 'id'],
  ['document_completions', 'id'],
  ['user_profiles', 'id'],
  ['task_library', 'id'],
  ['time_off_requests', 'id'],
  ['time_off_balances', 'id'],
  ['company_holidays', 'id'],
  ['tech_support_tickets', 'id'],
  ['system_settings', 'key'],
  ['audit_log', 'id'],
]
const PAGE_SIZE = 1000

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' }
})

async function isAuthorized(req: Request, admin: SupabaseClient, serviceKey: string): Promise<boolean> {
  const cronToken = req.headers.get('x-backup-token')
  if (cronToken) {
    const { data, error } = await admin.rpc('verify_backup_token', { p_token: cronToken })
    return !error && data === true
  }

  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!bearer) return false
  if (serviceKey && bearer === serviceKey) return true

  const { data: { user } } = await admin.auth.getUser(bearer)
  if (!user) return false
  const { data: profile } = await admin.from('user_profiles').select('role').eq('id', user.id).maybeSingle()
  return profile?.role === 'super_admin'
}

// Read a whole table in pages, so it isn't silently cut off at the API's row cap.
async function readAll(admin: SupabaseClient, table: string, orderBy: string) {
  const rows: unknown[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin.from(table).select('*').order(orderBy).range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) return rows
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    if (!(await isAuthorized(req, supabaseAdmin, serviceKey))) {
      return json({ error: 'Forbidden' }, 403)
    }

    const backup: Record<string, unknown[]> = {}
    const failed: Record<string, string> = {}
    for (const [table, orderBy] of TABLES) {
      try {
        backup[table] = await readAll(supabaseAdmin, table, orderBy)
      } catch (err) {
        failed[table] = (err as Error).message
        backup[table] = []
        console.error(`Failed to export ${table}:`, failed[table])
      }
    }

    const exportedAt = new Date().toISOString()
    const filename = `backup-${exportedAt.split('T')[0]}.json`
    const content = JSON.stringify({ exported_at: exportedAt, tables: backup, failed_tables: failed }, null, 2)

    const { error: uploadError } = await supabaseAdmin.storage
      .from('backups')
      .upload(filename, new Blob([content], { type: 'application/json' }), { upsert: true })

    if (uploadError) {
      console.error('Upload failed:', uploadError.message)
      return json({ error: uploadError.message }, 500)
    }

    const rowCounts = Object.fromEntries(Object.entries(backup).map(([table, rows]) => [table, rows.length]))
    console.log(`Backup complete: ${filename}`, rowCounts)

    // A partial backup is saved (better than none) but reported as a failure,
    // so it shows up in pg_net's responses and the function logs.
    if (Object.keys(failed).length > 0) {
      return json({ error: 'Some tables could not be exported', failed_tables: failed, filename, row_counts: rowCounts }, 500)
    }
    return json({ success: true, filename, row_counts: rowCounts })
  } catch (err) {
    console.error('Backup failed:', err)
    return json({ error: (err as Error).message }, 500)
  }
})
