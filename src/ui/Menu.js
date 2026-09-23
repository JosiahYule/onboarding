import { useEffect, useId, useRef, useState } from 'react'
import { T } from './theme'

// A "…" overflow menu for secondary actions. Keyboard: Enter/Space/ArrowDown
// open it, arrows move between items, Escape closes and returns focus to the
// trigger. Clicking outside closes it.
//
// items: [{ label, onClick, danger?, disabled?, hint? } | 'divider']
export default function Menu({ items, label = 'More actions', align = 'right', triggerLabel }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const itemRefs = useRef([])
  const menuId = useId()
  const actionable = items.filter(i => i !== 'divider')

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    itemRefs.current.find(el => el && !el.disabled)?.focus()
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function close(refocus = true) {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  function onMenuKey(e) {
    const els = itemRefs.current.filter(el => el && !el.disabled)
    const i = els.indexOf(document.activeElement)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); els[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); els[els.length - 1]?.focus() }
    else if (e.key === 'Tab') close(false)
  }

  let idx = -1
  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={triggerLabel ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true) } }}
        className="il-btn-ghost"
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
          height: '30px', minWidth: '30px', padding: triggerLabel ? '0 10px' : 0,
          borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.surface,
          color: T.muted, cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', fontWeight: 500,
        }}
      >
        {triggerLabel}
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><circle cx="3" cy="7" r="1.25" /><circle cx="7" cy="7" r="1.25" /><circle cx="11" cy="7" r="1.25" /></svg>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className="il-modal"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', [align]: 0, zIndex: 60,
            minWidth: '200px', padding: '4px',
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radiusMd,
            boxShadow: T.shadowLg,
          }}
        >
          {items.map((item, n) => {
            if (item === 'divider') return <div key={`d${n}`} role="separator" style={{ height: '1px', background: T.borderSubtle, margin: '4px 0' }} />
            idx += 1
            const i = idx
            return (
              <button
                key={item.label}
                ref={el => { itemRefs.current[i] = el }}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => { close(false); item.onClick() }}
                className={item.danger ? 'il-menu-item il-menu-item-danger' : 'il-menu-item'}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
                  border: 'none', borderRadius: '6px', background: 'none', cursor: item.disabled ? 'default' : 'pointer',
                  fontFamily: 'inherit', fontSize: '13px', color: item.danger ? T.danger : T.text,
                  opacity: item.disabled ? 0.5 : 1,
                }}
              >
                {item.label}
                {item.hint && <span style={{ display: 'block', fontSize: '11px', color: T.subtle, marginTop: '1px' }}>{item.hint}</span>}
              </button>
            )
          })}
          {actionable.length === 0 && <div style={{ padding: '8px 10px', fontSize: '12px', color: T.subtle }}>No actions</div>}
        </div>
      )}
    </div>
  )
}
