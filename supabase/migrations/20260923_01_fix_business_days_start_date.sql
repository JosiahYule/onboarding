-- Mirrors migration 20260923183030 fix_business_days_start_date, applied to the
-- ISL-onboarding project on 2026-09-23.
--
-- calculate_business_days() started its series at p_start + 1 day, so the
-- first day of every request was never counted. Verified on the live project
-- on 2026-09-23:
--   calculate_business_days('2026-09-21', '2026-09-25')  -- Mon..Fri  -> 4 (should be 5)
--   calculate_business_days('2026-09-21', '2026-09-21')  -- one Monday -> 0 (should be 1)
-- trg_set_business_days() stores this value on every full-day request, and
-- approvals add it to time_off_balances.used_days, so balances were too high.
--
-- This counts the start date itself. Weekends and company holidays are still
-- excluded exactly as before. Existing rows keep their stored business_days
-- until they're next updated; see the optional backfill at the bottom.

CREATE OR REPLACE FUNCTION public.calculate_business_days(p_start date, p_end date)
 RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  select count(*)::numeric
  from generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') as d
  where extract(dow from d) not in (0, 6)
    and not exists (
      select 1 from company_holidays h
      where h.date = d::date
         or (h.repeats_yearly
             and extract(month from h.date) = extract(month from d)
             and extract(day from h.date) = extract(day from d)))
$function$;

-- Backfill was not needed when this was applied: the only full-day request on
-- record (Jun 22-26, stored as 4 days) is cancelled, so no balance used the
-- wrong count. If you ever need it, this recomputes pending requests only.
-- Approved requests have already been added to used_days, so correct those
-- balances deliberately rather than in bulk.
--
-- UPDATE public.time_off_requests
--    SET business_days = public.calculate_business_days(start_date, end_date)
--  WHERE is_half_day IS NOT TRUE AND status = 'pending';
