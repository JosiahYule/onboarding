-- A half day at either end of a longer request.
--
-- Until now a request had one day_portion for the whole thing, so a partial
-- day could only be a request of its own: the afternoon of Thursday and all of
-- Friday took two requests and two approvals. Now the first and last days each
-- carry their own portion, worded from the employee's side (which part of that
-- day they are off):
--
--   start_portion  'full', or 'pm' (off from the afternoon of the first day)
--   end_portion    'full', or 'am' (back after the morning of the last day)
--
-- Thursday afternoon to Friday is one request, start_portion 'pm', counted as
-- 1.5 business days. On a single-day request both columns hold the same value
-- as day_portion ('full', 'am' or 'pm'), exactly as half days work today.
--
-- Counting stays in the database. time_off_year_split takes half a day off
-- for each partial first or last day, in that day's own year, and only when
-- that day is a business day in the employee's province (half of a holiday is
-- still nothing). Approve, deny and cancel, the balance_usage snapshot and
-- refunds are unchanged: they all work from year_split.
--
-- Rollout: both columns default to 'full', so existing rows and a client that
-- doesn't send them behave exactly as before. A client that only knows
-- day_portion still gets a single-day half day, as it always has.

-- ── 1. Columns ─────────────────────────────────────────────────────────────

alter table public.time_off_requests
  add column if not exists start_portion text not null default 'full',
  add column if not exists end_portion text not null default 'full';

-- Existing single-day half days carry their portion onto both ends. The
-- updated_at trigger is paused so historic rows keep their timestamps.
alter table public.time_off_requests disable trigger tor_updated_at;
update public.time_off_requests
   set start_portion = day_portion, end_portion = day_portion
 where day_portion in ('am', 'pm') and start_date = end_date;
alter table public.time_off_requests enable trigger tor_updated_at;

alter table public.time_off_requests drop constraint if exists time_off_requests_portions_check;
alter table public.time_off_requests add constraint time_off_requests_portions_check check (
  start_portion in ('full', 'am', 'pm') and end_portion in ('full', 'am', 'pm') and (
    (start_date = end_date and start_portion = end_portion)
    or (start_date < end_date and start_portion in ('full', 'pm') and end_portion in ('full', 'am'))
  )
);

-- ── 2. Counting ────────────────────────────────────────────────────────────

-- The four-argument version is replaced; dropping it first keeps calls
-- unambiguous. Calls with three or four arguments (the deployed portal's RPC,
-- older callers) still resolve here through the defaults.
drop function if exists public.time_off_year_split(date, date, boolean, text);

create or replace function public.time_off_year_split(
  p_start date, p_end date, p_half_day boolean default false, p_province text default null,
  p_start_portion text default 'full', p_end_portion text default 'full')
 returns jsonb language plpgsql stable set search_path to 'public'
as $$
declare
  v_split jsonb := '{}'::jsonb;
  v_prov text := p_province;
  v_sp text := coalesce(p_start_portion, 'full');
  v_ep text := coalesce(p_end_portion, 'full');
  y int;
begin
  if v_sp not in ('full', 'am', 'pm') or v_ep not in ('full', 'am', 'pm') then
    raise exception 'A day portion is full, am or pm.' using errcode = '22023';
  end if;
  if p_start is null or p_end is null or p_end < p_start then return v_split; end if;
  if v_prov is null then
    v_prov := employee_province((select employee_id from user_profiles where id = auth.uid()));
  end if;

  -- One part of one day: the original half-day rule.
  if p_half_day or (p_start = p_end and (v_sp <> 'full' or v_ep <> 'full')) then
    return jsonb_build_object(extract(year from p_start)::int::text,
      case when calculate_business_days(p_start, p_start, v_prov) > 0 then 0.5 else 0 end);
  end if;

  for y in extract(year from p_start)::int .. extract(year from p_end)::int loop
    v_split := v_split || jsonb_build_object(y::text,
      calculate_business_days(greatest(p_start, make_date(y, 1, 1)), least(p_end, make_date(y, 12, 31)), v_prov));
  end loop;

  -- A partial first or last day gives back half a day, in that day's year.
  if v_sp <> 'full' and calculate_business_days(p_start, p_start, v_prov) > 0 then
    y := extract(year from p_start)::int;
    v_split := jsonb_set(v_split, array[y::text], to_jsonb((v_split->>y::text)::numeric - 0.5));
  end if;
  if v_ep <> 'full' and calculate_business_days(p_end, p_end, v_prov) > 0 then
    y := extract(year from p_end)::int;
    v_split := jsonb_set(v_split, array[y::text], to_jsonb((v_split->>y::text)::numeric - 0.5));
  end if;
  return v_split;
