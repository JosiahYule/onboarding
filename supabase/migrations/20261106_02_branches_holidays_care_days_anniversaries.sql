-- Branches, provincial holidays, Care days, work anniversaries and the yearly
-- HR import. Follows the HR meeting of 2026-11-06.
--
-- What this does, in plain terms:
--
--  1. Every employee can belong to a branch: Halifax, St. John's,
--     Charlottetown, Moncton or Saint John. A branch decides which province's
--     holidays apply to that person. Until a branch is set, Nova Scotia's
--     holidays are used, since the agencies are Halifax-based.
--
--  2. Holidays can be for one province or for every branch, and are marked
--     statutory, observed, or company (anything HR adds themselves).
--     province_holidays(year) works out the dates of every holiday in HR's
--     handbook table for a year, including the ones that move (Easter, the
--     third Monday in February, and so on). add_province_holidays(year) puts
--     them in the holiday list; it's safe to run twice. 2026 and 2027 are
--     added below.
--
--  3. Business days are counted against the holidays of the person's own
--     province, not one company-wide list. Changing someone's branch recounts
--     their pending requests.
--
--  4. Two yearly allowances instead of one: Personal / Vacation (the existing
--     total_days / used_days) and Care days (new care_days / care_used).
--     Approving a Care Day request now comes off Care days, the way vacation
--     comes off vacation. Carry-over is gone: HR's policy is that unused days
--     don't roll into next year. The carried_over column stays (at 0) so
--     nothing that still reads it breaks, but nothing uses it any more.
--
--  5. Work anniversaries: employees.hire_date is the start date. Once a day,
--     the anniversary-reminders edge function emails the address in the
--     anniversary_notification_email setting about every anniversary in the
--     next 30 days it hasn't already mentioned. anniversary_notifications
--     remembers what was sent, so nobody is mentioned twice and a missed day
--     is caught up the next day. Nothing is sent while the setting is empty.
--
--  6. import_time_off_list(year, rows) applies HR's yearly list (start dates,
--     branches, vacation and Care day allowances) in one transaction.

-- ── 1. Branches ────────────────────────────────────────────────────────────

alter table public.employees add column if not exists branch text;
alter table public.employees drop constraint if exists employees_branch_check;
alter table public.employees add constraint employees_branch_check
  check (branch is null or branch in ('halifax', 'st_johns', 'charlottetown', 'moncton', 'saint_john'));

comment on column public.employees.branch is
  'Office the person works from. Decides which province''s holidays apply (see branch_province). Null counts as Halifax.';
comment on column public.employees.hire_date is
  'Start date with the company. Drives onboarding and work anniversaries.';

-- Province codes match company_holidays.province.
create or replace function public.branch_province(p_branch text)
 returns text language sql immutable set search_path to 'public'
as $$
  select case p_branch
    when 'st_johns' then 'NL'
    when 'charlottetown' then 'PE'
    when 'moncton' then 'NB'
    when 'saint_john' then 'NB'
    else 'NS'
  end
$$;

-- An employee's province. SECURITY DEFINER because the business-day trigger
-- runs as whoever inserts the request; it returns only a province code.
create or replace function public.employee_province(p_employee uuid)
 returns text language sql stable security definer set search_path to 'public'
as $$
  select coalesce((select branch_province(branch) from employees where id = p_employee), 'NS')
$$;

-- ── 2. Holidays ────────────────────────────────────────────────────────────

alter table public.company_holidays
  add column if not exists province text,
  add column if not exists kind text not null default 'company',
  add column if not exists note text;

alter table public.company_holidays drop constraint if exists company_holidays_province_check;
alter table public.company_holidays add constraint company_holidays_province_check
  check (province is null or province in ('NS', 'NB', 'NL', 'PE'));
alter table public.company_holidays drop constraint if exists company_holidays_kind_check;
alter table public.company_holidays add constraint company_holidays_kind_check
  check (kind in ('statutory', 'observed', 'company'));

