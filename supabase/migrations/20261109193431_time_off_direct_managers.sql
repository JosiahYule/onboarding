-- Manager choices match the two Microsoft Forms, read on 2026-11-09.
-- This migration sends no email, creates no webhook, and does not modify
-- either Microsoft Form, Power Automate flow, or the configured HR address.

create schema if not exists private;
grant usage on schema private to authenticated;

create table public.time_off_managers (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  brands text[] not null check (
    cardinality(brands) > 0 and brands <@ array['ISL', 'AS', 'ADS']::text[]
  ),
  active boolean not null default true
);
alter table public.time_off_managers enable row level security;
revoke all on public.time_off_managers from public, anon, authenticated;
grant select, insert, update, delete on public.time_off_managers to authenticated, service_role;
create policy time_off_managers_admin on public.time_off_managers
  for all to authenticated
  using (
    (select public.get_user_role()) in ('admin', 'super_admin')
    and exists (select 1 from public.user_profiles p where p.id=(select auth.uid()) and not coalesce(p.deactivated, false))
  )
  with check (
    (select public.get_user_role()) in ('admin', 'super_admin')
    and exists (select 1 from public.user_profiles p where p.id=(select auth.uid()) and not coalesce(p.deactivated, false))
  );

-- The production roster is configured privately in the database from the
-- existing Forms. Keep real staff names, addresses and recipient mappings
-- out of this public source repository. Configure this table separately when
-- provisioning another environment; the UI handles an empty roster safely.

alter table public.time_off_requests
  add column direct_manager_id uuid references public.employees(id) on delete set null,
  add column direct_manager_name text;
create index time_off_requests_direct_manager_idx on public.time_off_requests(direct_manager_id);

-- Employees cannot read the staff directory. This narrow, authenticated RPC
-- exposes only the permitted managers' IDs, names and default-selection flag.
-- Privileged code lives outside the exposed API schema.
create function private.get_time_off_managers()
returns table(manager_id uuid, full_name text, is_default boolean)
language plpgsql stable security definer set search_path=''
as $$
declare v_employee uuid; v_brand text; v_default uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select e.id, e.brand, e.manager_id into v_employee, v_brand, v_default
  from public.user_profiles p join public.employees e on e.id=p.employee_id
  where p.id=auth.uid() and not coalesce(p.deactivated, false)
    and p.role in ('employee', 'manager', 'admin', 'super_admin');
  if not found then raise exception 'Employee profile required' using errcode='42501'; end if;

  return query
  select m.employee_id, e.full_name, m.employee_id=v_default
  from public.time_off_managers m join public.employees e on e.id=m.employee_id
  where m.active and v_brand=any(m.brands) and m.employee_id<>v_employee
    and nullif(trim(e.email), '') is not null
    and not exists(select 1 from public.user_profiles p where p.employee_id=m.employee_id and p.deactivated)
  order by e.full_name;
end $$;
revoke execute on function private.get_time_off_managers() from public, anon;
grant execute on function private.get_time_off_managers() to authenticated;

create function public.get_time_off_managers()
returns table(manager_id uuid, full_name text, is_default boolean)
language sql stable security invoker set search_path=''
as $$ select * from private.get_time_off_managers() $$;
revoke execute on function public.get_time_off_managers() from public, anon;
grant execute on function public.get_time_off_managers() to authenticated;

