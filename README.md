# Integrated Launch — Employee Onboarding Portal

A full-featured employee onboarding management system built for **Integrated Staffing Limited**. It guides new hires from their first day through their 90-day review, while giving HR teams, managers, and employees a single place to track every task, document, and request along the way.

---

## What It Does

**For HR & Admins**
- Start a new onboarding in seconds — enter the employee's name, email, role, and start date, and the system builds their entire task plan automatically
- Work through structured checklists organized by phase: Week 1, Week 2, 30-day, 60-day, and 90-day milestones
- Upload and manage required documents per employee and role
- Edit employee details mid-onboarding (including role changes, which swap the task plan automatically)
- Maintain a library of reusable task templates, company resources, and role definitions
- Approve or deny time-off requests, set yearly entitlements and carry-over, and see who's away on a calendar
- Work a queue of tech support tickets from employees

**For Employees**
- A self-service portal to track their own onboarding progress
- View and download company resources and role-specific documents
- Upload required documents directly from the portal
- See manager notes and feedback
- Request time off and see their vacation balance
- Send tech support tickets and follow their status

**For Super Admins**
- Manage all users and their access levels
- Review a full audit log of every action taken in the system
- Configure system-wide settings (HR notification email, tech support email, etc.)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite |
| Backend & Database | Supabase (PostgreSQL + Auth + Edge Functions) |
| Authentication | Supabase Auth with invite-based signup |
| Styling | The shared ISL design system (ClientLaunch's tokens), system font, CSS variables |
| Testing | Vitest & React Testing Library |

---

## How It Works

### Architecture

The app is a React single-page application backed entirely by Supabase. There is no separate server — all data operations go through the Supabase JS client, which handles authentication, database queries, and server-side RPC calls.

```
Browser (React SPA)
    └── App.js              — auth state, session management, page routing
        └── Layout.js       — sidebar nav, role-based menu items, responsive layout
            └── Pages       — each page manages its own Supabase queries and state
                └── Components  — Toast, modals, skeletons, and other shared UI
                    └── Supabase Client
                            — Auth (sign in, invite, password reset)
                            — Database (select, insert, update, delete)
                            — RPC (create_onboarding, swap_employee_and_tasks, insert_audit_log)
                            — Edge Functions (send-email)
```

### Authentication & Access Control

Users are created via invite links. When a new user clicks their invite, they land on `SetPassword` to set their password for the first time. After that, standard email/password login applies.

Every authenticated user has a profile with one of four roles, each with different access:

| Role | Access |
|---|---|
| `employee` | Employee self-service portal only |
| `manager` | Read-only view of the dashboard and onboarding plans (via row-level security on employees, instances, and task completions) |
| `admin` | Dashboard, onboarding management, admin panel, time-off approvals |
| `super_admin` | Everything above plus user management, audit log, system settings |

> Note: time-off approval/denial is restricted to `admin` and `super_admin` in both the UI and row-level security. Managers have read access to onboarding data but do not manage time off.

`App.js` reads the user's role on login and enforces routing — if a user tries to access a page outside their permissions, they are redirected automatically.

### Onboarding Workflow

1. An admin opens **New Onboarding** and fills in the employee's details
2. The app calls the `create_onboarding` Supabase RPC, which creates the employee record, an onboarding instance, and all task completion records for every task in that role's template
3. A welcome email is sent to the new employee via a Supabase Edge Function
4. The action is recorded in the audit log
5. The admin is taken to **Onboarding Plan**, where tasks are grouped by phase and owner (HR, Manager, IT)
6. As tasks are completed, notes can be added and documents uploaded against each task
7. When all phases are done, the onboarding is marked complete

If a role change is needed mid-onboarding, `swap_employee_and_tasks` handles the transition atomically — updating the employee record and replacing the task plan in one operation.

### Time-Off Management

Employees request time off from the **Time off** tab of their portal; HR reviews it on the admin **Time off** page. The rules live in the database (see `supabase/migrations/20261106_01_time_off_launch.sql`), so the app can't drift from them:

- **Only Personal / Vacation uses the yearly balance.** Bereavement, Care Day, Volunteer, PD, Work from Wherever and Other are requested, approved and shown on the calendar the same way, but don't spend days. The list is `time_off_counts_against_balance()` in the database and `BALANCE_TYPES` in `src/utils/timeOffMath.js`; change both together.
- **Business days are counted by the database**, skipping weekends and company holidays. Requests over New Year are split by year (`year_split`), and approval deducts from each year's balance (`balance_usage`). Adding or removing a holiday recounts pending requests; approved ones keep the count they were approved with.
- **Balances:** remaining = entitlement (`total_days`) + `carried_over` − `used_days` − pending vacation. Approvals add to used days automatically; HR can edit all three on the Balances tab (for example, to record days taken before the system went live).
- **Who can do what:** employees can only create *pending* requests, and can cancel approved leave only before it starts. Approve, deny and cancel go through `approve_/deny_/cancel_time_off_request()`, which check the caller's role. HR can also **Log time off** for someone (a sick call, or a person without a portal login).
- **Year end:** on the Balances tab, pick next year and use **Set up 2027 from 2026**. It copies entitlements and carries unused days over up to a limit you set. It's safe to re-run: do it in December so January can be booked, then again in early January to settle carry-over.
- **Holidays that move** (Heritage Day, Good Friday, Natal Day, Labour Day, Thanksgiving) must be added for each year; only tick "repeats" for fixed dates.

Requests email HR and the employee's own manager (found with `get_my_manager_email()`, since employees can't read other employee records). Decisions email the employee.