comment on column public.company_holidays.province is 'NS, NB, NL or PE. Null means every branch.';
comment on column public.company_holidays.kind is 'statutory or observed (from the handbook), or company for anything else HR adds.';

-- Dates were unique on their own, which can't hold once each province has its
-- own row for the same day (Christmas x 4). Unique per date, name and province.
alter table public.company_holidays drop constraint if exists company_holidays_date_key;
create unique index if not exists company_holidays_unique_day
  on public.company_holidays (date, name, coalesce(province, '*'));

-- Easter Sunday (the anonymous Gregorian algorithm).
create or replace function public._easter_sunday(y int)
 returns date language plpgsql immutable set search_path to 'public'
as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int;
begin
  a := y % 19; b := y / 100; c := y % 100; d := b / 4; e := b % 4;
  f := (b + 8) / 25; g := (b - f + 1) / 3; h := (19 * a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  return make_date(y, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
end $$;

-- The nth weekday of a month. dow: 0 = Sunday ... 6 = Saturday.
create or replace function public._nth_weekday(y int, m int, dow int, n int)
 returns date language sql immutable set search_path to 'public'
as $$
  select make_date(y, m, 1)
       + ((dow - extract(dow from make_date(y, m, 1))::int + 7) % 7)
       + 7 * (n - 1)
$$;

-- A fixed-date holiday that lands on a weekend is given on the Monday after,
-- as the handbook says ("provided a holiday with pay on another day").
create or replace function public._weekday_or_monday(d date)
 returns date language sql immutable set search_path to 'public'
as $$
  select case extract(dow from d)::int when 6 then d + 2 when 0 then d + 1 else d end
$$;

-- Every holiday in HR's handbook table for one year, one row per province.
-- S = statutory, O = observed, as in the handbook. Edit this list to change
-- what add_province_holidays() adds in future years.
create or replace function public.province_holidays(p_year int)
 returns table(date date, name text, province text, kind text, note text)
 language plpgsql immutable set search_path to 'public'
as $$
declare
  v_easter date := _easter_sunday(p_year);
  v_xmas date := _weekday_or_monday(make_date(p_year, 12, 25));
  v_boxing date := _weekday_or_monday(make_date(p_year, 12, 26));
begin
  -- Christmas on a Saturday moves to Monday, and Boxing Day (Sunday) then
  -- moves to Tuesday, so they never share a day.
  if v_boxing <= v_xmas then v_boxing := v_xmas + 1; end if;

  return query
  with h(hname, hdate, fixed_date, ns, nb, nl, pe, hnote) as (values
    ('New Year''s Day',               make_date(p_year, 1, 1),        make_date(p_year, 1, 1),  'S', 'S', 'S', 'S', null::text),
    ('Heritage Day',                  _nth_weekday(p_year, 2, 1, 3),  null::date,               'S', null, null, null, null),
    ('Family Day',                    _nth_weekday(p_year, 2, 1, 3),  null,                     null, 'S', 'O', null, null),
    ('Islander Day',                  _nth_weekday(p_year, 2, 1, 3),  null,                     null, null, null, 'S', null),
    ('Good Friday',                   v_easter - 2,                   null,                     'S', 'S', 'S', 'S', null),
    ('Easter Monday',                 v_easter + 1,                   null,                     'O', 'O', 'O', 'O', null),
    -- The Monday before May 25.
    ('Victoria Day',                  make_date(p_year, 5, 24) - ((extract(dow from make_date(p_year, 5, 24))::int + 6) % 7), null, 'O', 'O', 'O', 'O', null),
    ('Canada Day',                    make_date(p_year, 7, 1),        make_date(p_year, 7, 1),  'S', 'S', 'S', 'S', null),
    ('Natal Day',                     _nth_weekday(p_year, 8, 1, 1),  null,                     'O', null, null, null, null),
    ('New Brunswick Day',             _nth_weekday(p_year, 8, 1, 1),  null,                     null, 'S', null, null, null),
    ('Regatta Day',                   _nth_weekday(p_year, 8, 3, 1),  null,                     null, null, 'O', null, 'Weather permitting. Moves if the Royal St. John''s Regatta is postponed.'),
    ('Gold Cup Parade Day',           _nth_weekday(p_year, 8, 5, 3),  null,                     null, null, null, 'O', null),
    ('Labour Day',                    _nth_weekday(p_year, 9, 1, 1),  null,                     'S', 'S', 'S', 'S', null),
    ('Truth and Reconciliation Day',  make_date(p_year, 9, 30),       make_date(p_year, 9, 30), 'O', 'O', 'O', 'O', null),
    ('Thanksgiving',                  _nth_weekday(p_year, 10, 1, 2), null,                     'O', 'O', 'O', 'O', null),
    ('Remembrance Day',               make_date(p_year, 11, 11),      make_date(p_year, 11, 11),'O', 'S', 'S', 'S', null),
    ('Christmas Day',                 v_xmas,                         make_date(p_year, 12, 25),'S', 'S', 'S', 'S', null),
    ('Boxing Day',                    v_boxing,                       make_date(p_year, 12, 26),'O', 'O', 'O', 'O', null)
  ),
  shifted as (
    select hname,
           case when fixed_date is null or hname in ('Christmas Day', 'Boxing Day') then hdate
                else _weekday_or_monday(hdate) end as d,
           fixed_date, ns, nb, nl, pe, hnote
      from h
  )
  select s.d,
         case when s.fixed_date is not null and s.d <> s.fixed_date then s.hname || ' (observed)' else s.hname end,
         p.prov,
         case p.k when 'S' then 'statutory' else 'observed' end,
         s.hnote
    from shifted s
    cross join lateral (values ('NS', s.ns), ('NB', s.nb), ('NL', s.nl), ('PE', s.pe)) as p(prov, k)
   where p.k is not null
   order by 1, 2, 3;
end $$;

-- Adds a year's handbook holidays to the list. Safe to re-run: holidays
-- already there (same date, name and province) are left alone, so anything HR
-- removed on purpose stays removed only until this is run again for that year.
-- Returns how many holidays were added.
create or replace function public.add_province_holidays(p_year int)
 returns integer language plpgsql security definer set search_path to 'public'
as $$
declare v_count int;
begin
  if coalesce(get_user_role(), '') not in ('admin', 'super_admin') then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then raise exception 'Invalid year'; end if;

  insert into company_holidays (date, name, province, kind, note, repeats_yearly)
  select date, name, province, kind, note, false from province_holidays(p_year)
  on conflict (date, name, coalesce(province, '*')) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ── 3. Business days, per province ────────────────────────────────────────

-- The old two-argument versions are replaced; dropping them first keeps the
-- calls unambiguous now that the province is an optional extra argument.
drop function if exists public.calculate_business_days(date, date);
drop function if exists public.time_off_year_split(date, date, boolean);

create or replace function public.calculate_business_days(p_start date, p_end date, p_province text default 'NS')
 returns numeric language sql stable set search_path to 'public'
as $$
  select count(*)::numeric
  from generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') as d
  where extract(dow from d) not in (0, 6)
    and not exists (
      select 1 from company_holidays h
      where (h.province is null or h.province = coalesce(p_province, 'NS'))
        and (h.date = d::date
             or (h.repeats_yearly
                 and extract(month from h.date) = extract(month from d)
                 and extract(day from h.date) = extract(day from d))))
$$;

-- Business days per year. With no province given, uses the caller's own
-- (so the employee portal's live count matches what HR will approve).
create or replace function public.time_off_year_split(p_start date, p_end date, p_half_day boolean default false, p_province text default null)
 returns jsonb language plpgsql stable set search_path to 'public'
as $$
declare
  v_split jsonb := '{}'::jsonb;
  v_prov text := p_province;
  y int;
begin
  if p_start is null or p_end is null or p_end < p_start then return v_split; end if;
  if v_prov is null then
    v_prov := employee_province((select employee_id from user_profiles where id = auth.uid()));
  end if;
  if p_half_day then
    return jsonb_build_object(extract(year from p_start)::int::text,
      case when calculate_business_days(p_start, p_start, v_prov) > 0 then 0.5 else 0 end);
  end if;
  for y in extract(year from p_start)::int .. extract(year from p_end)::int loop
    v_split := v_split || jsonb_build_object(y::text,
      calculate_business_days(greatest(p_start, make_date(y, 1, 1)), least(p_end, make_date(y, 12, 31)), v_prov));
  end loop;
  return v_split;
end $$;

create or replace function public.trg_set_business_days()
 returns trigger language plpgsql set search_path to 'public'
as $$
begin
  new.is_half_day := coalesce(new.day_portion, 'full') <> 'full';
  if new.is_half_day then new.end_date := new.start_date; end if;

  if tg_op = 'INSERT'
     or new.start_date is distinct from old.start_date
     or new.end_date is distinct from old.end_date
     or new.is_half_day is distinct from old.is_half_day
     or new.employee_id is distinct from old.employee_id then
    new.year_split := time_off_year_split(new.start_date, new.end_date, new.is_half_day, employee_province(new.employee_id));
    new.business_days := time_off_split_total(new.year_split);
  end if;
  return new;
end $$;

-- Recounts pending requests, optionally for one employee only.
create or replace function public._recount_pending_time_off(p_employee uuid default null)
 returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  update time_off_requests r
     set year_split = s.split, business_days = time_off_split_total(s.split)
    from (select id, time_off_year_split(start_date, end_date, is_half_day, employee_province(employee_id)) as split
            from time_off_requests
           where status = 'pending' and (p_employee is null or employee_id = p_employee)) s
   where r.id = s.id;
end $$;

create or replace function public.trg_recount_pending_time_off()
 returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  perform _recount_pending_time_off(null);
  return null;
end $$;

create or replace function public.trg_employee_branch_recount()
 returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.branch is distinct from old.branch then
    perform _recount_pending_time_off(new.id);
  end if;
  return null;
end $$;

drop trigger if exists employees_branch_recount on public.employees;
create trigger employees_branch_recount after update of branch on public.employees
  for each row execute function public.trg_employee_branch_recount();

-- ── 4. Two allowances: Personal / Vacation and Care days ──────────────────

alter table public.time_off_balances
  add column if not exists care_days numeric not null default 0,
  add column if not exists care_used numeric not null default 0;

comment on column public.time_off_balances.total_days is 'Personal / Vacation days for the year.';
comment on column public.time_off_balances.used_days is 'Personal / Vacation days used (approvals add to it).';
comment on column public.time_off_balances.care_days is 'Care days for the year.';
comment on column public.time_off_balances.care_used is 'Care days used (approvals add to it).';
comment on column public.time_off_balances.carried_over is
  'No longer used: unused days do not carry over. Kept at 0 so older code that reads it still works.';

-- Which allowance a type of leave comes out of, or null for none.
-- 'vacation' and 'sick' are legacy names.
create or replace function public.time_off_balance_bucket(p_type text)
 returns text language sql immutable set search_path to 'public'
as $$
  select case
    when p_type in ('personal_vacation', 'vacation') then 'vacation'
    when p_type in ('care_day', 'sick') then 'care'
  end
$$;

create or replace function public.time_off_counts_against_balance(p_type text)
 returns boolean language sql immutable set search_path to 'public'
as $$ select time_off_balance_bucket(p_type) is not null $$;

drop function if exists public._time_off_apply(uuid, jsonb, int);
create or replace function public._time_off_apply(p_employee uuid, p_usage jsonb, p_sign int, p_bucket text)
 returns void language plpgsql set search_path to 'public'
as $$
declare r record;
begin
  if p_bucket is null then return; end if;
  for r in select key::int as yr, value::numeric as days from jsonb_each_text(coalesce(p_usage, '{}'::jsonb)) loop
    continue when r.days = 0;
    if p_sign > 0 then
      insert into time_off_balances (employee_id, year, total_days, used_days, care_used)
      values (p_employee, r.yr, 0,
              case when p_bucket = 'vacation' then r.days else 0 end,
              case when p_bucket = 'care' then r.days else 0 end)
      on conflict (employee_id, year) do update
        set used_days = time_off_balances.used_days + excluded.used_days,
            care_used = time_off_balances.care_used + excluded.care_used,
            updated_at = now();
    else
      update time_off_balances
         set used_days = case when p_bucket = 'vacation' then greatest(0, used_days - r.days) else used_days end,
             care_used = case when p_bucket = 'care' then greatest(0, care_used - r.days) else care_used end,
             updated_at = now()
       where employee_id = p_employee and year = r.yr;
    end if;
  end loop;
end $$;

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

  -- Recount now, against the person's own province, so holidays added since
  -- the request was made are respected.
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

  perform _time_off_apply(v_req.employee_id, v_refund, -1, time_off_balance_bucket(v_req.type));
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

  if not v_is_admin and v_req.status = 'approved'
     and v_req.start_date <= (now() at time zone 'America/Halifax')::date then
    raise exception 'This time off has already started, so it can''t be cancelled here. Please contact HR.';
  end if;

  v_refund := case when v_req.status = 'approved' then _time_off_deducted(v_req) end;

  update time_off_requests set status = 'cancelled', balance_usage = null, updated_at = now()
   where id = p_request_id returning * into v_req;

  perform _time_off_apply(v_req.employee_id, v_refund, -1, time_off_balance_bucket(v_req.type));
  return v_req;
end $$;

-- Year-end: copies each person's two allowances into the next year. No
-- carry-over. Safe to re-run: an allowance already set for p_year is kept.
drop function if exists public.start_time_off_year(int, numeric);
create or replace function public.start_time_off_year(p_year int)
 returns integer language plpgsql security definer set search_path to 'public'
as $$
declare v_count int;
begin
  if get_user_role() not in ('admin', 'super_admin') then
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

-- ── 5. Work anniversaries ─────────────────────────────────────────────────

insert into public.system_settings (key, value)
values ('anniversary_notification_email', '')
on conflict (key) do nothing;

create table if not exists public.anniversary_notifications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  anniversary_date date not null,
  years int not null,
  sent_to text,
  sent_at timestamptz not null default now(),
  unique (employee_id, anniversary_date)
);
comment on table public.anniversary_notifications is
  'One row per anniversary reminder emailed, so each anniversary is mentioned once.';

alter table public.anniversary_notifications enable row level security;
drop policy if exists anniversary_notifications_admin_read on public.anniversary_notifications;
create policy anniversary_notifications_admin_read on public.anniversary_notifications for select
  using (get_user_role() in ('admin', 'super_admin'));

-- Each employee's next work anniversary on or after p_today, if it falls
-- within p_days. Someone who started on Feb 29 is marked on Feb 28 in other
-- years. People whose login is deactivated are left out.
create or replace function public._upcoming_anniversaries(p_today date, p_days int)
 returns table(employee_id uuid, full_name text, email text, brand text, branch text,
               hire_date date, anniversary_date date, years int, days_away int)
 language sql stable security definer set search_path to 'public'
as $$
  with base as (
    select e.*,
           (select make_date(y, extract(month from e.hire_date)::int,
                    least(extract(day from e.hire_date)::int,
                          extract(day from (make_date(y, extract(month from e.hire_date)::int, 1) + interval '1 month - 1 day'))::int))
              from (select extract(year from p_today)::int as y) t) as this_year
      from employees e
     where e.hire_date is not null
       and not exists (select 1 from user_profiles p where p.employee_id = e.id and coalesce(p.deactivated, false))
  ),
  nxt as (
    select b.*,
           case when b.this_year >= p_today then b.this_year
                else make_date(extract(year from p_today)::int + 1, extract(month from b.hire_date)::int,
                       least(extract(day from b.hire_date)::int,
                             extract(day from (make_date(extract(year from p_today)::int + 1, extract(month from b.hire_date)::int, 1) + interval '1 month - 1 day'))::int))
           end as ann
      from base b
  )
  select id, full_name, email, brand, branch, hire_date, ann,
         (extract(year from ann) - extract(year from hire_date))::int,
         (ann - p_today)::int
    from nxt
   where ann <= p_today + p_days
     and extract(year from ann) > extract(year from hire_date)
   order by ann, full_name
$$;

-- For the app: upcoming anniversaries, admins only.
create or replace function public.upcoming_anniversaries(p_days int default 30)
 returns table(employee_id uuid, full_name text, email text, brand text, branch text,
               hire_date date, anniversary_date date, years int, days_away int)
 language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if get_user_role() not in ('admin', 'super_admin') then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  return query select * from _upcoming_anniversaries((now() at time zone 'America/Halifax')::date, least(greatest(coalesce(p_days, 30), 1), 366));
end $$;

-- For the edge function (service role only): anniversaries in the next 30
-- days that haven't been emailed yet.
create or replace function public.due_anniversary_reminders()
 returns table(employee_id uuid, full_name text, email text, brand text, branch text,
               hire_date date, anniversary_date date, years int, days_away int)
 language sql stable security definer set search_path to 'public'
as $$
  select a.* from _upcoming_anniversaries((now() at time zone 'America/Halifax')::date, 30) a
   where not exists (select 1 from anniversary_notifications n
                      where n.employee_id = a.employee_id and n.anniversary_date = a.anniversary_date)
$$;

-- Records what the edge function emailed. p_items: [{employee_id, anniversary_date, years}].
create or replace function public.mark_anniversary_reminders_sent(p_items jsonb, p_sent_to text)
 returns integer language plpgsql security definer set search_path to 'public'
as $$
declare v_count int;
begin
  insert into anniversary_notifications (employee_id, anniversary_date, years, sent_to)
  select (i->>'employee_id')::uuid, (i->>'anniversary_date')::date, (i->>'years')::int, p_sent_to
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
  on conflict (employee_id, anniversary_date) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- The daily job's token, made the same way as the backup job's.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'anniversary_cron_token') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'anniversary_cron_token',
      'Lets the daily-anniversary-reminders cron job call the anniversary-reminders edge function. Grants nothing else.'
    );
  end if;
