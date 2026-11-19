-- Transactional checks for a partial first or last day on a longer request
-- (migration 20261119150519). Uses one synthetic employee and dates in 2041,
-- away from real bookings, plus a synthetic holiday. Everything rolls back
-- before this finishes. No Auth API, Edge Function or email is involved.
-- Requires a database-admin connection (the SQL editor is fine).
do $tests$
declare
  v_before bigint;
  v_emp uuid;
  r public.time_off_requests%rowtype;
  v_id uuid;
  v_new_year numeric;
begin
  select count(*) into v_before from public.time_off_requests;

  begin
    insert into public.employees(full_name, email, brand) values ('Partial Day Test', null, 'ISL') returning id into v_emp;

    -- Thu Mar 14 afternoon to Fri Mar 15: 1.5
    insert into public.time_off_requests(employee_id, start_date, end_date, business_days, type, status, start_portion, end_portion)
    values (v_emp, '2041-03-14', '2041-03-15', 0, 'personal_vacation', 'pending', 'pm', 'full') returning * into r;
    v_id := r.id;
    if r.business_days <> 1.5 or r.day_portion <> 'full' or r.is_half_day then
      raise exception 'Thu pm to Fri: got % days, day_portion %, half %', r.business_days, r.day_portion, r.is_half_day;
    end if;

    -- Thu Mar 21 afternoon to Tue Mar 26 morning: 4 business days, less two halves = 3
    insert into public.time_off_requests(employee_id, start_date, end_date, business_days, type, status, start_portion, end_portion)
    values (v_emp, '2041-03-21', '2041-03-26', 0, 'other', 'pending', 'pm', 'am') returning * into r;
    if r.business_days <> 3 then raise exception 'Thu pm to Tue am: got %', r.business_days; end if;

    -- The old client shape: day_portion only, still one single half day.
    insert into public.time_off_requests(employee_id, start_date, end_date, business_days, type, status, day_portion)
    values (v_emp, '2041-03-11', '2041-03-13', 0, 'other', 'pending', 'am') returning * into r;
    if r.end_date <> '2041-03-11' or r.business_days <> 0.5 or r.start_portion <> 'am' or r.end_portion <> 'am' then
      raise exception 'Old-client half day: end %, days %, portions %/%', r.end_date, r.business_days, r.start_portion, r.end_portion;
    end if;

    -- Over New Year, each half lands in its own day's year (whatever holidays exist).
    insert into public.time_off_requests(employee_id, start_date, end_date, business_days, type, status, start_portion, end_portion)
    values (v_emp, '2040-12-28', '2041-01-03', 0, 'other', 'pending', 'pm', 'am') returning * into r;
    v_new_year := public.calculate_business_days('2040-12-28', '2040-12-31', 'NS')
      - case when public.calculate_business_days('2040-12-28', '2040-12-28', 'NS') > 0 then 0.5 else 0 end;
    if (r.year_split->>'2040')::numeric <> v_new_year then
      raise exception 'New Year split, 2040: got %, want %', r.year_split->>'2040', v_new_year;
    end if;

    -- A holiday on the Friday leaves only Thursday afternoon; removing it restores 1.5.
    insert into public.company_holidays(date, name, province) values ('2041-03-15', 'Partial day test holiday', 'NS');
    select * into r from public.time_off_requests where id = v_id;
    if r.business_days <> 0.5 then raise exception 'Recount after holiday: got %', r.business_days; end if;
    delete from public.company_holidays where name = 'Partial day test holiday' and date = '2041-03-15';
    select * into r from public.time_off_requests where id = v_id;
    if r.business_days <> 1.5 then raise exception 'Recount after removing holiday: got %', r.business_days; end if;

    -- Shapes that make no sense are refused.
    begin
      insert into public.time_off_requests(employee_id, start_date, end_date, business_days, type, status, start_portion)
      values (v_emp, '2041-04-01', '2041-04-02', 0, 'other', 'pending', 'am');
      raise exception 'A longer request starting with a morning was accepted';
    exception when sqlstate '22023' then null;
    end;
    begin
      insert into public.time_off_requests(employee_id, start_date, end_date, business_days, type, status, end_portion)
      values (v_emp, '2041-04-01', '2041-04-02', 0, 'other', 'pending', 'pm');
      raise exception 'A longer request ending with an afternoon was accepted';
    exception when sqlstate '22023' then null;
    end;

    raise exception using errcode = 'PT999', message = 'Rollback test fixtures';
  exception when sqlstate 'PT999' then null;
  end;

  if (select count(*) from public.time_off_requests) <> v_before
     or exists (select 1 from public.employees where full_name = 'Partial Day Test')
     or exists (select 1 from public.company_holidays where name = 'Partial day test holiday') then
    raise exception 'Test fixtures were not fully rolled back';
  end if;
end $tests$;
select 'passed: partial first/last day counts, old-client half days, New Year split, holiday recount, rejected shapes and complete rollback' as result;
