-- Transactional integration checks using synthetic staff only. All fixtures,
-- profile/JWT/role changes and roster edits roll back before this finishes.
-- No Auth API, Edge Function, email send or Microsoft flow is invoked.
-- Requires a database-admin connection and an existing active super-admin
-- profile to serve as the temporary test actor. No production identity or
-- recipient address is embedded in this public test script.
do $tests$
declare
  v_actor uuid;
  v_profile_before jsonb;
  v_employee uuid;
  v_other_employee uuid;
  v_default uuid;
  v_selected uuid;
  v_sister_a uuid;
  v_sister_b uuid;
  v_request uuid;
  v_other_request uuid;
  v_row public.time_off_requests%rowtype;
  v_recipients jsonb;
  v_hr text;
  v_before_count bigint;
  v_roster_before jsonb;
  v_bad record;
begin
  select p.id,to_jsonb(p) into strict v_actor,v_profile_before from public.user_profiles p
  where p.role='super_admin' and not coalesce(p.deactivated,false)
  order by p.created_at,p.id limit 1;
  select value into v_hr from public.system_settings where key='hr_notification_email';
  select count(*) into v_before_count from public.time_off_requests;
  select jsonb_agg(to_jsonb(m) order by m.employee_id) into v_roster_before from public.time_off_managers m;
  if has_function_privilege('anon','public.get_time_off_managers()','execute')
    or has_function_privilege('anon','public.get_time_off_request_recipients(uuid)','execute') then
    raise exception 'Anonymous execution was granted';
  end if;

  begin
    -- Isolate the test roster without publishing or relying on real staff.
    update public.time_off_managers set active=false;
    insert into public.employees(full_name,email,brand)
    values('ROLLBACK TEST Default Manager','default-manager@example.test','ISL') returning id into v_default;
    insert into public.employees(full_name,email,brand)
    values('ROLLBACK TEST Selected Manager','selected-manager@example.test','ISL') returning id into v_selected;
    insert into public.employees(full_name,email,brand)
    values('ROLLBACK TEST Sister A','sister-a@example.test','AS') returning id into v_sister_a;
    insert into public.employees(full_name,email,brand)
    values('ROLLBACK TEST Sister B','sister-b@example.test','ADS') returning id into v_sister_b;
    insert into public.time_off_managers(employee_id,brands) values
      (v_default,array['ISL']),(v_selected,array['ISL']),
      (v_sister_a,array['AS','ADS']),(v_sister_b,array['AS','ADS']);
    insert into public.employees(full_name,email,brand,manager_id)
    values('ROLLBACK TEST Employee','rollback-test@example.test','ISL',v_default) returning id into v_employee;
    insert into public.employees(full_name,email,brand)
    values('ROLLBACK TEST Other','rollback-other@example.test','ISL') returning id into v_other_employee;
    insert into public.time_off_managers(employee_id,brands) values(v_employee,array['ISL']);
    insert into public.time_off_requests(employee_id,start_date,end_date,business_days,type,status,direct_manager_id)
    values(v_other_employee,'2027-01-06','2027-01-06',1,'personal_vacation','pending',v_selected)
    returning id into v_other_request;

    update public.user_profiles set employee_id=v_employee,role='employee',brand='ISL',deactivated=false where id=v_actor;
    perform set_config('request.jwt.claim.sub',v_actor::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    execute 'set local role authenticated';
    if (select count(*) from public.get_time_off_managers())<>2 then raise exception 'ISL company filtering failed'; end if;
    if not exists(select 1 from public.get_time_off_managers() where manager_id=v_default and is_default) then raise exception 'Saved manager was not the default'; end if;
    if (select count(*) from public.employees)<>1 then raise exception 'Employee directory became readable'; end if;
    if (select count(*) from public.time_off_managers)<>0 then raise exception 'Employee can read the raw manager roster'; end if;

    insert into public.time_off_requests(employee_id,start_date,end_date,business_days,type,status,direct_manager_id,direct_manager_name)
    values(v_employee,'2027-01-04','2027-01-04',999,'personal_vacation','pending',v_selected,'Spoofed manager')
    returning * into v_row;
    v_request:=v_row.id;
    if v_row.direct_manager_name<>'ROLLBACK TEST Selected Manager' or v_row.business_days<>1 then raise exception 'Server-derived manager name or day count was not enforced'; end if;
    v_recipients:=public.get_time_off_request_recipients(v_request);
    if v_recipients->>'hr_email' is distinct from trim(v_hr)
       or v_recipients->>'manager_email'<>'selected-manager@example.test' then raise exception 'HR/selected-manager recipients are incorrect'; end if;

    for v_bad in select * from (values
      ('missing',null::uuid,date '2027-01-07'),
      ('wrong company',v_sister_a,date '2027-01-07'),
      ('self',v_employee,date '2027-01-07'),
      ('before January',v_selected,date '2026-12-21')
    ) as bad(label,manager_id,start_date) loop
      begin
        insert into public.time_off_requests(employee_id,start_date,end_date,business_days,type,status,direct_manager_id)
        values(v_employee,v_bad.start_date,v_bad.start_date,1,'personal_vacation','pending',v_bad.manager_id);
        raise exception 'Invalid request accepted: %',v_bad.label;
      exception when invalid_parameter_value then null;
      end;
    end loop;
    begin
      perform public.get_time_off_request_recipients(v_other_request);
      raise exception 'Another employee''s recipients were exposed';
    exception when insufficient_privilege then null;
    end;
    if exists(select 1 from public.time_off_requests where id=v_other_request) then raise exception 'Another employee''s request became readable'; end if;

    execute 'reset role';
    update public.employees set brand='AS' where id=v_employee;
    update public.user_profiles set brand='AS' where id=v_actor;
    execute 'set local role authenticated';
    if (select count(*) from public.get_time_off_managers())<>2
       or not exists(select 1 from public.get_time_off_managers() where manager_id=v_sister_a)
       or not exists(select 1 from public.get_time_off_managers() where manager_id=v_sister_b) then raise exception 'AS company filtering failed'; end if;
    insert into public.time_off_requests(employee_id,start_date,end_date,business_days,type,status,direct_manager_id)
    values(v_employee,'2027-01-08','2027-01-08',1,'volunteer','pending',v_sister_b) returning id into v_request;
    if public.get_time_off_request_recipients(v_request)->>'manager_email'<>'sister-b@example.test' then raise exception 'AS manager route incorrect'; end if;

    execute 'reset role';
    update public.employees set brand='ADS' where id=v_employee;
    update public.user_profiles set brand='ADS' where id=v_actor;
    execute 'set local role authenticated';
    if (select count(*) from public.get_time_off_managers())<>2 then raise exception 'ADS company filtering failed'; end if;

    execute 'reset role';
    update public.user_profiles set role='admin' where id=v_actor;
    execute 'set local role authenticated';
    insert into public.time_off_requests(employee_id,start_date,end_date,business_days,type,status)
    values(v_employee,'2026-12-21','2026-12-21',1,'other','pending');

    execute 'reset role';
    update public.user_profiles set deactivated=true where id=v_actor;
    execute 'set local role authenticated';
    begin
      perform public.get_time_off_managers();
      raise exception 'Deactivated caller could list managers';
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub','',true);
    begin
      perform public.get_time_off_managers();
      raise exception 'Unsigned caller could list managers';
    exception when insufficient_privilege then null;
    end;
    raise exception using errcode='PT999',message='Rollback successful test fixtures';
  exception when sqlstate 'PT999' then null;
  end;

  if (select count(*) from public.time_off_requests)<>v_before_count
    or (select jsonb_agg(to_jsonb(m) order by m.employee_id) from public.time_off_managers m) is distinct from v_roster_before
    or exists(select 1 from public.employees where id in(v_employee,v_other_employee,v_default,v_selected,v_sister_a,v_sister_b))
    or (select to_jsonb(p) from public.user_profiles p where p.id=v_actor) is distinct from v_profile_before then
    raise exception 'Test fixtures were not fully rolled back';
  end if;
end $tests$;
select 'passed: company choices, saved default, selected-manager routing, name/day validation, 2027 cutoff, ownership/RLS, disabled/unsigned callers, historic HR imports and complete fixture rollback' as result;
