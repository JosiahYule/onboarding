import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useWindowSize } from '../hooks/useWindowSize'
import { ROLE } from '../config'
import { isSalesRep, openClientPortal } from '../utils/clientPortal'
import { displayNameFromEmail } from '../utils/formatUtils'
import ThemeToggle from '../ui/ThemeToggle'

// Pages that count as a primary tab on mobile; anything else lights up "More".
const PRIMARY_PAGES = ['dashboard', 'active', 'new-onboarding-select', 'time-off']

// The sidebar (desktop) and the "More" drawer (mobile) are built from the same
// list, so the two can't drift apart. Each section only appears when it has at
// least one item this user can use.
function buildSections(userProfile, { onPortal, portalOpening }) {
  const role = userProfile?.role
  const canManage = role === ROLE.ADMIN || role === ROLE.SUPER_ADMIN
  const hub = [
    canManage && { id: 'time-off', label: 'Time off', icon: 'calendar' },
    userProfile?.employee_id && { id: 'employee-hub', label: 'My portal', icon: 'person' },
    // A sales rep may sit anywhere on the role ladder, so this is gated on the
    // capability flag rather than on role.
    isSalesRep(userProfile) && { id: 'client-packages', label: portalOpening ? 'Opening…' : 'Client packages', icon: 'external', onClick: onPortal, disabled: portalOpening },
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
  if (type === 'external') return <svg {...c}><path d="M8 2h4v4M12 2L6.5 7.5"/><path d="M10.5 8.5V12h-8.5V3.5H5.5"/></svg>
  if (type === 'dots') return <svg width={size} height={size} viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><circle cx="3" cy="7" r="1.3"/><circle cx="7" cy="7" r="1.3"/><circle cx="11" cy="7" r="1.3"/></svg>
  return null
}

function BrandMark({ size = 26 }) {
  return (
    <div aria-hidden="true" style={{ width: size, height: size, background: 'linear-gradient(135deg, #004db3 0%, #0080ff 100%)', borderRadius: Math.round(size * 0.27), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: size >= 26 ? '11px' : '10px', fontWeight: 700, letterSpacing: '-0.2px', flexShrink: 0, boxShadow: '0 1px 2px rgba(0,77,179,0.3)' }}>
      IL
    </div>
  )
}

function UserAvatar({ initials, size }) {
  return (
    <div aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', background: 'linear-gradient(135deg, #1a1a2e 0%, #374151 100%)', color: '#fff', fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {initials}
    </div>
  )
}

const sectionLabel = { fontSize: '11px', color: 'var(--subtle)', fontWeight: 500, letterSpacing: '0.3px', textTransform: 'uppercase' }

export default function Layout({ session, userProfile, currentPage, onNavigate, children }) {
  const { isMobile } = useWindowSize()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [portalOpening, setPortalOpening] = useState(false)
  const [portalError, setPortalError] = useState('')

  // The client portal is a separate app on its own Supabase project; this
  // signs the rep in there without a second password.
  async function handleOpenClientPortal() {
    if (portalOpening) return
    setPortalOpening(true)
    setPortalError('')
    try {
      await openClientPortal()
    } catch (err) {
      setPortalError(err.message)
    } finally {
      setPortalOpening(false)
    }
  }

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = e => { if (e.key === 'Escape') setDrawerOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const sections = buildSections(userProfile, { onPortal: handleOpenClientPortal, portalOpening })
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
  const portalErrorNote = portalError && (
    <div role="alert" style={{ fontSize: '11px', color: 'var(--danger)', padding: '2px 12px 4px', lineHeight: 1.4 }}>{portalError}</div>
  )

  // ── MOBILE LAYOUT ──
  if (isMobile) {
    const tab = (active) => ({
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: '3px', height: '56px',
      background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
      color: active ? 'var(--brand)' : 'var(--subtle)',
      fontSize: '10px', fontWeight: active ? 600 : 500,
      padding: '6px 4px 4px',
    })

    const drawerBtn = (active) => ({
      display: 'flex', alignItems: 'center', gap: '14px',
      padding: '13px 20px', width: '100%',
      background: active ? 'var(--hover-bg)' : 'none',
      border: 'none', fontSize: '15px',
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
          boxShadow: '0 1px 0 var(--border)',
          height: '54px', display: 'flex', alignItems: 'center', padding: '0 16px', gap: '10px',
        }}>
          <BrandMark size={24} />
          <div style={{ fontSize: '14px', fontWeight: 600, letterSpacing: '-0.3px', color: 'var(--text)' }}>Integrated Launch</div>
        </header>

        <main id="main" tabIndex={-1} style={{ paddingBottom: 'calc(64px + env(safe-area-inset-bottom, 0px))', outline: 'none' }}>
          <div key={currentPage} className="il-page">{children}</div>
        </main>

        <nav aria-label="Main" className="il-tabbar" style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          boxShadow: '0 -1px 0 var(--border)',
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
                background: 'var(--surface)', borderRadius: '16px 16px 0 0',
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
                {portalErrorNote}
              </div>
              <div style={{ borderTop: '1px solid var(--border)', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <UserAvatar initials={initials} size="30px" />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.1px' }}>{name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <ThemeToggle compact />
                  <button className="il-btn-ghost" onClick={() => supabase.auth.signOut()} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '7px', padding: '7px 14px', fontSize: '13px', color: 'var(--muted)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
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
  const navItem = (active) => ({
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '7px 12px',
    borderRadius: '7px', fontSize: '13px',
    color: active ? 'var(--brand)' : 'var(--muted)',
    background: active ? 'var(--brand-light)' : 'transparent',
    fontWeight: active ? 500 : 400,
    cursor: 'pointer',
    border: 'none',
    fontFamily: 'inherit', width: '100%', textAlign: 'left',
    letterSpacing: '-0.1px',
  })

  return (
    <div style={{
      minHeight: '100vh', background: 'transparent',
      display: 'grid', gridTemplateColumns: '240px 1fr',
      fontFamily: 'var(--font)', color: 'var(--text)',
    }}>
      {skipLink}
      <aside style={{
        background: 'var(--glass)', backdropFilter: 'var(--glass-filter)', WebkitBackdropFilter: 'var(--glass-filter)',
        borderRight: '1px solid var(--border)',
        padding: '0 10px', display: 'flex', flexDirection: 'column',
        position: 'sticky', top: 0, height: '100vh', overflowY: 'auto',
      }}>
        <div style={{ padding: '22px 12px 20px', display: 'flex', alignItems: 'center', gap: '9px' }}>
          <BrandMark />
          <div style={{ fontSize: '14px', fontWeight: 600, letterSpacing: '-0.3px', color: 'var(--text)' }}>Integrated Launch</div>
        </div>

        <nav aria-label="Main">
          {sections.map(section => (
            <div key={section.id}>
              {section.label && <div style={{ ...sectionLabel, padding: '14px 12px 4px' }}>{section.label}</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '4px' }}>
                {section.items.map(item => {
                  const active = isActive(item, currentPage)
                  return (
                    <button key={item.id} className={`il-nav-item${active ? ' il-nav-active' : ''}`} aria-current={active ? 'page' : undefined} style={navItem(active)} disabled={item.disabled} onClick={() => activate(item)}>
                      <Icon type={item.icon} />
                      {item.label}
                    </button>
                  )
                })}
                {section.id === 'hub' && portalErrorNote}
              </div>
            </div>
          ))}
        </nav>

        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', padding: '14px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <UserAvatar initials={initials} size="28px" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div title={email} style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
              <button className="il-link-subtle" onClick={() => supabase.auth.signOut()} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', color: 'var(--subtle)', fontSize: '11px', display: 'block', textAlign: 'left', letterSpacing: 0 }}>
                Sign out
              </button>
            </div>
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
