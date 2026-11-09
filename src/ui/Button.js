import { T } from './theme'

// One place for every button in the app, drawn as ClientLaunch draws them.
// Variants: primary (ISL blue, the one action a screen is asking for),
// secondary (outlined, ClientLaunch's .btn-ghost), glass (on chrome), ghost
// (borderless), danger (destructive), danger-outline (quiet destructive),
// link (inline text). Sizes: xs|sm|md|lg, each a fixed control height so a
// button beside an input beside a select lines up without nudging.
// Renders a real <button type="button"> with focus rings from index.css and a
// busy state. Pass type="submit" explicitly inside forms.
const VARIANTS = {
  primary: { background: T.btnPrimaryBg, color: T.btnPrimaryFg, border: '1px solid transparent' },
  secondary: { background: T.surface, color: T.text, border: `1px solid ${T.border}` },
  glass: { background: 'var(--glass-strong)', color: T.text, border: '1px solid var(--glass-border)' },
  ghost: { background: 'transparent', color: T.muted, border: '1px solid transparent' },
  danger: { background: T.danger, color: T.onAccent, border: '1px solid transparent' },
  'danger-outline': { background: T.surface, color: T.danger, border: `1px solid ${T.dangerBorder}` },
  link: { background: 'none', color: T.brand, border: 'none' },
}

const HOVER_CLASS = {
  primary: 'il-btn',
  danger: 'il-btn',
  glass: 'il-btn-ghost',
  secondary: 'il-btn-ghost',
  ghost: 'il-btn-ghost',
  'danger-outline': 'il-btn-danger-outline',
  link: 'il-btn-link',
}

const SIZES = {
  xs: { height: '28px', padding: '0 10px', fontSize: 'var(--text-sm)' },
  sm: { height: '32px', padding: '0 12px', fontSize: 'var(--text-base)' },
  md: { height: 'var(--control-h)', padding: '0 18px', fontSize: 'var(--text-md)' },
  lg: { height: 'var(--control-h-lg)', padding: '0 18px', fontSize: 'var(--text-lg)' },
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
  const s = variant === 'link' ? { padding: 0, fontSize: SIZES[size]?.fontSize || 'var(--text-base)' } : (SIZES[size] || SIZES.md)
  const hoverClass = HOVER_CLASS[variant] || 'il-btn'

  return (
    <button
      type={type}
      className={`${hoverClass} ${className}`.trim()}
      data-variant={variant}
      disabled={isDisabled}
      aria-busy={busy || undefined}
      style={{
        ...v,
        ...s,
        borderRadius: T.radiusMd,
        fontWeight: variant === 'link' ? 500 : 600,
        fontFamily: 'var(--font-heading)',
        letterSpacing: 0,
        lineHeight: 1.3,
        cursor: isDisabled ? 'default' : 'pointer',
        // A faded blue reads as broken, so a disabled primary button goes
        // neutral grey instead; other variants just dim.
        opacity: isDisabled && !busy && variant !== 'primary' ? 0.5 : 1,
        ...(isDisabled && !busy && variant === 'primary' ? { background: T.surfaceSunken, color: T.subtle, border: `1px solid ${T.border}` } : {}),
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