end $$;

revoke execute on function public.time_off_year_split(date, date, boolean, text, text, text) from public, anon;
grant execute on function public.time_off_year_split(date, date, boolean, text, text, text) to authenticated;

-- ── 3. Keeping each row consistent ─────────────────────────────────────────

create or replace function public.trg_set_business_days()
 returns trigger language plpgsql set search_path to 'public'
as $$
declare v_p text;
begin
  new.start_portion := coalesce(new.start_portion, 'full');
  new.end_portion := coalesce(new.end_portion, 'full');

  -- A client that only knows day_portion sends a half day as day_portion
  -- 'am' or 'pm', which has always meant that one day only.
  if coalesce(new.day_portion, 'full') <> 'full' and new.start_portion = 'full' and new.end_portion = 'full' then
    new.end_date := new.start_date;
  end if;

  if new.start_date = new.end_date then
    -- One day: one portion, held in all three columns.
    v_p := case
      when new.start_portion = new.end_portion and new.start_portion <> 'full' then new.start_portion
      when new.start_portion = 'full' and new.end_portion = 'full' then coalesce(new.day_portion, 'full')
      when new.start_portion = 'full' then new.end_portion
      when new.end_portion = 'full' then new.start_portion
    end;
    if v_p is null then
      raise exception 'For a single day, choose the morning, the afternoon or the whole day.' using errcode = '22023';
    end if;
    new.start_portion := v_p;
    new.end_portion := v_p;
    new.day_portion := v_p;
  else
    if new.start_portion not in ('full', 'pm') then
      raise exception 'The first day of a longer request is either the whole day or the afternoon.' using errcode = '22023';
    end if;
    if new.end_portion not in ('full', 'am') then
      raise exception 'The last day of a longer request is either the whole day or the morning.' using errcode = '22023';
    end if;
    new.day_portion := 'full';
  end if;
  new.is_half_day := new.start_date = new.end_date and new.day_portion <> 'full';

  if tg_op = 'INSERT'
     or new.start_date is distinct from old.start_date
     or new.end_date is distinct from old.end_date
     or new.is_half_day is distinct from old.is_half_day
     or new.start_portion is distinct from old.start_portion
     or new.end_portion is distinct from old.end_portion
     or new.employee_id is distinct from old.employee_id then
    new.year_split := time_off_year_split(new.start_date, new.end_date, new.is_half_day,
      employee_province(new.employee_id), new.start_portion, new.end_portion);
    new.business_days := time_off_split_total(new.year_split);
  end if;
  return new;
end $$;

-- Fire on the portion columns too, not only the dates.
drop trigger if exists tor_set_business_days on public.time_off_requests;
create trigger tor_set_business_days
  before insert or update of start_date, end_date, is_half_day, day_portion, start_portion, end_portion
  on public.time_off_requests
  for each row execute function public.trg_set_business_days();

-- ── 4. Recounts pass the portions through ──────────────────────────────────

create or replace function public._recount_pending_time_off(p_employee uuid default null)
 returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  update time_off_requests r
     set year_split = s.split, business_days = time_off_split_total(s.split)
    from (select id, time_off_year_split(start_date, end_date, is_half_day, employee_province(employee_id),
                                         start_portion, end_portion) as split
            from time_off_requests
           where status = 'pending' and (p_employee is null or employee_id = p_employee)) s
   where r.id = s.id;
end $$;

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
  v_split := time_off_year_split(v_req.start_date, v_req.end_date, v_req.is_half_day,
    employee_province(v_req.employee_id), v_req.start_portion, v_req.end_portion);
  update time_off_requests
     set status = 'approved', review_notes = p_notes, reviewed_at = now(), reviewed_by = v_reviewer,
         year_split = v_split, business_days = time_off_split_total(v_split),
         balance_usage = case when time_off_counts_against_balance(v_req.type) then v_split else '{}'::jsonb end,
         updated_at = now()
   where id = p_request_id returning * into v_req;
  perform _time_off_apply(v_req.employee_id, v_req.balance_usage, 1, time_off_balance_bucket(v_req.type));
  return v_req;
end $$;

notify pgrst, 'reload schema';
