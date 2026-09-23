import { T } from './theme'

// The round tick used for tasks and documents. With `onToggle` it's a real
// checkbox (a <button role="checkbox">, so it's reachable with Tab and
// toggles with Space/Enter); without it, it's a purely visual indicator.
export default function CheckCircle({ checked, size = 18, onToggle, label, disabled = false, title }) {
  const visual = (
    <span
      aria-hidden="true"
      className="il-checkbox"
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        // The unticked ring mixes in the muted text colour so it stays visible
        // on both white and near-black surfaces (the plain border token was
        // nearly invisible in dark mode).
        border: checked ? `1.5px solid ${T.brand}` : '1.5px solid color-mix(in srgb, var(--muted) 60%, transparent)',
        background: checked ? T.brand : T.surface,
        boxShadow: checked ? '0 0 0 3px color-mix(in srgb, var(--brand) 14%, transparent)' : 'none',
      }}
    >
      {checked && (
        <svg width={Math.round(size * 0.5)} height={Math.round(size * 0.4)} viewBox="0 0 10 8" fill="none">
          <path d="M1 4L3.5 6.5L9 1" stroke="var(--on-accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )
  if (!onToggle) return <span title={title} style={{ display: 'inline-flex', flexShrink: 0 }}>{visual}</span>
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={!!checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={e => { e.stopPropagation(); onToggle(e) }}
      style={{
        display: 'inline-flex', flexShrink: 0, padding: '5px', margin: '-5px',
        background: 'none', border: 'none', borderRadius: '50%',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {visual}
    </button>
  )
}
