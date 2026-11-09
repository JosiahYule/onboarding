-- Keep the existing deployed portal compatible until the reviewed UI is published.
-- Selected managers are still fully validated; legacy omissions stay unassigned.

create or replace function private.set_time_off_direct_manager()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_brand text; v_default uuid; v_name text; v_admin boolean;
begin
  v_admin := auth.uid() is null or coalesce(public.get_user_role(), '') in ('admin', 'super_admin');
  if auth.uid() is not null and not exists (
    select 1 from public.user_profiles p where p.id=auth.uid() and not coalesce(p.deactivated, false)
      and p.role in ('employee', 'manager', 'admin', 'super_admin')
  ) then raise exception 'Active employee profile required' using errcode='42501'; end if;

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
    -- Keep existing clients and historic HR imports working during rollout.
    -- The new employee UI requires a choice; omitted legacy choices are not
    -- guessed and cannot resolve a manager notification recipient.
    new.direct_manager_name:=null;
    return new;
  end if;
  if not v_admin and new.start_date<date '2027-01-01' then
    raise exception 'Integrated Launch records time off from January 1, 2027.' using errcode='22023';
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