-- Validate the selection and derive the display name on the server. Choosing
-- a manager for a request never changes employees.manager_id or access roles.
create function private.set_time_off_direct_manager()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_brand text; v_default uuid; v_name text; v_admin boolean;
begin
  v_admin := auth.uid() is null or coalesce(public.get_user_role(), '') in ('admin', 'super_admin');
  if auth.uid() is not null and not exists (
    select 1 from public.user_profiles p where p.id=auth.uid() and not coalesce(p.deactivated, false)
      and p.role in ('employee', 'manager', 'admin', 'super_admin')
  ) then raise exception 'Active employee profile required' using errcode='42501'; end if;
  if not v_admin and new.start_date<date '2027-01-01' then
    raise exception 'Integrated Launch records time off from January 1, 2027.' using errcode='22023';
  end if;

  -- Keep a historic name when approving/cancelling or editing dates. The FK's
  -- ON DELETE SET NULL must also be allowed without rewriting that snapshot.
  if tg_op='UPDATE' and new.employee_id is not distinct from old.employee_id then
    if new.direct_manager_id is not distinct from old.direct_manager_id then
      new.direct_manager_name := old.direct_manager_name;
      return new;
    end if;
    if new.direct_manager_id is null and old.direct_manager_id is not null then
      new.direct_manager_name := old.direct_manager_name;
      return new;
    end if;
  end if;

  select e.brand, e.manager_id into v_brand, v_default from public.employees e where e.id=new.employee_id;
  if not found then raise exception 'Employee not found' using errcode='22023'; end if;

  if new.direct_manager_id is null then
    -- HR's historic/imported leave can omit a selection. Do not invent a
    -- historical selection or block people without portal accounts.
    if v_admin then new.direct_manager_name:=null; return new; end if;
    raise exception 'Please select your direct manager.' using errcode='22023';
  end if;
  select e.full_name into v_name from public.time_off_managers m
  join public.employees e on e.id=m.employee_id
  where m.employee_id=new.direct_manager_id and m.active and v_brand=any(m.brands)
    and m.employee_id<>new.employee_id and nullif(trim(e.email), '') is not null
    and not exists(select 1 from public.user_profiles p where p.employee_id=m.employee_id and p.deactivated);
  if not found then raise exception 'Please select an available direct manager for your company.' using errcode='22023'; end if;
  new.direct_manager_name:=v_name;
  return new;
end $$;
revoke execute on function private.set_time_off_direct_manager() from public, anon, authenticated;
create trigger tor_direct_manager
  before insert or update of employee_id, direct_manager_id, direct_manager_name, start_date
  on public.time_off_requests for each row execute function private.set_time_off_direct_manager();

-- Routing preparation only: this RPC reads addresses and has no send action.
-- Later transport code can resolve HR + the request's selected manager without
-- trusting email addresses supplied by a browser. No fallback to a different
-- manager when an old request has no selection.
create function private.get_time_off_request_recipients(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_employee uuid; v_role text; v_request_employee uuid; v_manager uuid; v_hr text; v_manager_email text;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select p.employee_id,p.role into v_employee,v_role from public.user_profiles p
  where p.id=auth.uid() and not coalesce(p.deactivated, false)
    and p.role in ('employee','manager','admin','super_admin');
  if not found then raise exception 'Active employee profile required' using errcode='42501'; end if;
  select r.employee_id,r.direct_manager_id into v_request_employee,v_manager
  from public.time_off_requests r where r.id=p_request_id;
  if not found or (coalesce(v_role,'') not in ('admin','super_admin') and v_request_employee is distinct from v_employee) then
    raise exception 'Request not available' using errcode='42501';
  end if;
  select trim(s.value) into v_hr from public.system_settings s where s.key='hr_notification_email';
  select trim(e.email) into v_manager_email from public.employees e where e.id=v_manager
    and not exists(select 1 from public.user_profiles p where p.employee_id=e.id and p.deactivated);
  return jsonb_build_object('hr_email',nullif(v_hr,''),'manager_email',nullif(v_manager_email,''));
end $$;
revoke execute on function private.get_time_off_request_recipients(uuid) from public, anon;
grant execute on function private.get_time_off_request_recipients(uuid) to authenticated;

create function public.get_time_off_request_recipients(p_request_id uuid)
returns jsonb language sql stable security invoker set search_path=''
as $$ select private.get_time_off_request_recipients(p_request_id) $$;
revoke execute on function public.get_time_off_request_recipients(uuid) from public, anon;
grant execute on function public.get_time_off_request_recipients(uuid) to authenticated;

notify pgrst, 'reload schema';
