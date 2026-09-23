import { useRef } from 'react'
import { T } from './theme'

// Underlined tab strip used across the app.
//
// mode="tabs": in-page panels (role="tablist", arrow keys move between tabs).
// mode="nav":  each tab is a separate page/route (a nav with aria-current).
//
// items: [{ id, label, badge?, disabled?, hint? }]
export default function Tabs({ items, value, onChange, label, mode = 'tabs', style, gap = 20 }) {
  const refs = useRef({})
  const enabled = items.filter(i => !i.disabled)

  function onKeyDown(e) {
    if (mode !== 'tabs' || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return
    const idx = enabled.findIndex(i => i.id === value)
    const next = enabled[(idx + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length]
    if (next) {
      e.preventDefault()
      onChange(next.id)
      refs.current[next.id]?.focus()
    }
  }

  const Wrapper = mode === 'nav' ? 'nav' : 'div'
  return (
    <Wrapper
      role={mode === 'tabs' ? 'tablist' : undefined}
      aria-label={label}
      onKeyDown={onKeyDown}
      className="il-tabs"
      style={{ display: 'flex', gap: `${gap}px`, overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', ...style }}
    >
      {items.map(item => {
        const active = item.id === value
        return (
          <button
            key={item.id}
            ref={el => { refs.current[item.id] = el }}
            type="button"
            role={mode === 'tabs' ? 'tab' : undefined}
            aria-selected={mode === 'tabs' ? active : undefined}
            aria-current={mode === 'nav' && active ? 'page' : undefined}
            tabIndex={mode === 'tabs' && !active ? -1 : undefined}
            disabled={item.disabled}
            title={item.hint}
            onClick={() => onChange(item.id)}
            className="il-tab"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '10px 0', marginBottom: '-1px',
              fontSize: '13px', fontWeight: active ? 600 : 500,
              color: item.disabled ? T.subtle : active ? T.text : T.muted,
              background: 'none', border: 'none',
              borderBottom: `2px solid ${active ? T.brand : 'transparent'}`,
              cursor: item.disabled ? 'default' : 'pointer',
              fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0,
              transition: 'color 0.12s ease, border-color 0.12s ease',
            }}
          >
            {item.label}
            {item.badge != null && item.badge !== 0 && (
              <span style={{
                fontSize: '10px', fontWeight: 600, lineHeight: 1, minWidth: '16px', height: '16px',
                padding: '0 5px', borderRadius: '99px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: item.disabled ? T.hoverBg : active ? T.brand : T.hoverBg,
                color: item.disabled ? T.subtle : active ? T.onAccent : T.muted,
              }}>
                {item.badge}
              </span>
            )}
          </button>
        )
      })}
    </Wrapper>
  )
}
