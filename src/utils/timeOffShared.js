import { formatDate } from './dates'

export const TYPE_LABELS = {
  personal_vacation: 'Personal / Vacation',
  professional_development: 'Professional Development Training',
  volunteer: 'Volunteer Day',
  work_from_wherever: 'Work from Wherever Week',
  bereavement: 'Bereavement Leave',
  care_day: 'Care Day',
  other: 'Other',
  vacation: 'Vacation',
  sick: 'Sick Day',
  personal: 'Personal',
}

// Theme tokens, so the pills stay legible in dark mode.
export const STATUS_STYLES = {
  pending:   { background: 'var(--warning-bg)', color: 'var(--warning)' },
  approved:  { background: 'var(--success-bg)', color: 'var(--success)' },
  denied:    { background: 'var(--danger-bg)', color: 'var(--danger)' },
  cancelled: { background: 'var(--hover-bg)', color: 'var(--muted)' },
}

export function StatusPill({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.pending
  return (
    <span style={{ ...s, fontSize: '11px', fontWeight: 600, padding: '2px 9px', borderRadius: '99px', display: 'inline-block', whiteSpace: 'nowrap' }}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

// Small line icons per leave type. Legacy types (vacation/sick/personal) map
// onto the same set so old requests still get a sensible icon.
const TYPE_ICON_PATHS = {
  sun: <><circle cx="7" cy="7" r="2.5" /><path d="M7 1v2M7 11v2M1 7h2M11 7h2M3.05 3.05l1.41 1.41M9.54 9.54l1.41 1.41M3.05 10.95l1.41-1.41M9.54 4.46l1.41-1.41" /></>,
  plus: <><circle cx="7" cy="7" r="5" /><path d="M7 4.5v5M4.5 7h5" /></>,
  person: <><circle cx="7" cy="5" r="2.5" /><path d="M2 13c0-2.5 2.5-4.5 5-4.5s5 2 5 4.5" /></>,
  book: <><path d="M2 3.2c1.8-.8 3.5-.8 5 .3 1.5-1.1 3.2-1.1 5-.3v8c-1.8-.8-3.5-.8-5 .3-1.5-1.1-3.2-1.1-5-.3z" /><path d="M7 3.5v8" /></>,
  heart: <path d="M7 12S1.5 8.7 1.5 5.2A2.7 2.7 0 0 1 7 4a2.7 2.7 0 0 1 5.5 1.2C12.5 8.7 7 12 7 12z" />,
  globe: <><circle cx="7" cy="7" r="5.5" /><path d="M1.5 7h11M7 1.5c1.6 1.6 2.3 3.4 2.3 5.5S8.6 10.9 7 12.5C5.4 10.9 4.7 9.1 4.7 7S5.4 3.1 7 1.5z" /></>,
  leaf: <><path d="M2.5 11.5C2.5 6 5.5 2.5 12 2.5c0 6.5-3.5 9.5-9.5 9z" /><path d="M2.5 11.5L8 6" /></>,
}
const TYPE_ICON = {
  personal_vacation: 'sun', vacation: 'sun',
  professional_development: 'book',
  volunteer: 'heart',
  work_from_wherever: 'globe',
  bereavement: 'leaf',
  care_day: 'plus', sick: 'plus',
  personal: 'person',
}

export function TypeIcon({ type, size = 13 }) {
  const paths = TYPE_ICON_PATHS[TYPE_ICON[type]]
  const st = { display: 'block', flexShrink: 0 }
  if (!paths) return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} style={st} aria-hidden="true">
      <circle cx="7" cy="7" r="5" /><path d="M5 7h4" strokeLinecap="round" />
    </svg>
  )
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" style={st} aria-hidden="true">
      {paths}
    </svg>
  )
}

export function fmtDate(iso) {
  return formatDate(iso, { month: 'short', day: 'numeric' })
}

export function fmtDateRange(start, end) {
  const s = fmtDate(start)
  const e = fmtDate(end)
  return s === e ? s : `${s} – ${e}`
}
