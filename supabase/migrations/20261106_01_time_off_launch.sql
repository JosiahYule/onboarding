-- Time off and tech support, made ready for real use. Applied to the
-- ISL-onboarding project on 2026-11-06 as migration `time_off_launch`, after a
-- rolled-back dry run that exercised every rule below as an admin and as an
-- employee.
--
-- What this fixes, in plain terms:
--
--  1. Only Personal / Vacation leave uses up the yearly balance. Bereavement,
--     Care Day, Volunteer, PD, Work from Wherever and Other are still requested,
--     approved and shown on the calendar, but no longer subtract vacation days.
--     The rule lives in time_off_counts_against_balance(), one place.
--
--  2. Requests that cross New Year (Dec 29 - Jan 2) are split by year. Before,
--     every day came off the start year's balance. Each request now stores
--     year_split (business days per year) and, once approved, balance_usage
--     (what was actually deducted). Refunds give back exactly balance_usage, so
--     editing holidays between approval and cancellation can't skew a balance.
--
--  3. business_days used to be recomputed on EVERY update, including approve
--     and cancel. It's now recomputed only when the dates change, at approval
--     (so holidays added since the request count), and for pending requests
--     whenever a company holiday is added, changed or removed.
--
--  4. A half day on a weekend or holiday counts as 0, not 0.5.
--
--  5. Permission holes closed:
--       - employees could insert a request already marked 'approved' through
--         the API (self-approval). Employees may now only insert 'pending'.
--       - employees could create their own balance row with any entitlement.
--         Only admins may now create balances.
--       - employees could cancel approved time off after taking it, refunding
--         the days. They can now cancel approved leave only before it starts;
--         after that, HR (an admin) has to do it.
--       - employees could update their requests directly; all changes now go
--         through the approve / deny / cancel functions.
--
--  6. reviewed_by is now recorded on approve and deny (it was always empty).
--
--  7. Year-end: carried_over is stored separately from the entitlement, and
--     start_time_off_year() sets up next year from this year (safe to re-run).
--     The old rollover_time_off_balances() wrote the carry-over INTO the
--     entitlement and was never called; it's dropped.
--
--  8. get_my_manager_email(): employees can't read other employee records, so
--     the "notify my manager" email never found an address. This returns only
--     the caller's own manager's email.
--
--  9. Tech support tickets gain urgency, an admin response note, resolved_at /
--     resolved_by and updated_at, for the admin ticket queue.

-- ── Columns ────────────────────────────────────────────────────────────────

alter table public.time_off_requests
  add column if not exists year_split jsonb,
  add column if not exists balance_usage jsonb;

comment on column public.time_off_requests.year_split is
  'Business days per calendar year, e.g. {"2026": 2, "2027": 3}. Kept in step with the dates.';
comment on column public.time_off_requests.balance_usage is
  'What approval deducted from time_off_balances, per year. {} when the type does not use the balance; null when nothing is deducted.';

alter table public.time_off_balances
  add column if not exists carried_over numeric not null default 0;

comment on column public.time_off_balances.total_days is
  'The yearly entitlement. Remaining = total_days + carried_over - used_days - pending.';
comment on column public.time_off_balances.carried_over is
  'Days brought forward from the previous year (see start_time_off_year).';

alter table public.time_off_requests drop constraint if exists time_off_requests_dates_check;
alter table public.time_off_requests add constraint time_off_requests_dates_check check (end_date >= start_date);
alter table public.time_off_requests drop constraint if exists time_off_requests_day_portion_check;
alter table public.time_off_requests add constraint time_off_requests_day_portion_check check (day_portion in ('full', 'am', 'pm'));

alter table public.tech_support_tickets
  add column if not exists urgency text not null default 'normal',
  add column if not exists admin_notes text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references public.employees(id) on delete set null;

alter table public.tech_support_tickets drop constraint if exists tech_support_tickets_status_check;
alter table public.tech_support_tickets add constraint tech_support_tickets_status_check check (status in ('open', 'in_progress', 'resolved'));
alter table public.tech_support_tickets drop constraint if exists tech_support_tickets_urgency_check;
alter table public.tech_support_tickets add constraint tech_support_tickets_urgency_check check (urgency in ('blocking', 'normal', 'low'));

