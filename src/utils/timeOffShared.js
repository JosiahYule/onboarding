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

export const STATUS_STYLES = {
  pending:   { background: '#fffbf0', color: '#d4901a' },
  approved:  { background: '#f0faf4', color: '#1a7a4a' },
  denied:    { background: '#fdf0f0', color: '#c04040' },
  cancelled: { background: '#f4f3ef', color: '#70706b' },
}

export function StatusPill({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.pending
  return (
    <span style={{ ...s, fontSize: '11px', fontWeight: 500, padding: '2px 9px', borderRadius: '10px', display: 'inline-block' }}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

export function TypeIcon({ type, size = 13 }) {
  const vb = '0 0 14 14'
  const st = { display: 'block', flexShrink: 0 }
  if (type === 'vacation') return (
    <svg width={size} height={size} viewBox={vb} fill="none" stroke="currentColor" strokeWidth={1.5} style={st}>
      <circle cx="7" cy="7" r="2.5"/>
      <path d="M7 1v2M7 11v2M1 7h2M11 7h2M3.05 3.05l1.41 1.41M9.54 9.54l1.41 1.41M3.05 10.95l1.41-1.41M9.54 4.46l1.41-1.41"/>
    </svg>
  )
  if (type === 'sick') return (
    <svg width={size} height={size} viewBox={vb} fill="none" stroke="currentColor" strokeWidth={1.5} style={st}>
      <circle cx="7" cy="7" r="5"/><path d="M7 4.5v5M4.5 7h5"/>
    </svg>
  )
  if (type === 'personal') return (
    <svg width={size} height={size} viewBox={vb} fill="none" stroke="currentColor" strokeWidth={1.5} style={st}>
      <circle cx="7" cy="5" r="2.5"/><path d="M2 13c0-2.5 2.5-4.5 5-4.5s5 2 5 4.5"/>
    </svg>
  )
  return (
    <svg width={size} height={size} viewBox={vb} fill="currentColor" style={st}>
      <circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/><circle cx="11" cy="7" r="1.2"/>
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
