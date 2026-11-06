import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useWindowSize } from '../hooks/useWindowSize'
import { ROLE } from '../config'
import { displayNameFromEmail } from '../utils/formatUtils'
import ThemeToggle from '../ui/ThemeToggle'
import { BrandLockup, BrandMark } from '../ui/Brand'
import Avatar from '../ui/Avatar'

// Pages that count as a primary tab on mobile; anything else lights up "More".
const PRIMARY_PAGES = ['dashboard', 'active', 'new-onboarding-select', 'time-off']

// The sidebar (desktop) and the "More" drawer (mobile) are built from the same
// list, so the two can't drift apart. Each section only appears when it has at
// least one item this user can use.
function buildSections(userProfile) {
  const role = userProfile?.role
  const canManage = role === ROLE.ADMIN || role === ROLE.SUPER_ADMIN
  const hub = [
    canManage && { id: 'time-off', label: 'Time off', icon: 'calendar' },
    canManage && { id: 'tech-support', label: 'Tech support', icon: 'wrench' },
    userProfile?.employee_id && { id: 'employee-hub', label: 'My portal', icon: 'person' },
  ].filter(Boolean)

  return [
    {
      id: 'main',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
        canManage && { id: 'active', label: 'New onboarding', icon: 'plus' },
      ].filter(Boolean),
    },
    canManage && {
      id: 'manage', label: 'Manage',
      items: [
        { id: 'history', label: 'History', icon: 'check' },
        { id: 'templates', label: 'Task templates', icon: 'lines' },
        { id: 'documents', label: 'Documents', icon: 'doc' },
        { id: 'company-resources', label: 'Company resources', icon: 'folder' },
        { id: 'roles', label: 'Roles', icon: 'briefcase' },
      ],
    },
    hub.length > 0 && { id: 'hub', label: 'Employee hub', items: hub },
    role === ROLE.SUPER_ADMIN && {
      id: 'system', label: 'System',
      items: [
        { id: 'super-admin-users', label: 'Users', icon: 'shield' },
        { id: 'super-admin-audit', label: 'Audit log', icon: 'audit' },
        { id: 'super-admin-settings', label: 'System settings', icon: 'gear' },
      ],
    },
  ].filter(Boolean)
}

function isActive(item, currentPage) {
  if (item.id === 'active') return currentPage === 'active' || currentPage === 'new-onboarding-select'
  return currentPage === item.id
}

