// Labels and the status pill for tech support tickets, shared by the
// employee portal and the admin ticket queue.

export const TICKET_CATEGORIES = [
  { value: 'software', label: 'Software' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'access_login', label: 'Access / Login' },
  { value: 'network', label: 'Network / Connectivity' },
  { value: 'other', label: 'Other' },
]

// How badly it's affecting the person's work, so whoever handles tickets can
// triage without reading every description first.
export const TICKET_URGENCY = [
  { value: 'blocking', label: "Can't work" },
  { value: 'normal', label: 'Slowing me down' },
  { value: 'low', label: 'Minor' },
]

export const TICKET_STATUS = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
}

export const TICKET_STATUS_LABELS = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
}

const STATUS_STYLES = {
  open: { background: 'var(--warning-bg)', color: 'var(--warning)' },
  in_progress: { background: 'var(--brand-light)', color: 'var(--brand)' },
  resolved: { background: 'var(--success-bg)', color: 'var(--success)' },
}

export function categoryLabel(value) {
  return TICKET_CATEGORIES.find(c => c.value === value)?.label || value || 'Other'
}

export function urgencyLabel(value) {
  return TICKET_URGENCY.find(u => u.value === value)?.label || value || ''
}

export function TicketStatusPill({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.open
  return (
    <span style={{ ...s, fontSize: 'var(--text-xs)', fontWeight: 600, padding: '1px 7px', borderRadius: 'var(--radius-sm)', display: 'inline-block', whiteSpace: 'nowrap' }}>
      {TICKET_STATUS_LABELS[status] || status}
    </span>
  )
}