drop trigger if exists tickets_updated_at on public.tech_support_tickets;
create trigger tickets_updated_at before update on public.tech_support_tickets
  for each row execute function public.trg_set_updated_at();

-- ── Helpers ────────────────────────────────────────────────────────────────

-- THE rule for which leave uses up the yearly balance. 'vacation' is the
-- legacy name for the same thing. Change this list to change the policy.
create or replace function public.time_off_counts_against_balance(p_type text)
 returns boolean language sql immutable set search_path to 'public'
as $$ select p_type in ('personal_vacation', 'vacation') $$;

-- Business days in a date range, split by calendar year.
create or replace function public.time_off_year_split(p_start date, p_end date, p_half_day boolean default false)
 returns jsonb language plpgsql stable set search_path to 'public'
as $$
declare
  v_split jsonb := '{}'::jsonb;
  y int;
begin
  if p_start is null or p_end is null or p_end < p_start then return v_split; end if;
  if p_half_day then
    return jsonb_build_object(extract(year from p_start)::int::text,
      case when calculate_business_days(p_start, p_start) > 0 then 0.5 else 0 end);
  end if;
  for y in extract(year from p_start)::int .. extract(year from p_end)::int loop
    v_split := v_split || jsonb_build_object(y::text,
      calculate_business_days(greatest(p_start, make_date(y, 1, 1)), least(p_end, make_date(y, 12, 31))));
  end loop;
  return v_split;
end $$;

create or replace function public.time_off_split_total(p_split jsonb)
 returns numeric language sql immutable set search_path to 'public'
as $$ select coalesce(sum(value::numeric), 0) from jsonb_each_text(coalesce(p_split, '{}'::jsonb)) $$;

-- Adds (p_sign = 1) or refunds (p_sign = -1) a per-year usage map against an
-- employee's balances. Internal: only the SECURITY DEFINER functions below,
-- which already checked permissions, call it.
create or replace function public._time_off_apply(p_employee uuid, p_usage jsonb, p_sign int)
 returns void language plpgsql set search_path to 'public'
as $$
declare r record;
begin
  for r in select key::int as yr, value::numeric as days from jsonb_each_text(coalesce(p_usage, '{}'::jsonb)) loop
    continue when r.days = 0;
    if p_sign > 0 then
      insert into time_off_balances (employee_id, year, total_days, used_days)
      values (p_employee, r.yr, 0, r.days)
      on conflict (employee_id, year)
      do update set used_days = time_off_balances.used_days + excluded.used_days, updated_at = now();
    else
      update time_off_balances
         set used_days = greatest(0, used_days - r.days), updated_at = now()
       where employee_id = p_employee and year = r.yr;
    end if;
  end loop;
end $$;

-- ── Business-days trigger: only when the dates change ─────────────────────

create or replace function public.trg_set_business_days()
 returns trigger language plpgsql set search_path to 'public'
as $$
begin
  new.is_half_day := coalesce(new.day_portion, 'full') <> 'full';
  if new.is_half_day then new.end_date := new.start_date; end if;

  if tg_op = 'INSERT'
     or new.start_date is distinct from old.start_date
     or new.end_date is distinct from old.end_date
     or new.is_half_day is distinct from old.is_half_day then
    new.year_split := time_off_year_split(new.start_date, new.end_date, new.is_half_day);
    new.business_days := time_off_split_total(new.year_split);
  end if;
  return new;
end $$;

