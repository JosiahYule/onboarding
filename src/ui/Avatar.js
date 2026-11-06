import { avatarStyle } from '../utils/avatarColor'
import { getInitials } from '../utils/formatUtils'

// A person's initials in a circle, in their own colour (see avatarColor.js).
// Use this anywhere a person is shown, so everyone looks the same throughout.
// Decorative: the name always appears next to it, so it's hidden from screen
// readers.
//
// The colour comes from `colorKey` (pass the person's email where you have it)
// and falls back to the name. Email is the one thing every screen knows, the
// sidebar included, so a person is the same colour everywhere.
export default function Avatar({ name, colorKey, initials, size = 32, style }) {
  const px = typeof size === 'number' ? `${size}px` : size
  const n = parseFloat(px)
  const fontSize = n >= 44 ? 'var(--text-md)' : n >= 34 ? 'var(--text-base)' : n >= 28 ? 'var(--text-sm)' : 'var(--text-xs)'
  return (
    <span aria-hidden="true" style={{
      width: px, height: px, borderRadius: '50%', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-heading)', fontSize, fontWeight: 600, letterSpacing: '0.01em',
      ...avatarStyle(colorKey || name),
      ...style,
    }}>
      {initials || getInitials(name) || '?'}
    </span>
  )
}
