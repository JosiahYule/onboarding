-- Closes the same "missing role" hole as 20261106_03 in older functions,
-- several of which anyone could call without signing in, using the public
-- anon key that ships in the website.
--
-- get_user_role() is NULL when nobody is signed in (or the account has no
-- profile), and `NULL not in (...)` / `NULL != ...` is NULL rather than true,
-- so the "Access denied" branch never ran. Before this:
--   - create_onboarding: anyone could create an employee and onboarding plan.
--   - swap_employee_and_tasks: anyone could change an employee's name, email,
--     start date, role and manager, and reset their onboarding tasks.
--   - get_all_users_admin: anyone could list every login's email and access.
--   - insert_audit_log: anyone could write audit entries.
--   - rls_auto_enable: an event-trigger helper, callable over the API for no
--     reason (it does nothing outside an event trigger).
--
-- Each guard now treats a missing role as '', anonymous callers lose EXECUTE
-- entirely, and the audit log only accepts entries from a signed-in user.
-- Function bodies are otherwise unchanged.
--
-- get_user_role() itself stays callable: row-level security policies call it
-- for whoever is querying, and it only ever returns the caller's own role
-- (NULL when signed out).

create or replace function public.create_onboarding(p_full_name text, p_email text, p_role_id uuid, p_hire_date date, p_brand text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_employee_id uuid;
  v_instance_id uuid;
begin
  if coalesce(get_user_role(), '') not in ('admin', 'super_admin') then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  insert into employees (full_name, email, role_id, hire_date, brand)
  values (p_full_name, p_email, p_role_id, p_hire_date, p_brand)
  returning id into v_employee_id;

  insert into onboarding_instances (employee_id)
  values (v_employee_id)
  returning id into v_instance_id;

  insert into task_completions (instance_id, template_task_id, completed, day, sort_order)
  select v_instance_id, t.id, false, t.phase, coalesce(t.sort_order, 0)
  from onboarding_templates t
  where t.role_id = p_role_id;

  return json_build_object('employee_id', v_employee_id, 'instance_id', v_instance_id);
end;
$function$;

create or replace function public.swap_employee_and_tasks(p_employee_id uuid, p_full_name text, p_email text, p_hire_date date, p_role_id uuid, p_manager_id uuid, p_instance_id uuid default null)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if coalesce(get_user_role(), '') not in ('admin', 'super_admin') then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  update employees
     set full_name = p_full_name, email = p_email, hire_date = p_hire_date,
         role_id = p_role_id, manager_id = p_manager_id
   where id = p_employee_id;

  if p_instance_id is not null then
    delete from task_completions where instance_id = p_instance_id;
    insert into task_completions (instance_id, template_task_id, completed, day, sort_order)
    select p_instance_id, t.id, false, t.phase, coalesce(t.sort_order, 0)
    from onboarding_templates t
    where t.role_id = p_role_id;
  end if;
end;
$function$;

create or replace function public.get_all_users_admin()
 returns table(id uuid, email text, role text, brand text, employee_id uuid, deactivated boolean, created_at timestamptz, last_sign_in_at timestamptz)
 language plpgsql security definer set search_path to 'public'
as $function$
begin
  if coalesce(get_user_role(), '') <> 'super_admin' then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  return query
  select au.id, au.email::text, coalesce(up.role, 'none')::text as role, up.brand::text, up.employee_id,
         coalesce(up.deactivated, false) as deactivated, au.created_at, au.last_sign_in_at
    from auth.users au
    left join public.user_profiles up on up.id = au.id
   order by au.created_at desc;
end;
$function$;

create or replace function public.insert_audit_log(p_action text, p_entity_type text default null, p_entity_id text default null, p_metadata jsonb default null)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_user_id uuid;
  v_user_email text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;

  select id, email into v_user_id, v_user_email from auth.users where id = auth.uid();

  insert into public.audit_log (user_id, user_email, action, entity_type, entity_id, metadata)
  values (v_user_id, v_user_email, p_action, p_entity_type, p_entity_id, p_metadata);
end;
$function$;

revoke execute on function public.create_onboarding(text, text, uuid, date, text) from public, anon;
grant execute on function public.create_onboarding(text, text, uuid, date, text) to authenticated;
revoke execute on function public.swap_employee_and_tasks(uuid, text, text, date, uuid, uuid, uuid) from public, anon;
grant execute on function public.swap_employee_and_tasks(uuid, text, text, date, uuid, uuid, uuid) to authenticated;
revoke execute on function public.get_all_users_admin() from public, anon;
grant execute on function public.get_all_users_admin() to authenticated;
revoke execute on function public.insert_audit_log(text, text, text, jsonb) from public, anon;
grant execute on function public.insert_audit_log(text, text, text, jsonb) to authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