-- Backfill year_split for existing rows (the trigger won't touch them, since
-- their dates don't change).
update public.time_off_requests
   set year_split = public.time_off_year_split(start_date, end_date, is_half_day)
 where year_split is null;

-- Pending requests are recounted whenever the holiday list changes.
create or replace function public.trg_recount_pending_time_off()
 returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  update time_off_requests
     set year_split = time_off_year_split(start_date, end_date, is_half_day),
         business_days = time_off_split_total(time_off_year_split(start_date, end_date, is_half_day))
   where status = 'pending';
  return null;
end $$;

drop trigger if exists company_holidays_recount on public.company_holidays;
create trigger company_holidays_recount after insert or update or delete on public.company_holidays
  for each statement execute function public.trg_recount_pending_time_off();

-- ── Approve / deny / cancel ────────────────────────────────────────────────

create or replace function public.approve_time_off_request(p_request_id uuid, p_notes text default null)
 returns public.time_off_requests language plpgsql security definer set search_path to 'public'
as $$
declare v_req time_off_requests; v_reviewer uuid; v_split jsonb;
begin
  if get_user_role() not in ('admin', 'super_admin') then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  select employee_id into v_reviewer from user_profiles where id = auth.uid();

  select * into v_req from time_off_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_req.status = 'approved' then return v_req; end if;
  if v_req.status <> 'pending' then
    raise exception 'This request was % and can no longer be approved.', v_req.status;
  end if;

  -- Recount now, so holidays added since the request was made are respected.
  v_split := time_off_year_split(v_req.start_date, v_req.end_date, v_req.is_half_day);

  update time_off_requests
     set status = 'approved', review_notes = p_notes, reviewed_at = now(), reviewed_by = v_reviewer,
         year_split = v_split, business_days = time_off_split_total(v_split),
         balance_usage = case when time_off_counts_against_balance(v_req.type) then v_split else '{}'::jsonb end,
         updated_at = now()
   where id = p_request_id returning * into v_req;

  perform _time_off_apply(v_req.employee_id, v_req.balance_usage, 1);
  return v_req;
end $$;

-- What an approved request deducted. Rows approved before balance_usage
-- existed fall back to the old rule: all days from the start year.
create or replace function public._time_off_deducted(p_req public.time_off_requests)
 returns jsonb language sql immutable set search_path to 'public'
as $$
  select coalesce(p_req.balance_usage,
    jsonb_build_object(extract(year from p_req.start_date)::int::text, p_req.business_days))
$$;

create or replace function public.deny_time_off_request(p_request_id uuid, p_notes text default null)
 returns public.time_off_requests language plpgsql security definer set search_path to 'public'
as $$
declare v_req time_off_requests; v_reviewer uuid; v_refund jsonb;
begin
  if get_user_role() not in ('admin', 'super_admin') then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  select employee_id into v_reviewer from user_profiles where id = auth.uid();

  select * into v_req from time_off_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_req.status not in ('pending', 'approved') then
    raise exception 'This request was % and can''t be denied.', v_req.status;
  end if;
  v_refund := case when v_req.status = 'approved' then _time_off_deducted(v_req) end;

  update time_off_requests
     set status = 'denied', review_notes = p_notes, reviewed_at = now(), reviewed_by = v_reviewer,
         balance_usage = null, updated_at = now()
   where id = p_request_id returning * into v_req;

  perform _time_off_apply(v_req.employee_id, v_refund, -1);
  return v_req;
end $$;

create or replace function public.cancel_time_off_request(p_request_id uuid)
 returns public.time_off_requests language plpgsql security definer set search_path to 'public'
as $$
declare v_req time_off_requests; v_caller_employee uuid; v_is_admin boolean; v_refund jsonb;
begin
  v_is_admin := get_user_role() in ('admin', 'super_admin');
  select employee_id into v_caller_employee from user_profiles where id = auth.uid();

  select * into v_req from time_off_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;

  if not v_is_admin and v_req.employee_id is distinct from v_caller_employee then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if v_req.status not in ('pending', 'approved') then return v_req; end if;

  -- Once approved leave has started, only HR can change it. Otherwise days
  -- already taken could be refunded.
  if not v_is_admin and v_req.status = 'approved'
     and v_req.start_date <= (now() at time zone 'America/Halifax')::date then
    raise exception 'This time off has already started, so it can''t be cancelled here. Please contact HR.';
  end if;

  v_refund := case when v_req.status = 'approved' then _time_off_deducted(v_req) end;

  update time_off_requests set status = 'cancelled', balance_usage = null, updated_at = now()
   where id = p_request_id returning * into v_req;

  perform _time_off_apply(v_req.employee_id, v_refund, -1);
  return v_req;
end $$;

-- ── Year-end ───────────────────────────────────────────────────────────────

drop function if exists public.rollover_time_off_balances(integer, integer, numeric);

-- Sets up p_year from p_year - 1: copies each employee's entitlement and
-- carries over unused days up to p_carry_cap. Safe to re-run: existing rows
-- keep their used days (and their entitlement, if one was already set) and
-- only carried_over is refreshed. Run it in December so January requests have
-- a balance, then again in early January to settle the final carry-over.
-- Returns the number of balances created or updated.
create or replace function public.start_time_off_year(p_year int, p_carry_cap numeric default 0)
 returns integer language plpgsql security definer set search_path to 'public'
as $$
declare v_count int;
begin
  if get_user_role() not in ('admin', 'super_admin') then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then raise exception 'Invalid year'; end if;

  insert into time_off_balances (employee_id, year, total_days, carried_over, used_days)
  select b.employee_id, p_year, b.total_days,
         greatest(0, least(b.total_days + b.carried_over - b.used_days, greatest(coalesce(p_carry_cap, 0), 0))), 0
    from time_off_balances b
   where b.year = p_year - 1
  on conflict (employee_id, year) do update
     set carried_over = excluded.carried_over,
         total_days = case when time_off_balances.total_days = 0 then excluded.total_days else time_off_balances.total_days end,
         updated_at = now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ── Manager email for notifications ───────────────────────────────────────

create or replace function public.get_my_manager_email()
 returns text language sql stable security definer set search_path to 'public'
as $$
  select m.email
    from user_profiles p
    join employees e on e.id = p.employee_id
    join employees m on m.id = e.manager_id
   where p.id = auth.uid()
$$;

-- ── Row-level security ────────────────────────────────────────────────────

drop policy if exists tor_insert on public.time_off_requests;
create policy tor_insert on public.time_off_requests for insert with check (
  get_user_role() in ('admin', 'super_admin')
  or (
    employee_id = (select employee_id from user_profiles where id = auth.uid())
    and status = 'pending'
    and reviewed_by is null and reviewed_at is null and review_notes is null
    and balance_usage is null
  )
);

drop policy if exists tor_update on public.time_off_requests;
create policy tor_update on public.time_off_requests for update
  using (get_user_role() in ('admin', 'super_admin'))
  with check (get_user_role() in ('admin', 'super_admin'));

drop policy if exists tob_insert on public.time_off_balances;
create policy tob_insert on public.time_off_balances for insert
  with check (get_user_role() in ('admin', 'super_admin'));

drop policy if exists employees_insert_own_tickets on public.tech_support_tickets;
create policy employees_insert_own_tickets on public.tech_support_tickets for insert with check (
  employee_id = (select employee_id from user_profiles where id = auth.uid())
  and status = 'open' and admin_notes is null and resolved_at is null and resolved_by is null
);

-- ── Function privileges ───────────────────────────────────────────────────
-- Supabase grants EXECUTE on new functions to anon and authenticated by
-- default, so set them explicitly.

revoke execute on function public._time_off_apply(uuid, jsonb, int) from public, anon, authenticated;
revoke execute on function public._time_off_deducted(public.time_off_requests) from public, anon, authenticated;
revoke execute on function public.trg_recount_pending_time_off() from public, anon, authenticated;

revoke execute on function public.time_off_year_split(date, date, boolean) from public, anon;
grant execute on function public.time_off_year_split(date, date, boolean) to authenticated;
revoke execute on function public.time_off_split_total(jsonb) from public, anon;
grant execute on function public.time_off_split_total(jsonb) to authenticated;
revoke execute on function public.time_off_counts_against_balance(text) from public, anon;
grant execute on function public.time_off_counts_against_balance(text) to authenticated;
revoke execute on function public.start_time_off_year(int, numeric) from public, anon;
grant execute on function public.start_time_off_year(int, numeric) to authenticated;
revoke execute on function public.get_my_manager_email() from public, anon;
grant execute on function public.get_my_manager_email() to authenticated;
revoke execute on function public.approve_time_off_request(uuid, text) from public, anon;
revoke execute on function public.deny_time_off_request(uuid, text) from public, anon;
revoke execute on function public.cancel_time_off_request(uuid) from public, anon;
