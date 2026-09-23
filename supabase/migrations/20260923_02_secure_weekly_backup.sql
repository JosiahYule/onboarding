-- Makes the weekly backup actually run, and stops anyone else from triggering it.
--
-- Before: the `weekly-database-backup` cron job read its Authorization header
-- from a Vault secret named SUPABASE_SERVICE_ROLE_KEY that was never created,
-- so every Sunday it called backup-database with no auth header and got
-- 401 "Missing authorization header". The only backup on file was a one-off
-- from 2026-05-12. Separately, backup-database itself accepted the public
-- anon key, so anyone could trigger a full export.
--
-- After: the job authenticates with its own random token, generated here and
-- kept in Vault, which grants nothing but "run a backup". backup-database v2
-- checks it via verify_backup_token() (callable by service_role only).

-- 1. The job's token. Generated in the database, so its value never appears
--    in code, logs or this file. Idempotent.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'backup_cron_token') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'backup_cron_token',
      'Lets the weekly-database-backup cron job call the backup-database edge function. Grants nothing else.'
    );
  end if;
end $$;

-- 2. Lets the edge function check a presented token without reading Vault
--    itself. Only the service role may call it.
create or replace function public.verify_backup_token(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    length(p_token) > 0 and exists (
      select 1 from vault.decrypted_secrets
      where name = 'backup_cron_token' and decrypted_secret = p_token
    ),
    false
  )
$$;

revoke all on function public.verify_backup_token(text) from public, anon, authenticated;
grant execute on function public.verify_backup_token(text) to service_role;

-- 3. Point the existing job (same name and schedule: Sundays 00:00 UTC) at the
--    token. The Authorization header carries the public anon key only to get
--    past Supabase's JWT gate; on its own it no longer authorises anything.
--    60s timeout so the response is recorded in net._http_response.
select cron.schedule(
  'weekly-database-backup',
  '0 0 * * 0',
  $cmd$
  select net.http_post(
    url := 'https://gqgjnltqbomtefryqlua.supabase.co/functions/v1/backup-database',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxZ2pubHRxYm9tdGVmcnlxbHVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNDQwNDAsImV4cCI6MjA5MTkyMDA0MH0.FS8xUisIdPRKHLlKWHLR2H3Vt4iOLGkMVuJAzUvIvVw',
      'x-backup-token', (select decrypted_secret from vault.decrypted_secrets where name = 'backup_cron_token' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cmd$
);
