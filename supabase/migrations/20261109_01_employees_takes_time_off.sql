-- Not everyone on the employee list takes time off through Integrated Launch:
-- the partners don't request it, casual Response Coordinators don't get
-- vacation, and former staff stay on the list for their history. Applied to
-- the ISL-onboarding project on 2026-11-09.
--
-- takes_time_off = false keeps someone off the Balances list, out of the
-- "give everyone without an allowance N days" shortcut and HR's "Log time off"
-- picker, and hides the Time off tab in their own portal. It's set from the
-- Balances tab and can be turned back on at any time. Existing requests and
-- balances are left exactly as they are.

alter table public.employees
  add column if not exists takes_time_off boolean not null default true;

comment on column public.employees.takes_time_off is
  'False for partners, casual staff without vacation, and former staff: they are left out of time off balances and the portal Time off tab.';
