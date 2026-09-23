import { toLocalISODate } from './utils/dates'

export const BRAND = {
  name: 'Integrated Launch',
  company: 'Integrated Staffing Limited'
}

// The onboarding schedule. The first two weeks are broken into individual
// business days (Day 1–Day 10); after that come weekly buckets and the
// longer-range milestones. This ordered list is the source of truth for
// how tasks are bucketed and drag-and-dropped.
export const DAY_BUCKETS = ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7', 'Day 8', 'Day 9', 'Day 10']
export const WEEK_BUCKETS = ['Week 3', 'Week 4']
export const MILESTONE_BUCKETS = ['30 Day', '60 Day', '90 Day']
export const SCHEDULE_BUCKETS = [...DAY_BUCKETS, ...WEEK_BUCKETS, ...MILESTONE_BUCKETS]

// Days are grouped under a week heading for scannability; each entry's
// `buckets` are the individual drop targets rendered under that heading.
export const BUCKET_SECTIONS = [
  { label: 'Week 1', buckets: ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5'] },
  { label: 'Week 2', buckets: ['Day 6', 'Day 7', 'Day 8', 'Day 9', 'Day 10'] },
  { label: 'Week 3', buckets: ['Week 3'] },
  { label: 'Week 4', buckets: ['Week 4'] },
  { label: 'Milestones', buckets: ['30 Day', '60 Day', '90 Day'] },
]

// Kept as an alias so existing imports keep working; represents every bucket.
export const PHASES = SCHEDULE_BUCKETS

// Computed on call, not at module load, so a long-lived tab doesn't keep using
// yesterday's date or last year after midnight / New Year. Local, not UTC:
// toISOString() would roll over to tomorrow at 8-9pm Atlantic time.
export function getToday() {
  return toLocalISODate()
}
export function getCurrentYear() {
  return new Date().getFullYear()
}

// Feature flags for surfaces that are built but not yet launched. Flipping a
// flag to true is all it takes to enable the corresponding UI.
export const FEATURES = {
  employeeTimeOff: false,
  techSupport: false,
}

export const ROUTES = {
  DASHBOARD: '/dashboard',
  ACTIVE: '/active',
  NEW_ONBOARDING: '/onboarding/new',
  PLAN: '/onboarding/plan',
  TEMPLATES: '/templates',
  DOCUMENTS: '/documents',
  ROLES: '/roles',
  HISTORY: '/history',
  TIME_OFF: '/time-off',
  COMPANY_RESOURCES: '/company-resources',
  SET_PASSWORD: '/set-password',
  SUPER_ADMIN_USERS: '/system/users',
  SUPER_ADMIN_AUDIT: '/system/audit',
  SUPER_ADMIN_SETTINGS: '/system/settings'
}

// The plan route carries the onboarding instance id so the page is
// deep-linkable and survives a refresh: /onboarding/plan/<id>.
export function planPath(instanceId) {
  return instanceId ? `${ROUTES.PLAN}/${instanceId}` : ROUTES.PLAN
}
export function parseInstanceId(pathname) {
  if (pathname.startsWith(ROUTES.PLAN + '/')) {
    return pathname.slice(ROUTES.PLAN.length + 1) || null
  }
  return null
}

export function pathToPage(pathname) {
  if (pathname === ROUTES.ACTIVE) return 'new-onboarding-select'
  if (pathname === ROUTES.NEW_ONBOARDING) return 'new-onboarding'
  if (pathname === ROUTES.PLAN || pathname.startsWith(ROUTES.PLAN + '/')) return 'plan'
  if (pathname === ROUTES.TEMPLATES) return 'templates'
  if (pathname === ROUTES.DOCUMENTS) return 'documents'
  if (pathname === ROUTES.COMPANY_RESOURCES) return 'company-resources'
  if (pathname === ROUTES.ROLES) return 'roles'
  if (pathname === ROUTES.HISTORY) return 'history'
  if (pathname === ROUTES.TIME_OFF) return 'time-off'
  if (pathname === ROUTES.SET_PASSWORD) return 'set-password'
  if (pathname === ROUTES.SUPER_ADMIN_USERS) return 'super-admin-users'
  if (pathname === ROUTES.SUPER_ADMIN_AUDIT) return 'super-admin-audit'
  if (pathname === ROUTES.SUPER_ADMIN_SETTINGS) return 'super-admin-settings'
  return 'dashboard'
}

export function pageToPath(page) {
  if (page === 'new-onboarding-select') return ROUTES.ACTIVE
  if (page === 'new-onboarding') return ROUTES.NEW_ONBOARDING
  if (page === 'plan') return ROUTES.PLAN
  if (page === 'templates') return ROUTES.TEMPLATES
  if (page === 'documents') return ROUTES.DOCUMENTS
  if (page === 'company-resources') return ROUTES.COMPANY_RESOURCES
  if (page === 'roles') return ROUTES.ROLES
  if (page === 'history') return ROUTES.HISTORY
  if (page === 'time-off') return ROUTES.TIME_OFF
  if (page === 'set-password') return ROUTES.SET_PASSWORD
  if (page === 'super-admin-users') return ROUTES.SUPER_ADMIN_USERS
  if (page === 'super-admin-audit') return ROUTES.SUPER_ADMIN_AUDIT
  if (page === 'super-admin-settings') return ROUTES.SUPER_ADMIN_SETTINGS
  return ROUTES.DASHBOARD
}

export const ONBOARDING_STATUS = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  ARCHIVED: 'archived',
}

export const TIME_OFF_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  DENIED: 'denied',
  CANCELLED: 'cancelled',
}

export const ROLE = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  MANAGER: 'manager',
  EMPLOYEE: 'employee',
}
