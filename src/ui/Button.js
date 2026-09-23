import { T } from './theme'

// One place for every button in the app. Variants: primary (dark solid),
// secondary (outlined), glass, ghost (borderless), danger (destructive),
// danger-outline (quiet destructive), link (inline text). Sizes: sm|md.
// Renders a real <button type="button"> with focus rings from index.css and a
// busy state. Pass type="submit" explicitly inside forms.
const VARIANTS = {
  primary: { background: T.btnPrimaryBg, color: T.btnPrimaryFg, border: '1px solid transparent' },
  secondary: { background: T.surface, color: T.muted, border: `1px solid ${T.border}` },
  glass: { background: 'var(--glass-strong)', color: T.text, border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-highlight)' },
  ghost: { background: 'transparent', color: T.muted, border: '1px solid transparent' },
  danger: { background: T.danger, color: T.onAccent, border: '1px solid transparent' },
  'danger-outline': { background: 'transparent', color: T.danger, border: `1px solid ${T.dangerBorder}` },
  link: { background: 'none', color: T.brand, border: 'none' },
}

const HOVER_CLASS = {
  primary: 'il-btn',
  danger: 'il-btn',
  glass: 'il-btn',
  secondary: 'il-btn-ghost',
  ghost: 'il-btn-ghost',
  'danger-outline': 'il-btn-danger-outline',
  link: 'il-btn-link',
}

const SIZES = {
  xs: { padding: '4px 10px', fontSize: '12px', borderRadius: T.radiusSm },
  sm: { padding: '6px 12px', fontSize: '12px', borderRadius: T.radiusSm },
  md: { padding: '9px 16px', fontSize: '13px', borderRadius: T.radiusMd },
}

export default function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  busy = false,
  busyLabel,
  disabled = false,
  fullWidth = false,
  className = '',
  style = {},
  children,
  ...rest
}) {
  const isDisabled = disabled || busy
  const v = VARIANTS[variant] || VARIANTS.primary
  const s = variant === 'link' ? { padding: 0, fontSize: SIZES[size]?.fontSize || '13px' } : (SIZES[size] || SIZES.md)
  const hoverClass = HOVER_CLASS[variant] || 'il-btn'

  return (
    <button
      type={type}
      className={`${hoverClass} ${className}`.trim()}
      disabled={isDisabled}
      aria-busy={busy || undefined}
      style={{
        ...v,
        ...s,
        fontWeight: 500,
        fontFamily: 'inherit',
        letterSpacing: '0.1px',
        lineHeight: 1.3,
        cursor: isDisabled ? 'default' : 'pointer',
        opacity: isDisabled && !busy ? 0.5 : 1,
        width: fullWidth ? '100%' : undefined,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        ...style,
      }}
      {...rest}
    >
      {busy && <span className="il-spinner-sm" aria-hidden="true" />}
      {busy && busyLabel ? busyLabel : children}
    </button>
  )
}
