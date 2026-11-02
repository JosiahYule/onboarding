import { useEffect } from 'react'

export default function Toast({ message, type = 'success', onClose }) {
  useEffect(() => {
    if (type === 'error') return
    const timer = setTimeout(onClose, 3000)
    return () => clearTimeout(timer)
  }, [onClose, type])

  // ClientLaunch's floating notice: opaque paper with a coloured rule down the
  // left edge, the colour carrying the state (green done, amber waiting, red
  // failed), and the text in that colour.
  const colors = {
    success: { color: 'var(--success)', rule: 'var(--success)', border: 'var(--border)' },
    error: { color: 'var(--danger)', rule: 'var(--danger)', border: 'var(--danger-border)' },
    warning: { color: 'var(--warning)', rule: 'var(--warning)', border: 'var(--border)' }
  }

  const { color, rule, border } = colors[type] || colors.success

  return (
    <div className="il-toast" role={type === 'error' ? 'alert' : 'status'} aria-live={type === 'error' ? 'assertive' : 'polite'} style={{
      position: 'fixed', left: '50%',
      transform: 'translateX(-50%)',
      background: 'var(--surface)', color,
      border: `1px solid ${border}`,
      borderRadius: 'var(--radius-md)', padding: '11px 14px 11px 16px',
      fontSize: 'var(--text-base)', fontWeight: 500,
      display: 'flex', alignItems: 'center', gap: '10px',
      boxShadow: `inset 3px 0 0 ${rule}, var(--shadow-lg)`,
      zIndex: 1100, fontFamily: 'var(--font)',
      maxWidth: 'min(440px, calc(100vw - 32px))',
      lineHeight: 1.45,
      animation: 'slideUp 0.3s ease'
    }}>
      {type === 'success' && <span aria-hidden="true">✓</span>}
      {type === 'error' && <span aria-hidden="true">✕</span>}
      {type === 'warning' && <span aria-hidden="true">⚠</span>}
      <span>{message}</span>
      <button
        type="button"
        onClick={onClose}
        style={{ background: 'none', border: 'none', color: 'var(--subtle)', cursor: 'pointer', padding: '0 0 0 4px', fontSize: 'var(--text-lg)', lineHeight: 1, fontFamily: 'inherit', flexShrink: 0 }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