### Tech Support

Employees send tickets from the **Tech support** tab of their portal, with a category and how badly it's affecting their work. Each ticket is saved first and then emailed to the *Tech support email* in System settings, so a mail failure never loses it. Admins work the queue on the **Tech support** page (Open → In progress → Resolved); a response written there shows on the employee's ticket and is emailed to them on resolve.

### Audit Logging

Every significant action (onboarding created, employee edited, role changed, document uploaded, time-off approved, etc.) is written to an audit log via the `insert_audit_log` RPC. Super admins can filter and review the full log from the system administration panel.

---

## Project Structure

```
src/
├── pages/
│   ├── Dashboard.js        # Active onboardings, completion stats, staff off today
│   ├── Admin.js            # Roles, task templates, documents, task library
│   ├── NewOnboarding.js    # Start a new onboarding
│   ├── OnboardingPlan.js   # Per-employee task checklist and document tracking
│   ├── EmployeePortal.js   # Employee self-service view
│   ├── TimeOff.js          # Time-off requests, balances, calendar, holidays
│   ├── TechSupport.js      # Admin queue for employee tech support tickets
│   ├── SuperAdmin.js       # User management, audit log, system settings
│   └── SetPassword.js      # Invite-based initial password setup
├── components/
│   ├── Layout.js           # Sidebar and navigation (desktop + mobile), built from one list
│   ├── Toast.js            # Success/error/warning notifications
│   ├── ConfirmModal.js     # Confirmation dialogs (built on ui/Modal)
│   ├── EditEmployeeModal.js # Edit employee details and role mid-onboarding
│   └── Skeleton.js         # Loading placeholder screens
├── ui/                     # Shared, theme-aware building blocks — use these, not inline copies
│   ├── theme.js            # Design tokens (T.*) mapped to the CSS variables in styles/tokens.css
│   ├── Brand.js            # The ISL gear, lockup and full logo (ported from ClientLaunch)
│   ├── PageHeader.js       # Title, subtitle, actions and tabs for every page
│   ├── Button.js           # primary / secondary / ghost / danger / danger-outline / link
│   ├── Modal.js            # Dialog with focus trap, focus return, Escape and scroll lock
│   ├── Field.js            # Label + control + hint/error, wired for screen readers
│   ├── Tabs.js, Segmented.js, Menu.js, CheckCircle.js, FileButton.js, SearchInput.js, EmptyState.js
├── hooks/
│   ├── useToast.js         # Toast state management
│   ├── useTheme.js         # Light / dark / system theme
│   └── useWindowSize.js    # Responsive breakpoint detection (mobile < 768px)
├── utils/
│   ├── dates.js            # Date-only values parsed in local time (see "Dates" below)
│   ├── auditLog.js         # Audit log writer
│   ├── timeOffMath.js      # Balance arithmetic shared by the portal, admin page and emails
│   ├── ticketShared.js     # Ticket categories, urgency levels and status pill
│   ├── getHrEmail.js       # Cached system settings fetcher
│   └── handleError.js      # Sanitizes Supabase errors for user display
├── App.js                  # Root component — auth, routing, role enforcement, code-split pages
├── config.js               # Routes, schedule buckets, and the three agencies (BRANDS)
├── supabaseClient.js       # Supabase client initialization
├── styles/
│   ├── tokens.css          # Shared design tokens, COPIED from ClientLaunch; do not edit here
│   └── signin.css          # Shared sign-in split, COPIED from ClientLaunch
└── index.css               # Global styles, plus the few Integrated Launch-only tokens
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- A Supabase project with the required tables, RPC functions, and Edge Functions deployed

### Environment Variables

Copy `.env.example` to `.env` and fill in your Supabase project credentials:

```env
REACT_APP_SUPABASE_URL=https://your-project.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your-anon-key-here
```

### Running Locally

```bash
npm install
npm start
```

The app will be available at `http://localhost:3000`.

