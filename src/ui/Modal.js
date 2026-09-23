import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import { T } from './theme'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Shared dialog chrome. Handles what every modal needs so individual modals
// don't each half-implement it:
// - role="dialog" + aria-modal, labelled by its title (and described by
//   `description` when given)
// - focus moves in on open, is trapped while open, and returns to whatever
//   was focused before (usually the button that opened it)
// - Escape and backdrop click close it, unless `busy` (mid-save)
// - the page behind doesn't scroll
export default function Modal({
  title,
  description,
  onClose,
  busy = false,
  closeOnBackdrop = true,
  initialFocus = 'first', // 'first' | 'last' | a CSS selector inside the modal
  maxWidth = 420,
  children,
  footer,
}) {
  const ref = useRef(null)
  const titleId = useId()
  const descId = useId()
  const onCloseRef = useRef(onClose)
  const busyRef = useRef(busy)
  onCloseRef.current = onClose
  busyRef.current = busy

  useLayoutEffect(() => {
    const previouslyFocused = document.activeElement
    const nodes = ref.current ? [...ref.current.querySelectorAll(FOCUSABLE)] : []
    const target = initialFocus === 'last' ? nodes[nodes.length - 1]
      : initialFocus === 'first' ? nodes[0]
      : ref.current?.querySelector(initialFocus)
    ;(target || ref.current)?.focus()

    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus()
    }
    // Mount-only: focus once on open, restore once on close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busyRef.current) { e.stopPropagation(); onCloseRef.current(); return }
      if (e.key !== 'Tab' || !ref.current) return
      const nodes = [...ref.current.querySelectorAll(FOCUSABLE)]
      if (!nodes.length) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="il-backdrop"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.32)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px', fontFamily: T.font,
      }}
      onMouseDown={e => { if (e.target === e.currentTarget && closeOnBackdrop && !busy) onClose() }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className="il-modal"
        style={{
          background: 'var(--glass-strong)',
          backdropFilter: 'var(--glass-filter)', WebkitBackdropFilter: 'var(--glass-filter)',
          borderRadius: '18px',
          border: '1px solid var(--glass-border)',
          boxShadow: 'var(--glass-highlight), var(--shadow-lg)',
          padding: '24px', width: '100%', maxWidth: `${maxWidth}px`,
          maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', outline: 'none',
        }}
      >
        <h2 id={titleId} style={{ ...T.type.h2, margin: 0, color: T.text, marginBottom: description ? '8px' : '18px' }}>{title}</h2>
        {description && (
          <div id={descId} style={{ fontSize: '13px', color: T.muted, lineHeight: 1.6, marginBottom: '20px' }}>{description}</div>
        )}
        {children}
        {footer && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px', flexWrap: 'wrap' }}>{footer}</div>
        )}
      </div>
    </div>
  )
}
