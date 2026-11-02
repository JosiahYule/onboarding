// Design tokens, as JavaScript names for the CSS custom properties in
// src/styles/tokens.css. That file is ClientLaunch's, copied unchanged, so
// Integrated Launch, ClientLaunch and ClientWatch draw from one palette, one
// type scale and one set of shapes. Every value here is a var(), so switching
// `data-theme` on <html> re-themes every component that styles via T.*, and a
// change made to the shared tokens reaches this app without touching this file.
export const T = {
  // Colors -> CSS variables (theme-aware)
  bg: 'var(--bg)',
  surface: 'var(--surface)',
  surfaceRaised: 'var(--surface-raised)',
  border: 'var(--border)',
  borderSubtle: 'var(--border-subtle)',
  text: 'var(--text)',
  muted: 'var(--muted)',
  subtle: 'var(--subtle)',
  brand: 'var(--brand)',
  brandMid: 'var(--brand-mid)',
  brandLight: 'var(--brand-light)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  dangerBg: 'var(--danger-bg)',
  dangerBorder: 'var(--danger-border)',
  successBg: 'var(--success-bg)',
  successBorder: 'var(--success-border)',
  warningBg: 'var(--warning-bg)',
  warningBorder: 'var(--warning-border)',
  surfaceSunken: 'var(--surface-sunken)',
  borderStrong: 'var(--border-strong)',
  brandStrong: 'var(--brand-strong)',
  brandTint: 'var(--brand-tint)',
  disabled: 'var(--disabled)',
  hoverBg: 'var(--hover-bg)',
  onAccent: 'var(--on-accent)',

  // Primary button: ISL blue, as in ClientLaunch
  btnPrimaryBg: 'var(--btn-primary-bg)',
  btnPrimaryFg: 'var(--btn-primary-fg)',

  // Elevation. ClientLaunch has none on the page (sm and md resolve to `none`);
  // lg is kept for the things that genuinely sit above it: a modal, a toast.
  shadowSm: 'var(--shadow-sm)',
  shadowMd: 'var(--shadow-md)',
  shadowLg: 'var(--shadow-lg)',

  // One radius, 4px. The three names stay so existing components keep working.
  radiusSm: 'var(--radius-sm)',
  radiusMd: 'var(--radius-md)',
  radiusLg: 'var(--radius-lg)',

  font: 'var(--font-body)',
  fontHeading: 'var(--font-heading)',

  // ClientLaunch's eight-step type scale. Every font size should be one of these.
  fontSize: { xs: 'var(--text-xs)', sm: 'var(--text-sm)', base: 'var(--text-base)', md: 'var(--text-md)', lg: 'var(--text-lg)', xl: 'var(--text-xl)', '2xl': 'var(--text-2xl)', '3xl': 'var(--text-3xl)' },

  // 4px-based spacing scale
  space: { 1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '24px', 6: '32px', 7: '40px', 8: '48px' },
}

// Typography ramp, matching ClientLaunch's .t-display / .t-h1 / .t-h2 /
// .t-body / .t-small / .t-label. Spread onto a style object, e.g.
// style={{ ...T.type.h1 }}.
T.type = {
  display: { fontFamily: 'var(--font-heading)', fontSize: 'var(--text-2xl)', fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.15 },
  h1: { fontFamily: 'var(--font-heading)', fontSize: 'var(--text-xl)', fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.25 },
  h2: { fontFamily: 'var(--font-heading)', fontSize: 'var(--text-lg)', fontWeight: 600, letterSpacing: '-0.005em', lineHeight: 1.3 },
  body: { fontSize: 'var(--text-base)', fontWeight: 400, letterSpacing: 0, lineHeight: 1.55 },
  small: { fontSize: 'var(--text-sm)', fontWeight: 400, letterSpacing: 0, lineHeight: 1.5 },
  label: { fontSize: 'var(--text-xs)', fontWeight: 600, letterSpacing: '0.4px', textTransform: 'uppercase' },
}

export default T
