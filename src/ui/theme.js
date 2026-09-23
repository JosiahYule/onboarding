// Design tokens. Colors and shadows resolve to the CSS custom properties in
// index.css, so switching `data-theme` on <html> re-themes every component that
// styles via T.* — that's what makes dark mode work app-wide. Non-color tokens
// (spacing, radii, type ramp, font) are plain values.
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
  hoverBg: 'var(--hover-bg)',
  onAccent: 'var(--on-accent)',

  // Primary (neutral) button — theme-aware so it stays visible in dark mode
  btnPrimaryBg: 'var(--btn-primary-bg)',
  btnPrimaryFg: 'var(--btn-primary-fg)',

  // Elevation
  shadowSm: 'var(--shadow-sm)',
  shadowMd: 'var(--shadow-md)',
  shadowLg: 'var(--shadow-lg)',

  // Radii
  radiusSm: '6px',
  radiusMd: '8px',
  radiusLg: '16px',

  font: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",

  // 4px-based spacing scale
  space: { 1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '24px', 6: '32px', 7: '40px', 8: '48px' },
}

// Typography ramp — spread onto a style object, e.g. style={{ ...T.type.h1 }}.
T.type = {
  display: { fontSize: '26px', fontWeight: 600, letterSpacing: '-0.8px', lineHeight: 1.15 },
  h1: { fontSize: '20px', fontWeight: 600, letterSpacing: '-0.5px', lineHeight: 1.25 },
  h2: { fontSize: '16px', fontWeight: 600, letterSpacing: '-0.3px', lineHeight: 1.3 },
  body: { fontSize: '13px', fontWeight: 400, letterSpacing: '-0.1px', lineHeight: 1.55 },
  small: { fontSize: '12px', fontWeight: 400, letterSpacing: 0, lineHeight: 1.5 },
  label: { fontSize: '11px', fontWeight: 600, letterSpacing: '0.4px', textTransform: 'uppercase' },
}

export default T
