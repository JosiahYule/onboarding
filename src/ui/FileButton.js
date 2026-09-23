import { T } from './theme'

// An upload button. The real <input type="file"> stays in the tab order
// (visually hidden, not display:none), so keyboard users can reach it; the
// label around it is what's drawn. Resets the input after each pick so the
// same file can be chosen again.
const LOOKS = {
  primary: { background: T.btnPrimaryBg, color: T.btnPrimaryFg, border: '1px solid transparent', padding: '9px 16px', fontSize: '13px' },
  secondary: { background: T.surface, color: T.text, border: `1px solid ${T.border}`, padding: '7px 12px', fontSize: '12px' },
  soft: { background: T.brandLight, color: T.brand, border: '1px solid transparent', padding: '6px 12px', fontSize: '13px' },
  link: { background: 'none', color: T.brand, border: 'none', padding: 0, fontSize: '12px' },
}

export default function FileButton({ onFile, accept, busy = false, busyLabel = 'Uploading…', variant = 'secondary', icon = true, children, title }) {
  const look = LOOKS[variant] || LOOKS.secondary
  return (
    <label
      title={title}
      className={variant === 'link' ? 'il-btn-link' : variant === 'primary' ? 'il-btn' : 'il-btn-ghost'}
      aria-disabled={busy || undefined}
      style={{
        ...look,
        position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '6px',
        borderRadius: T.radiusMd, fontWeight: 500, fontFamily: 'inherit', whiteSpace: 'nowrap',
        cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.65 : 1,
      }}
    >
      {busy ? <span className="il-spinner-sm" aria-hidden="true" /> : icon && (
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M7 10V3M4 6l3-3 3 3" /><path d="M2 12h10" /></svg>
      )}
      {busy ? busyLabel : children}
      <input
        type="file"
        className="il-visually-hidden"
        accept={accept}
        disabled={busy}
        onChange={e => { onFile(e); e.target.value = '' }}
      />
    </label>
  )
}
