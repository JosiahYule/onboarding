import { useEffect, useState } from 'react'

// Circular progress indicator. The stroke animates from its previous value to
// the new one on mount/update (unless reduced motion is requested). The percent
// label sits centered inside.
export default function ProgressRing({
  value = 0,
  size = 64,
  stroke = 6,
  showLabel = true,
  trackColor = 'var(--border-subtle)',
  color = 'var(--brand)',
  labelColor = 'var(--text)',
}) {
  const clamped = Math.max(0, Math.min(100, value))
  const [shown, setShown] = useState(0)

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setShown(clamped); return }
    const id = requestAnimationFrame(() => setShown(clamped))
    return () => cancelAnimationFrame(id)
  }, [clamped])

  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - shown / 100)

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      {showLabel && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: size <= 48 ? 'var(--text-sm)' : 'var(--text-md)', fontWeight: 700, color: labelColor,
          letterSpacing: '-0.4px', fontVariantNumeric: 'tabular-nums',
        }}>
          {Math.round(clamped)}%
        </div>
      )}
    </div>
  )
}
