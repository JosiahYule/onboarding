// Per-person avatar colours. Each name is hashed onto one hue, so the same
// person keeps the same colour everywhere in the app (avatars, and their bars
// on the time off calendar).
//
// The hues deliberately leave out ISL blue, green and amber: in this app those
// three mean "in progress / you are here", "done" and "waiting", so a person
// drawn in green beside a progress bar would read as finished.
//
// Colours are mixed into the current surface rather than written as fixed
// tints, so the same palette reads in light and dark mode. How much of the
// hue goes in is --avatar-tint in index.css, stronger in dark mode.
export const AVATAR_HUES = [
  '#ea580c', // orange
  '#e11d48', // rose
  '#c026d3', // fuchsia
  '#7c3aed', // violet
  '#4f46e5', // indigo
  '#0891b2', // cyan
  '#0d9488', // teal
  '#64748b', // slate
]

function hash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

export function avatarHue(name) {
  const key = (name || '').trim().toLowerCase() || '?'
  return AVATAR_HUES[hash(key) % AVATAR_HUES.length]
}

export function avatarColors(name) {
  const hue = avatarHue(name)
  return {
    bg: `color-mix(in srgb, ${hue} var(--avatar-tint), var(--surface))`,
    fg: `color-mix(in srgb, ${hue} 72%, var(--text))`,
  }
}

// Convenience: returns a style object { background, color } for an avatar chip.
export function avatarStyle(name) {
  const c = avatarColors(name)
  return { background: c.bg, color: c.fg }
}
