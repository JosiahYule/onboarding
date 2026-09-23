import { T } from './theme'

// A friendlier "nothing here yet" than a lone line of grey text: a soft icon,
// a title, a short explanation, and an optional call to action.
export default function EmptyState({ icon, title, message, action, compact = false }) {
  return (
    <div style={{
      textAlign: 'center',
      padding: compact ? '28px 20px' : '48px 24px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '4px',
    }}>
      {icon && (
        <div aria-hidden="true" style={{
          width: '44px', height: '44px', borderRadius: T.radiusLg,
          background: T.hoverBg, color: T.muted,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: '8px',
        }}>
          {icon}
        </div>
      )}
      {title && <div style={{ fontSize: '14px', fontWeight: 600, color: T.text }}>{title}</div>}
      {message && <div style={{ fontSize: '13px', color: T.muted, lineHeight: 1.6, maxWidth: '340px' }}>{message}</div>}
      {action && <div style={{ marginTop: '12px' }}>{action}</div>}
    </div>
  )
}

// A couple of small inline icons for common empty states.
export const EmptyIcons = {
  doc: (
    <svg width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M3 2h6l3 3v7H3z" /><path d="M9 2v3h3" />
    </svg>
  ),
  folder: (
    <svg width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M1 4a1 1 0 0 1 1-1h3l2 2h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" />
    </svg>
  ),
  calendar: (
    <svg width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1" y="3" width="12" height="10" rx="1" /><path d="M1 6h12M4 1v4M10 1v4" />
    </svg>
  ),
  people: (
    <svg width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="7" cy="5" r="2.5" /><path d="M2 13c0-2.5 2.5-4.5 5-4.5s5 2 5 4.5" />
    </svg>
  ),
  alert: (
    <svg width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <circle cx="7" cy="7" r="5.5" /><path d="M7 4.2v3.3M7 9.6v.1" />
    </svg>
  ),
  check: (
    <svg width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="5.5" /><path d="M4.6 7.1l1.7 1.7 3.2-3.4" />
    </svg>
  ),
  list: (
    <svg width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <path d="M5 3.5h7M5 7h7M5 10.5h7" /><circle cx="2.3" cy="3.5" r=".6" /><circle cx="2.3" cy="7" r=".6" /><circle cx="2.3" cy="10.5" r=".6" />
    </svg>
  ),
  search: (
    <svg width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="6" cy="6" r="4" /><path d="M10 10l2.5 2.5" />
    </svg>
  ),
}
