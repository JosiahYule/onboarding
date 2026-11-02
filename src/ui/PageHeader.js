import { useWindowSize } from '../hooks/useWindowSize'
import { T } from './theme'
import Tabs from './Tabs'

// The header every page shares: optional back link, title + subtitle on the
// left, actions on the right, an optional tab strip underneath. It's sticky
// and frosted (see .il-header), so the title and tabs stay reachable while the
// page scrolls.
export default function PageHeader({ title, subtitle, actions, back, tabs, children }) {
  const { isMobile } = useWindowSize()
  const px = isMobile ? 16 : 40
  const top = isMobile ? 16 : 26
  const bottom = tabs ? 0 : isMobile ? 14 : 22

  return (
    // On phones a tall header (back link, actions, progress) would pin a
    // quarter of the screen, so only compact headers stay sticky there.
    <header className={`il-header${isMobile && (children || back) ? ' il-header-static' : ''}`} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ padding: `${top}px ${px}px ${bottom}px` }}>
        {back && (
          <button type="button" className="il-link-subtle" onClick={back.onClick}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '10px', padding: 0, fontSize: 'var(--text-sm)', color: T.muted, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M9 2L4 7l5 5" /></svg>
            {back.label}
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            {/* A page title the size of ClientLaunch's console heading. */}
            <h1 style={{ ...(isMobile ? T.type.h1 : T.type.display), margin: 0, color: T.text, overflowWrap: 'anywhere', textWrap: 'balance' }}>{title}</h1>
            {subtitle && <div style={{ fontSize: 'var(--text-md)', color: T.muted, marginTop: '6px', maxWidth: '62ch' }}>{subtitle}</div>}
          </div>
          {actions && <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>{actions}</div>}
        </div>
        {children}
      </div>
      {tabs && (
        <Tabs mode={tabs.mode || 'nav'} label={tabs.label} items={tabs.items} value={tabs.value} onChange={tabs.onChange}
          style={{ padding: `${isMobile ? 10 : 14}px ${px}px 0` }} gap={isMobile ? 18 : 24} />
      )}
    </header>
  )
}
