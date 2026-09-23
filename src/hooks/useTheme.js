import { useEffect, useState } from 'react'

// Theme is 'light' | 'dark' | 'system'. We persist the choice and reflect it on
// <html data-theme>. 'system' removes the attribute so the CSS media query and
// :root:not([data-theme=light]) rules follow the OS preference.
const KEY = 'il-theme'

function apply(theme) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

// The persisted choice. Read fresh each time so a component that mounts after
// the user changed the theme (e.g. ThemeToggle remounting on navigation) starts
// from the current value, not a stale module-load snapshot.
function readStored() {
  return (typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) || 'system'
}

// Apply immediately on module load so there's no flash before React mounts.
apply(readStored())

export function useTheme() {
  // Lazy initializer runs on every mount, reading the current persisted value.
  const [theme, setThemeState] = useState(readStored)

  useEffect(() => { apply(theme) }, [theme])

  function setTheme(next) {
    setThemeState(next)
    try {
      if (next === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, next)
    } catch { /* ignore storage failures */ }
  }

  // What's actually on screen, with 'system' resolved to the OS preference.
  const isDark = theme === 'dark'
    || (theme === 'system' && typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches)

  // Convenience toggle that flips between light and dark based on what's shown.
  function toggle() {
    setTheme(isDark ? 'light' : 'dark')
  }

  return { theme, isDark, setTheme, toggle }
}
