-- Follow-up to 20261106_02, from review of JosiahYule/onboarding#66.
--
-- 1. Permission checks that let a missing role through. get_user_role()
--    returns NULL for a signed-in account with no user_profiles row, and
--    `NULL not in ('admin', 'super_admin')` is NULL, not true, so
--    `if ... then raise 'Access denied'` never fired. Such an account could
--    approve, deny or cancel anyone's time off, import HR's list, copy a year
--    or list anniversaries. Every check now treats a missing role as ''.
--
-- 2. Refunds for approvals made before balance_usage existed. Those were all
--    charged to Personal / Vacation (used_days), whatever the type, so
--    cancelling or denying one refunds vacation, not the allowance today's
--    rules would pick. (None exist at the time of writing; this keeps it right
--    if one ever turns up.)

-- Which allowance an approved request was actually charged to.
create or replace function public._time_off_charged_bucket(p_req public.time_off_requests)
 returns text language sql immutable set search_path to 'public'
as $$
  select case when p_req.balance_usage is null then 'vacation' else time_off_balance_bucket(p_req.type) end
$$;
revoke execute on function public._time_off_charged_bucket(public.time_off_requests) from public, anon, authenticated;

create or replace function public.approve_time_off_request(p_request_id uuid, p_notes text default null)
 returns public.time_off_requests language plpgsql security definer set search_path to 'public'
as $$
declare v_req time_off_requests; v_reviewer uuid; v_split jsonb;
begin
  if coalesce(get_user_role(), '') not in ('admin', 'super_admin') then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  select employee_id into v_reviewer from user_profiles where id = auth.uid();
  select * into v_req from time_off_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_req.status = 'approved' then return v_req; end if;
  if v_req.status <> 'pending' then
    raise exception 'This request was % and can no longer be approved.', v_req.status;
  end if;
  v_split := time_off_year_split(v_req.start_date, v_req.end_date, v_req.is_half_day, employee_province(v_req.employee_id));
  update time_off_requests
     set status = 'approved', review_notes = p_notes, reviewed_at = now(), reviewed_by = v_reviewer,
         year_split = v_split, business_days = time_off_split_total(v_split),
         balance_usage = case when time_off_counts_against_balance(v_req.type) then v_split else '{}'::jsonb end,
         updated_at = now()
   where id = p_request_id returning * into v_req;
  perform _time_off_apply(v_req.employee_id, v_req.balance_usage, 1, time_off_balance_bucket(v_req.type));
  return v_req;
end $$;

create or replace function public.deny_time_off_request(p_request_id uuid, p_notes text default null)
 returns public.time_off_requests language plpgsql security definer set search_path to 'public'
as $$
declare v_req time_off_requests; v_reviewer uuid; v_refund jsonb; v_bucket text;
begin
  if coalesce(get_user_role(), '') not in ('admin', 'super_admin') then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  select employee_id into v_reviewer from user_profiles where id = auth.uid();
  select * into v_req from time_off_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_req.status not in ('pending', 'approved') then
    raise exception 'This request was % and can''t be denied.', v_req.status;
  end if;
  if v_req.status = 'approved' then
    v_refund := _time_off_deducted(v_req);
    v_bucket := _time_off_charged_bucket(v_req);
  end if;
  update time_off_requests
     set status = 'denied', review_notes = p_notes, reviewed_at = now(), reviewed_by = v_reviewer,
         balance_usage = null, updated_at = now()
   where id = p_request_id returning * into v_req;
  perform _time_off_apply(v_req.employee_id, v_refund, -1, v_bucket);
  return v_req;
end $$;

create or replace function public.cancel_time_off_request(p_request_id uuid)
 returns public.time_off_requests language plpgsql security definer set search_path to 'public'
