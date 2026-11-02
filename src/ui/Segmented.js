import { useRef } from 'react'
import { T } from './theme'

// A single-choice control drawn as a row of pills in a track (like iOS/macOS
// segmented controls). Themed, so it reads in dark mode, unlike the
// hand-built black/white button groups it replaces. Keyboard: arrow keys move
// the selection, as with a native radio group.
//
// options: [{ value, label, description? }]
export default function Segmented({ options, value, onChange, label, fullWidth = false, size = 'md' }) {
  const refs = useRef([])
  const idx = options.findIndex(o => o.value === value)

  function onKeyDown(e) {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const next = (Math.max(idx, 0) + dir + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  const pad = size === 'sm' ? '5px 10px' : '7px 14px'
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{
        // ClientLaunch's .segmented: one bordered box divided by hairlines, the
        // active option a solid blue field rather than a raised tile.
        display: fullWidth ? 'flex' : 'inline-flex',
        border: `1px solid ${T.border}`, borderRadius: T.radiusMd, background: T.surface,
        maxWidth: '100%', overflowX: 'auto',
      }}
    >
      {options.map((o, i) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            ref={el => { refs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active || (idx === -1 && i === 0) ? 0 : -1}
            onClick={() => onChange(o.value)}
            className="il-segment"
            style={{
              flex: fullWidth ? 1 : undefined,
              padding: pad, borderRadius: 0, border: 'none',
              borderLeft: i === 0 ? 'none' : `1px solid ${active || options[i - 1]?.value === value ? T.brand : T.border}`,
              background: active ? T.brand : T.surface,
              color: active ? T.btnPrimaryFg : T.text,
              fontSize: size === 'sm' ? 'var(--text-base)' : 'var(--text-md)', fontWeight: 600,
              fontFamily: 'var(--font-heading)', cursor: 'pointer', whiteSpace: 'nowrap',
              transition: 'background 0.12s ease, color 0.12s ease',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
