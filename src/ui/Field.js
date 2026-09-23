import { cloneElement, isValidElement, useId } from 'react'
import { T } from './theme'

// A labelled form control. Wires the <label> to the control and points
// aria-describedby at the hint or error, so screen readers announce them, and
// flags the control invalid when there's an error. Pass a single input,
// select or textarea as the child; it gets the shared .il-input look unless it
// already has a className.
export default function Field({ label, hint, error, optional = false, required = false, children, style }) {
  const autoId = useId()
  const child = isValidElement(children) ? children : null
  const id = child?.props.id || autoId
  const messageId = `${id}-msg`
  const message = error || hint

  const control = child
    ? cloneElement(child, {
      id,
      className: [child.props.className || 'il-input', error ? 'il-field-error' : ''].filter(Boolean).join(' '),
      'aria-invalid': error ? true : undefined,
      'aria-describedby': message ? messageId : undefined,
      'aria-required': required || undefined,
    })
    : children

  return (
    <div style={{ marginBottom: '18px', minWidth: 0, ...style }}>
      <label htmlFor={id} style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: T.muted, marginBottom: '6px' }}>
        {label}
        {optional && <span style={{ color: T.subtle, fontWeight: 400 }}> (optional)</span>}
        {required && <span aria-hidden="true" style={{ color: T.danger }}> *</span>}
      </label>
      {control}
      {message && (
        <div id={messageId} className="il-field-hint" data-tone={error ? 'error' : 'muted'} role={error ? 'alert' : undefined}>
          {message}
        </div>
      )}
    </div>
  )
}