### Supabase Edge Functions

The app calls five edge functions. `invite-employee`, `send-email`, `delete-user` and `backup-database` have source in `supabase/functions/` (`delete-user` v2, with the admin role check, was deployed on 2026-09-23); `backup-database` (v2, 2026-09-23) runs weekly from the `weekly-database-backup` pg_cron job, authenticated by a Vault token; see `supabase/migrations/20260923_02_secure_weekly_backup.sql`. `invite-user` still exists only in the deployed project and should be pulled into the repo.

### Building for Production

```bash
npm run build
```

Pages are code-split, so the sign-in screen loads only what it needs; the rest is preloaded in the background after sign-in.

Serve the `build/` folder with any static host, or use the included `serve` package:

```bash
npx serve -s build
```

### Running Tests

```bash
npm test          # run once
npm run test:watch # watch mode
```

---

## Design System

Integrated Launch uses the **shared ISL design system**, the one ClientLaunch
established and ClientWatch also follows. The rules, the reasoning behind them
and the component patterns are written up once, in
[`clientonboarding/docs/design-system.md`](https://github.com/JosiahYule/clientonboarding/blob/main/docs/design-system.md).
Read that before adding a new screen.

How it is wired here:

- `src/styles/tokens.css` is ClientLaunch's token file, **copied unchanged**.
  Never edit it in this repo: change it in ClientLaunch, then copy it into
  Integrated Launch and ClientWatch so the three apps cannot drift apart.
- `src/index.css` imports it and adds the few names Integrated Launch needs
  that ClientLaunch does not have (`--success-border`, `--on-accent`, the
  skeleton colours). Each is built from a shared token, not a new hex value.
- Components read tokens through `T` in `src/ui/theme.js`. **Don't hard-code
  colours, sizes or radii in components**: use `T.*` or `var(--…)`. A hex value
  that looks right in light mode is usually unreadable in dark mode.
- Font sizes come from the eight-step scale only: `var(--text-xs)` (11px)
  through `var(--text-3xl)` (40px), also available as `T.fontSize.*`.

The short version of the rules:

| Rule | What it means in practice |
|---|---|
| White first, hairlines not shadows | Cards are `--surface` with a 1px `--border-card`. No drop shadows on the page; only modals, toasts and drawers get `--shadow-lg`. |
| One radius | 4px everywhere. Circles only where something is genuinely round. |
| People have their own colour | Avatars are a deliberate Integrated Launch exception: initials in a circle, one of eight hues per person, picked from their email so they match everywhere (including their time off calendar bars). Use `<Avatar>` from `src/ui/Avatar.js`. The hues leave out blue, green and amber, which carry status. |
| Three colours carry meaning | ISL blue (`--brand`): brand, primary action, "you are here", in progress. Green: done. Amber: waiting on ISL. Never decorative. |
| Primary buttons are ISL blue | `<Button>` (variant `primary`). Everything else is outlined (`secondary`) or text. |
| System font | `--font-heading` / `--font-body`. Nothing downloaded. |
| The lockup | `<BrandLockup sub="Integrated Launch" />`: the gear, "Integrated Staffing", and the product name underneath. |

### Dates

Postgres `date` columns (start dates, time-off dates) arrive as `"YYYY-MM-DD"` strings. `new Date("2026-09-21")` reads that as midnight UTC, which in Atlantic time is the evening of the 20th, so it displays a day early. Always format them with `formatDate()` from `src/utils/dates.js`, and use `getToday()` from `config.js` for "today". The test suite runs in `America/Halifax` so this class of bug fails CI.

The layout is fully responsive. On desktop, a 240px fixed sidebar handles navigation. On mobile (below 768px), the sidebar becomes a bottom tab bar with a slide-up drawer. All transitions respect `prefers-reduced-motion`.