function Icon({ type, size = 14 }) {
  const c = { width: size, height: size, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
  if (type === 'dashboard') return <svg {...c}><rect x="1.5" y="1.5" width="4.5" height="4.5" rx="1"/><rect x="8" y="1.5" width="4.5" height="4.5" rx="1"/><rect x="1.5" y="8" width="4.5" height="4.5" rx="1"/><rect x="8" y="8" width="4.5" height="4.5" rx="1"/></svg>
  if (type === 'plus') return <svg {...c}><circle cx="7" cy="7" r="5.5"/><path d="M7 4.5v5M4.5 7h5"/></svg>
  if (type === 'people') return <svg {...c}><circle cx="7" cy="5" r="2.5"/><path d="M2 13c0-2.5 2.5-4.5 5-4.5s5 2 5 4.5"/></svg>
  if (type === 'check') return <svg {...c}><path d="M2 7l3 3 7-7"/></svg>
  if (type === 'lines') return <svg {...c}><path d="M2 3h10M2 7h10M2 11h10"/></svg>
  if (type === 'doc') return <svg {...c}><path d="M3 2h6l3 3v7H3z"/><path d="M9 2v3h3"/></svg>
  if (type === 'briefcase') return <svg {...c}><rect x="1.5" y="4.5" width="11" height="8" rx="1"/><path d="M5 4.5V3h4v1.5"/></svg>
  if (type === 'shield') return <svg {...c}><path d="M7 1L2 3.5v3.5c0 3 2.3 5.5 5 6.5 2.7-1 5-3.5 5-6.5V3.5L7 1z"/></svg>
  if (type === 'audit') return <svg {...c}><path d="M2 2h10v10H2z"/><path d="M4 5h6M4 7h4M4 9h5"/></svg>
  if (type === 'gear') return <svg {...c}><circle cx="7" cy="7" r="2"/><path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.9 2.9l1.4 1.4M9.7 9.7l1.4 1.4M2.9 11.1l1.4-1.4M9.7 4.3l1.4-1.4"/></svg>
  if (type === 'calendar') return <svg {...c}><rect x="1" y="3" width="12" height="10" rx="1"/><path d="M1 6h12M4 1v4M10 1v4"/></svg>
  if (type === 'folder') return <svg {...c}><path d="M1 4a1 1 0 0 1 1-1h3l2 2h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z"/></svg>
  if (type === 'person') return <svg {...c}><circle cx="7" cy="4.5" r="2.5"/><path d="M1.5 13c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/></svg>
  if (type === 'wrench') return <svg {...c}><path d="M9.5 1.5a3 3 0 0 0-2.8 4.1L1.8 10.5a1.2 1.2 0 0 0 1.7 1.7l4.9-4.9A3 3 0 0 0 12.5 4.5l-1.8 1.8-1.6-.4-.4-1.6z"/></svg>
  if (type === 'external') return <svg {...c}><path d="M8 2h4v4M12 2L6.5 7.5"/><path d="M10.5 8.5V12h-8.5V3.5H5.5"/></svg>
  if (type === 'dots') return <svg width={size} height={size} viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><circle cx="3" cy="7" r="1.3"/><circle cx="7" cy="7" r="1.3"/><circle cx="11" cy="7" r="1.3"/></svg>
  return null
}


const ROLE_LABELS = { employee: 'Employee', manager: 'Manager', admin: 'Admin', super_admin: 'Super admin' }

// ClientLaunch's .t-label.
const sectionLabel = { fontSize: 'var(--text-xs)', color: 'var(--subtle)', fontWeight: 600, letterSpacing: '0.4px', textTransform: 'uppercase' }

export default function Layout({ session, userProfile, currentPage, onNavigate, children }) {
  const { isMobile } = useWindowSize()
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = e => { if (e.key === 'Escape') setDrawerOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const sections = buildSections(userProfile)
  const canManage = userProfile?.role === ROLE.ADMIN || userProfile?.role === ROLE.SUPER_ADMIN

  function activate(item) {
    setDrawerOpen(false)
    if (item.onClick) item.onClick()
    else onNavigate(item.id)
  }

  const email = session?.user?.email || ''
  const name = displayNameFromEmail(email)
  const initials = name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?'
  const isMoreActive = !PRIMARY_PAGES.includes(currentPage)

  const skipLink = <a href="#main" className="il-skip-link">Skip to content</a>

  // ── MOBILE LAYOUT ──
  if (isMobile) {
    const tab = (active) => ({
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: '3px', height: '56px',
      background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
      color: active ? 'var(--brand)' : 'var(--subtle)',
      fontSize: 'var(--text-xs)', fontWeight: active ? 600 : 500,
      padding: '6px 4px 4px',
    })

    const drawerBtn = (active) => ({
      display: 'flex', alignItems: 'center', gap: '14px',
      padding: '13px 20px', width: '100%',
      background: active ? 'var(--brand-light)' : 'none',
      border: 'none', borderLeft: `2px solid ${active ? 'var(--brand)' : 'transparent'}`, fontSize: 'var(--text-lg)',
      fontWeight: active ? 500 : 400, color: 'var(--text)',
      cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
    })

    // "Dashboard" and "Onboarding" live on the tab bar; the drawer holds the rest.
    const drawerSections = sections
      .map(s => ({ ...s, items: s.items.filter(i => !PRIMARY_PAGES.includes(i.id)) }))
      .filter(s => s.items.length > 0)

    return (
      <div style={{ minHeight: '100vh', background: 'transparent', fontFamily: 'var(--font)', color: 'var(--text)' }}>
        {skipLink}
        <header className="il-header" data-topbar="true" style={{
          position: 'sticky', top: 0, zIndex: 40,
          borderBottom: '1px solid var(--border)',
          height: '54px', display: 'flex', alignItems: 'center', padding: '0 16px', gap: '10px',
        }}>
          <BrandMark size={24} />
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--text)' }}>Integrated Launch</div>
        </header>

        <main id="main" tabIndex={-1} style={{ paddingBottom: 'calc(64px + env(safe-area-inset-bottom, 0px))', outline: 'none' }}>
          <div key={currentPage} className="il-page">{children}</div>
        </main>

        <nav aria-label="Main" className="il-tabbar" style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          borderTop: '1px solid var(--border)',
          display: 'flex', zIndex: 40,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}>
          <button style={tab(currentPage === 'dashboard')} aria-current={currentPage === 'dashboard' ? 'page' : undefined} onClick={() => { setDrawerOpen(false); onNavigate('dashboard') }}>
            <Icon type="dashboard" size={19} />
            <span>Dashboard</span>
          </button>
          {canManage && (
            <button style={tab(currentPage === 'active' || currentPage === 'new-onboarding-select')} aria-current={currentPage === 'new-onboarding-select' ? 'page' : undefined} onClick={() => { setDrawerOpen(false); onNavigate('active') }}>
              <Icon type="plus" size={19} />
              <span>New</span>
            </button>
          )}
          {canManage && (
            <button style={tab(currentPage === 'time-off')} aria-current={currentPage === 'time-off' ? 'page' : undefined} onClick={() => { setDrawerOpen(false); onNavigate('time-off') }}>
              <Icon type="calendar" size={19} />
              <span>Time off</span>
            </button>
          )}
          <button style={tab(isMoreActive || drawerOpen)} aria-expanded={drawerOpen} aria-controls="il-more-drawer" onClick={() => setDrawerOpen(o => !o)}>
            <Icon type="dots" size={19} />
            <span>More</span>
          </button>
        </nav>

        {drawerOpen && (
          <div
            className="il-backdrop"
            style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.35)' }}
            onClick={() => setDrawerOpen(false)}
          >
            <div
              id="il-more-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="More"
              className="il-drawer"
              style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                background: 'var(--surface)', borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
                borderTop: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)',
                paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
                maxHeight: '80vh', overflowY: 'auto',
              }}
              onClick={e => e.stopPropagation()}
            >
              <div aria-hidden="true" style={{ width: '36px', height: '4px', background: 'var(--border)', borderRadius: '2px', margin: '12px auto 4px' }} />
              <div style={{ padding: '4px 0 8px' }}>
                {drawerSections.map(section => (
                  <div key={section.id}>
                    {section.label && <div style={{ ...sectionLabel, padding: '12px 20px 4px' }}>{section.label}</div>}
                    {section.items.map(item => (
                      <button key={item.id} style={drawerBtn(isActive(item, currentPage))} aria-current={isActive(item, currentPage) ? 'page' : undefined} disabled={item.disabled} onClick={() => activate(item)}>
                        <Icon type={item.icon} size={17} />
                        {item.label}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              <div style={{ borderTop: '1px solid var(--border)', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <Avatar name={name} initials={initials} colorKey={email} size={32} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.1px' }}>{name}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <ThemeToggle compact />
                  <button className="il-btn-ghost" onClick={() => supabase.auth.signOut()} style={{ height: '44px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '0 16px', fontSize: 'var(--text-md)', color: 'var(--text)', cursor: 'pointer', fontFamily: 'var(--font-heading)', fontWeight: 600 }}>
                    Sign out
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── DESKTOP LAYOUT ──
  // ClientLaunch's console rail: white, a hairline on its right edge, rows that
  // run edge to edge so the active one can be a 2px brand rule on the rail's
  // own left edge over the palest blue tint.
  const navItem = (active) => ({
    display: 'flex', alignItems: 'center', gap: '11px',
    height: '38px', padding: '0 20px 0 18px',
    borderRadius: 0, fontSize: 'var(--text-md)',
    color: active ? 'var(--text)' : 'var(--muted)',
    background: active ? 'var(--brand-light)' : 'transparent',
    fontWeight: active ? 500 : 400,
    cursor: 'pointer',
    border: 'none', borderLeft: `2px solid ${active ? 'var(--brand)' : 'transparent'}`,
    fontFamily: 'inherit', width: '100%', textAlign: 'left',
  })

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--surface)',
      display: 'grid', gridTemplateColumns: '240px minmax(0, 1fr)',
      fontFamily: 'var(--font)', color: 'var(--text)',
    }}>
      {skipLink}
      <aside style={{
        background: 'var(--surface)',
        borderRight: '1px solid var(--border-subtle)',
        padding: '22px 0 16px', display: 'flex', flexDirection: 'column',
        position: 'sticky', top: 0, height: '100vh', overflowY: 'auto',
      }}>
        <div style={{ padding: '0 20px 22px' }}>
          <BrandLockup size={26} sub="Integrated Launch" />
        </div>

        <nav aria-label="Main">
          {sections.map(section => (
            <div key={section.id}>
              {section.label && <div style={{ ...sectionLabel, padding: '16px 20px 6px' }}>{section.label}</div>}
              <div style={{ display: 'flex', flexDirection: 'column', marginBottom: '2px' }}>
                {section.items.map(item => {
                  const active = isActive(item, currentPage)
                  return (
                    <button key={item.id} className={`il-nav-item${active ? ' il-nav-active' : ''}`} aria-current={active ? 'page' : undefined} style={navItem(active)} disabled={item.disabled} onClick={() => activate(item)}>
                      <span style={{ display: 'inline-flex', color: active ? 'var(--brand)' : 'var(--subtle)' }}><Icon type={item.icon} /></span>
                      {item.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Identity on its own line, actions under a rule, as ClientLaunch's
            rail foot does. */}
        <div style={{ marginTop: 'auto', display: 'grid', gap: '12px', padding: '16px 20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <Avatar name={name} initials={initials} colorKey={email} size={32} />
            <div style={{ display: 'grid', minWidth: 0, lineHeight: 1.25 }}>
              <div title={email} style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ROLE_LABELS[userProfile?.role] || email}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }}>
            <button className="il-link-subtle" onClick={() => supabase.auth.signOut()} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', color: 'var(--subtle)', fontSize: 'var(--text-sm)', fontWeight: 500 }}>
              Sign out
            </button>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <main id="main" tabIndex={-1} style={{ display: 'flex', flexDirection: 'column', minWidth: 0, outline: 'none' }}>
        <div key={currentPage} className="il-page" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>{children}</div>
      </main>
    </div>
  )
}
