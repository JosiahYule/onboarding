import { useEffect } from 'react'

export default function Toast({ message, type = 'success', onClose }) {
  useEffect(() => {
    if (type === 'error') return
    const timer = setTimeout(onClose, 3000)
    return () => clearTimeout(timer)
  }, [onClose, type])

  const colors = {
    success: { bg: 'rgba(24,24,27,0.92)', color: '#fff' },
    error: { bg: 'rgba(178,52,52,0.94)', color: '#fff' },
    warning: { bg: 'rgba(200,134,18,0.94)', color: '#fff' }
  }

  const { bg, color } = colors[type] || colors.success

  return (
    <div className="il-toast" role={type === 'error' ? 'alert' : 'status'} aria-live={type === 'error' ? 'assertive' : 'polite'} style={{
      position: 'fixed', left: '50%',
      transform: 'translateX(-50%)',
      background: bg, color,
      borderRadius: '10px', padding: '12px 16px 12px 20px',
      fontSize: '13px', fontWeight: 500,
      display: 'flex', alignItems: 'center', gap: '10px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10), inset 0 0 0 1px rgba(255,255,255,0.08)',
      backdropFilter: 'saturate(180%) blur(10px)',
      WebkitBackdropFilter: 'saturate(180%) blur(10px)',
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
        style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', padding: '0 0 0 4px', fontSize: '16px', lineHeight: 1, fontFamily: 'inherit', flexShrink: 0 }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
