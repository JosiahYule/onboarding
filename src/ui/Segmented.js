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
        display: fullWidth ? 'flex' : 'inline-flex', gap: '2px', padding: '3px',
        background: T.hoverBg, borderRadius: T.radiusMd, maxWidth: '100%', overflowX: 'auto',
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
              padding: pad, borderRadius: '6px', border: 'none',
              background: active ? T.surface : 'transparent',
              boxShadow: active ? T.shadowSm : 'none',
              color: active ? T.text : T.muted,
              fontSize: size === 'sm' ? '12px' : '13px', fontWeight: active ? 600 : 500,
              fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
              transition: 'background 0.12s ease, color 0.12s ease, box-shadow 0.12s ease',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
