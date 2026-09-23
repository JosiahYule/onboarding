import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Removes an employee's portal login (auth user + user_profiles row).
//
// Only admins and super admins may call it. Version 1 of this function checked
// that the caller was signed in but not their role, so any employee could
// delete another user's login; the role guard (matching invite-employee) was
// deployed on 2026-09-23. Deploy changes with
// `supabase functions deploy delete-user` (verify_jwt stays on).
Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: { user: caller }, error: callerError } = await supabaseAdmin.auth.getUser(token)
    if (callerError || !caller) return json({ error: 'Unauthorized' }, 401)

    const { data: callerProfile } = await supabaseAdmin
      .from('user_profiles').select('role').eq('id', caller.id).single()
    if (callerProfile?.role !== 'admin' && callerProfile?.role !== 'super_admin') {
      return json({ error: 'Forbidden' }, 403)
    }

    const { employeeId } = await req.json()
    if (!employeeId) return json({ error: 'Missing employeeId' }, 400)

    const { data: profile } = await supabaseAdmin
      .from('user_profiles').select('id, role').eq('employee_id', employeeId).maybeSingle()

    // No login to remove is a success: the caller goes on to delete the records.
    if (!profile) return json({ success: true })

    if (profile.role === 'super_admin') {
      return json({ error: 'A super admin account cannot be deleted from here.' }, 403)
    }

    const { error: profileError } = await supabaseAdmin
      .from('user_profiles').delete().eq('id', profile.id)
    if (profileError) return json({ error: profileError.message }, 500)

    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(profile.id)
    if (authError) return json({ error: authError.message }, 500)

    return json({ success: true })
  } catch (err) {
    return json({ error: err.message }, 500)
  }
});
