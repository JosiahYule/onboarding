// Avatar colours. Every avatar takes the brand tint, as ClientLaunch's do.
//
// This used to hash each name onto one of eight hues, so the same person kept
// the same colour. Under the shared design system colour carries state and
// nothing else (blue: brand and "you are here"; green: done; amber: waiting on
// ISL), and eight decorative hues down a list read as eight different states.
// The name beside the initials already says who it is.
//
// The palette stays a list, and the hash stays, so a future decision to bring
// per-person colour back is a one-line change rather than a rewrite.
const PALETTE = [
  { bg: 'var(--brand-tint)', fg: 'var(--brand-strong)' },
]

function hash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

export function avatarColors(name) {
  const key = (name || '').trim().toLowerCase() || '?'
  return PALETTE[hash(key) % PALETTE.length]
}

// Convenience: returns a style object { background, color } for an avatar chip.
export function avatarStyle(name) {
  const c = avatarColors(name)
  return { background: c.bg, color: c.fg }
}