as $$
declare v_req time_off_requests; v_caller_employee uuid; v_is_admin boolean; v_refund jsonb; v_bucket text;
begin
  v_is_admin := coalesce(get_user_role(), '') in ('admin', 'super_admin');
  select employee_id into v_caller_employee from user_profiles where id = auth.uid();
  select * into v_req from time_off_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if not v_is_admin and (v_caller_employee is null or v_req.employee_id is distinct from v_caller_employee) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if v_req.status not in ('pending', 'approved') then return v_req; end if;
  if not v_is_admin and v_req.status = 'approved'
     and v_req.start_date <= (now() at time zone 'America/Halifax')::date then
    raise exception 'This time off has already started, so it can''t be cancelled here. Please contact HR.';
  end if;
  if v_req.status = 'approved' then
    v_refund := _time_off_deducted(v_req);
    v_bucket := _time_off_charged_bucket(v_req);
  end if;
  update time_off_requests set status = 'cancelled', balance_usage = null, updated_at = now()
   where id = p_request_id returning * into v_req;
  perform _time_off_apply(v_req.employee_id, v_refund, -1, v_bucket);
  return v_req;
end $$;

create or replace function public.start_time_off_year(p_year int)
 returns integer language plpgsql security definer set search_path to 'public'
as $$
declare v_count int;
begin
  if coalesce(get_user_role(), '') not in ('admin', 'super_admin') then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then raise exception 'Invalid year'; end if;
  insert into time_off_balances (employee_id, year, total_days, care_days, carried_over, used_days, care_used)
  select b.employee_id, p_year, b.total_days, b.care_days, 0, 0, 0
    from time_off_balances b
   where b.year = p_year - 1
  on conflict (employee_id, year) do update
     set total_days = case when time_off_balances.total_days = 0 then excluded.total_days else time_off_balances.total_days end,
         care_days = case when time_off_balances.care_days = 0 then excluded.care_days else time_off_balances.care_days end,
         updated_at = now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.upcoming_anniversaries(p_days int default 30)
 returns table(employee_id uuid, full_name text, email text, brand text, branch text,
               hire_date date, anniversary_date date, years int, days_away int)
 language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if coalesce(get_user_role(), '') not in ('admin', 'super_admin') then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  return query select * from _upcoming_anniversaries((now() at time zone 'America/Halifax')::date, least(greatest(coalesce(p_days, 30), 1), 366));
end $$;

create or replace function public.import_time_off_list(p_year int, p_rows jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare r jsonb; v_emp uuid; v_people int := 0; v_balances int := 0;
begin
  if coalesce(get_user_role(), '') not in ('admin', 'super_admin') then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then raise exception 'Invalid year'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_emp := (r->>'employee_id')::uuid;
    if not exists (select 1 from employees where id = v_emp) then
      raise exception 'Unknown employee %', v_emp;
    end if;
    if r->>'start_date' is not null or r->>'branch' is not null then
      update employees
         set hire_date = coalesce((r->>'start_date')::date, hire_date),
             branch = coalesce(r->>'branch', branch)
       where id = v_emp;
      v_people := v_people + 1;
    end if;
    if r->>'vacation_days' is not null or r->>'care_days' is not null then
      if coalesce((r->>'vacation_days')::numeric, 0) < 0 or coalesce((r->>'care_days')::numeric, 0) < 0 then
        raise exception 'Days can''t be negative';
      end if;
      insert into time_off_balances (employee_id, year, total_days, care_days, used_days, care_used)
      values (v_emp, p_year, coalesce((r->>'vacation_days')::numeric, 0), coalesce((r->>'care_days')::numeric, 0), 0, 0)
      on conflict (employee_id, year) do update
        set total_days = coalesce((r->>'vacation_days')::numeric, time_off_balances.total_days),
            care_days = coalesce((r->>'care_days')::numeric, time_off_balances.care_days),
            updated_at = now();
      v_balances := v_balances + 1;
    end if;
  end loop;
  return jsonb_build_object('people', v_people, 'balances', v_balances);
end $$;