end $$;

create or replace function public.verify_anniversary_token(p_token text)
 returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(
    length(p_token) > 0 and exists (
      select 1 from vault.decrypted_secrets
      where name = 'anniversary_cron_token' and decrypted_secret = p_token
    ),
    false
  )
$$;

-- Daily at 12:10 UTC (9:10 am Halifax in summer, 8:10 am in winter).
select cron.schedule(
  'daily-anniversary-reminders',
  '10 12 * * *',
  $cmd$
  select net.http_post(
    url := 'https://gqgjnltqbomtefryqlua.supabase.co/functions/v1/anniversary-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxZ2pubHRxYm9tdGVmcnlxbHVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNDQwNDAsImV4cCI6MjA5MTkyMDA0MH0.FS8xUisIdPRKHLlKWHLR2H3Vt4iOLGkMVuJAzUvIvVw',
      'x-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'anniversary_cron_token' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cmd$
);

-- ── 6. HR's yearly list ───────────────────────────────────────────────────

-- p_rows: [{employee_id, start_date?, branch?, vacation_days?, care_days?}].
-- A field left out (or null) is left as it is. Allowances go into p_year,
-- keeping whatever has already been used. All or nothing.
create or replace function public.import_time_off_list(p_year int, p_rows jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare r jsonb; v_emp uuid; v_people int := 0; v_balances int := 0;
begin
  if get_user_role() not in ('admin', 'super_admin') then
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

-- ── Data ───────────────────────────────────────────────────────────────────

-- The single holiday on file was a repeating, company-wide Canada Day. The
-- handbook holidays below include Canada Day for every province, with the
-- weekend rule applied, so the old row would only double up.
delete from public.company_holidays where name = 'Canada Day' and repeats_yearly and province is null;

-- Inserted directly: add_province_holidays() is for signed-in admins only.
insert into public.company_holidays (date, name, province, kind, note, repeats_yearly)
select date, name, province, kind, note, false
  from public.province_holidays(2026) union all
select date, name, province, kind, note, false
  from public.province_holidays(2027)
on conflict (date, name, coalesce(province, '*')) do nothing;

-- ── Function privileges ───────────────────────────────────────────────────

revoke execute on function public._easter_sunday(int) from public, anon;
revoke execute on function public._nth_weekday(int, int, int, int) from public, anon;
revoke execute on function public._weekday_or_monday(date) from public, anon;
revoke execute on function public.province_holidays(int) from public, anon;
grant execute on function public.province_holidays(int) to authenticated;
revoke execute on function public.add_province_holidays(int) from public, anon;
grant execute on function public.add_province_holidays(int) to authenticated;

revoke execute on function public.branch_province(text) from public, anon;
grant execute on function public.branch_province(text) to authenticated;
revoke execute on function public.employee_province(uuid) from public, anon;
grant execute on function public.employee_province(uuid) to authenticated;

revoke execute on function public.calculate_business_days(date, date, text) from public, anon;
grant execute on function public.calculate_business_days(date, date, text) to authenticated;
revoke execute on function public.time_off_year_split(date, date, boolean, text) from public, anon;
grant execute on function public.time_off_year_split(date, date, boolean, text) to authenticated;

revoke execute on function public._recount_pending_time_off(uuid) from public, anon, authenticated;
revoke execute on function public.trg_employee_branch_recount() from public, anon, authenticated;
revoke execute on function public.trg_recount_pending_time_off() from public, anon, authenticated;
revoke execute on function public._time_off_apply(uuid, jsonb, int, text) from public, anon, authenticated;

revoke execute on function public.time_off_balance_bucket(text) from public, anon;
grant execute on function public.time_off_balance_bucket(text) to authenticated;
revoke execute on function public.time_off_counts_against_balance(text) from public, anon;
grant execute on function public.time_off_counts_against_balance(text) to authenticated;
revoke execute on function public.approve_time_off_request(uuid, text) from public, anon;
revoke execute on function public.deny_time_off_request(uuid, text) from public, anon;
revoke execute on function public.cancel_time_off_request(uuid) from public, anon;
revoke execute on function public.start_time_off_year(int) from public, anon;
grant execute on function public.start_time_off_year(int) to authenticated;

revoke execute on function public._upcoming_anniversaries(date, int) from public, anon, authenticated;
revoke execute on function public.upcoming_anniversaries(int) from public, anon;
grant execute on function public.upcoming_anniversaries(int) to authenticated;
revoke execute on function public.due_anniversary_reminders() from public, anon, authenticated;
grant execute on function public.due_anniversary_reminders() to service_role;
revoke execute on function public.mark_anniversary_reminders_sent(jsonb, text) from public, anon, authenticated;
grant execute on function public.mark_anniversary_reminders_sent(jsonb, text) to service_role;
revoke all on function public.verify_anniversary_token(text) from public, anon, authenticated;
grant execute on function public.verify_anniversary_token(text) to service_role;

revoke execute on function public.import_time_off_list(int, jsonb) from public, anon;
grant execute on function public.import_time_off_list(int, jsonb) to authenticated;
