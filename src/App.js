import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { supabase, getUserProfile } from './supabaseClient'
import SetPassword from './pages/SetPassword'
import { pageToPath, pathToPage, planPath, parseInstanceId, ROLE } from './config'
import Button from './ui/Button'
import Field from './ui/Field'
import { T } from './ui/theme'
import { BrandLockup, BrandLogo, BrandMark } from './ui/Brand'


// Pages are split into their own chunks so the sign-in screen doesn't wait
// for the whole app to download. Once someone is signed in they're preloaded
// in the background, so navigating rarely has to wait.
const PAGE_LOADERS = {
  Dashboard: () => import('./pages/Dashboard'),
  NewOnboarding: () => import('./pages/NewOnboarding'),
  OnboardingPlan: () => import('./pages/OnboardingPlan'),
  Admin: () => import('./pages/Admin'),
  SuperAdmin: () => import('./pages/SuperAdmin'),
  TimeOff: () => import('./pages/TimeOff'),
  TechSupport: () => import('./pages/TechSupport'),
  EmployeePortal: () => import('./pages/EmployeePortal'),
}
const Dashboard = lazy(PAGE_LOADERS.Dashboard)
const NewOnboarding = lazy(PAGE_LOADERS.NewOnboarding)
const OnboardingPlan = lazy(PAGE_LOADERS.OnboardingPlan)
const Admin = lazy(PAGE_LOADERS.Admin)
const SuperAdmin = lazy(PAGE_LOADERS.SuperAdmin)
const TimeOff = lazy(PAGE_LOADERS.TimeOff)
const TechSupport = lazy(PAGE_LOADERS.TechSupport)
const EmployeePortal = lazy(PAGE_LOADERS.EmployeePortal)

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  'new-onboarding-select': 'New onboarding',
  'new-onboarding': 'New onboarding',
  plan: 'Onboarding plan',
  templates: 'Task templates',
  documents: 'Documents',
  'company-resources': 'Company resources',
  roles: 'Roles',
  history: 'History',
  'time-off': 'Time off',
  'tech-support': 'Tech support',
  'set-password': 'Set your password',
  'super-admin-users': 'Users',
  'super-admin-audit': 'Audit log',
  'super-admin-settings': 'System settings',
}

function FullPageSpinner() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} role="status" aria-label="Loading">
      <div className="il-spinner" />
    </div>
  )
}

// Admin-panel pages. Managers get a read-only dashboard and plans (see README),
// so these are limited to admins and super admins.
const ADMIN_PAGES = ['new-onboarding-select', 'templates', 'documents', 'company-resources', 'roles', 'history']

function App() {
  const [session, setSession] = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [page, setPage] = useState(() => {
    const hash = window.location.hash
    if (hash.includes('type=invite') || hash.includes('type=recovery')) return 'set-password'
    return pathToPage(window.location.pathname)
  })
  const [selectedRole, setSelectedRole] = useState(null)
  // Hydrate from the URL so /onboarding/plan/<id> restores on refresh/deep-link.
  const [activeInstanceId, setActiveInstanceId] = useState(() => parseInstanceId(window.location.pathname))
  const [refreshKey, setRefreshKey] = useState(0)
  const [forgotPassword, setForgotPassword] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [employeeView, setEmployeeView] = useState(() => localStorage.getItem('il-view-mode') === 'employee')
  // null | 'missing' (signed in, no profile row) | 'failed' (couldn't load)
  const [profileError, setProfileError] = useState(null)
  const profileUserId = useRef(null)

  const role = userProfile?.role
  const canManage = role === ROLE.ADMIN || role === ROLE.SUPER_ADMIN
  // Pages this user can't open, or that depend on state a refresh loses, fall
  // back somewhere sensible. Done in an effect (not mid-render) so the URL is
  // corrected too and React never sees a state update during render.
  const redirectTo =
    !userProfile || page === 'set-password' ? null
    : (page === 'time-off' || page === 'tech-support') && !canManage ? 'dashboard'
    : page.startsWith('super-admin') && role !== ROLE.SUPER_ADMIN ? 'dashboard'
    : ADMIN_PAGES.includes(page) && !canManage ? 'dashboard'
    : page === 'new-onboarding' && !selectedRole ? (canManage ? 'new-onboarding-select' : 'dashboard')
    : page === 'plan' && !activeInstanceId ? 'dashboard'
    : null

  // Warm the page chunks once signed in (idle time, so it never competes
  // with the first render).
  useEffect(() => {
    if (!session) return
    const warm = () => Object.values(PAGE_LOADERS).forEach(load => load().catch(() => {}))
    const id = window.requestIdleCallback ? window.requestIdleCallback(warm) : setTimeout(warm, 1500)
    return () => (window.cancelIdleCallback ? window.cancelIdleCallback(id) : clearTimeout(id))
  }, [session])

  // Tab title follows the page, so several open tabs are distinguishable.
  useEffect(() => {
    const label = !session ? 'Sign in' : employeeView || userProfile?.role === ROLE.EMPLOYEE ? 'My portal' : PAGE_TITLES[page]
    document.title = label ? `${label} · Integrated Launch` : 'Integrated Launch'
  }, [page, session, employeeView, userProfile])

  useEffect(() => {
    if (redirectTo) navigate(redirectTo, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navigate is stable in practice
  }, [redirectTo])

  useEffect(() => {
    const onPopState = () => {
      setPage(pathToPage(window.location.pathname))
      const id = parseInstanceId(window.location.pathname)
      if (id) setActiveInstanceId(id)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])


useEffect(() => {
  const hash = window.location.hash
  const isInviteLink = hash.includes('type=invite') || hash.includes('type=recovery')

  supabase.auth.getSession().then(({ data: { session } }) => {
    setSession(session)
    if (session) {
      fetchProfile(session.user.id)
      if (isInviteLink) {
        navigate('set-password', { replace: true })
      }
    } else {
      setProfileLoading(false)
    }
  })

  const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
    setSession(session)
    if (session) {
      // A token refresh only swaps the access token; the profile is unchanged.
      if (_event !== 'TOKEN_REFRESHED') fetchProfile(session.user.id)
      if (_event === 'SIGNED_IN' && (hash.includes('type=invite') || hash.includes('type=recovery'))) {
        navigate('set-password', { replace: true })
      }
    } else {
      profileUserId.current = null
      setUserProfile(null)
      setProfileError(null)
      setProfileLoading(false)
    }
  })

  return () => subscription.unsubscribe()
}, [])

  async function fetchProfile(userId) {
    // Supabase re-announces the same user on tab refocus. Only a new user gets
    // the full-screen spinner: showing it again would unmount every page and
    // throw away whatever the person was in the middle of.
    const firstLoad = profileUserId.current !== userId
    profileUserId.current = userId
    if (firstLoad) setProfileLoading(true)
    try {
      const profile = await getUserProfile(userId)
      setUserProfile(profile)
      setProfileError(profile ? null : 'missing')
    } catch (err) {
      console.error('Failed to load profile:', err)
      // A background refresh failing shouldn't lock out someone mid-session.
      if (firstLoad) setProfileError('failed')
    } finally {
      setProfileLoading(false)
    }
  }

  async function handleLogin() {
    if (authBusy) return
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    setError('')
    setAuthBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) {
      setError(error.message.includes('Invalid login credentials')
        ? 'Incorrect email or password.'
        : error.message.includes('Email not confirmed')
          ? 'Please use the link in your invite email to finish setting up your account first.'
          : error.message)
    }
    setAuthBusy(false)
  }

  async function handleForgotPassword() {
    if (authBusy) return
    if (!email.trim()) { setError('Please enter your email address first.'); return }
    setError('')
    setAuthBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin
    })
    if (error) setError(error.message)
    else setResetSent(true)
    setAuthBusy(false)
  }

  function navigate(targetPage, opts = {}) {
    const nextPath = targetPage === 'plan' && opts.instanceId
      ? planPath(opts.instanceId)
      : pageToPath(targetPage)
    if (opts.replace) window.history.replaceState({}, '', nextPath + window.location.hash)
    else if (window.location.pathname !== nextPath) window.history.pushState({}, '', nextPath)
    setPage(targetPage)
  }

  function handleNavigate(target) {
    if (target === 'employee-hub') {
      localStorage.setItem('il-view-mode', 'employee')
      setEmployeeView(true)
      return
    }
    setRefreshKey(k => k + 1)
    navigate(target === 'active' ? 'new-onboarding-select' : target)
  }

  if (!session) {
    const errorBox = error && (
      <div role="alert" style={{ fontSize: 'var(--text-sm)', color: T.danger, marginBottom: '16px', padding: '10px 12px', background: T.dangerBg, border: `1px solid ${T.dangerBorder}`, borderRadius: T.radiusSm, lineHeight: 1.5 }}>
        {error}
      </div>
    )

    // The same split sign-in as ClientLaunch: the form on the left, the ISL
    // panel on the right. Layout lives in styles/signin.css (copied from
    // ClientLaunch); the form inside it is Integrated Launch's own.
    return (
      <div className="signin">
        <main className="signin__panel">
          <div className="signin__form">
            <BrandLockup size={34} sub="Integrated Launch" />
            <h1 className="signin__title">
              {resetSent ? 'Check your email' : forgotPassword ? 'Reset your password' : 'Welcome back'}
            </h1>
            <p className="signin__sub">
              {resetSent ? 'A reset link is on its way.' : forgotPassword ? 'We’ll email you a link to set a new one.' : 'Sign in with your work email and password.'}
            </p>

            {resetSent ? (
              <>
                <p style={{ fontSize: 'var(--text-md)', color: T.muted, lineHeight: 1.6, margin: '0 0 20px' }}>
                  If an account exists for <strong style={{ color: T.text, fontWeight: 500 }}>{email}</strong>, you’ll get an email with a link to set a new password. It can take a minute to arrive.
                </p>
                <Button variant="secondary" size="lg" fullWidth onClick={() => { setResetSent(false); setForgotPassword(false) }}>
                  Back to sign in
                </Button>
              </>
            ) : (
              <form onSubmit={e => { e.preventDefault(); forgotPassword ? handleForgotPassword() : handleLogin() }} noValidate>
                <Field label="Email">
                  <input id="login-email" type="email" autoComplete="username" inputMode="email" placeholder="you@integratedstaffing.ca"
                    value={email} onChange={e => setEmail(e.target.value)} autoFocus />
                </Field>
                {!forgotPassword && (
                  <Field label="Password" style={{ marginBottom: '0' }}>
                    <input id="login-password" type="password" autoComplete="current-password" placeholder="••••••••"
                      value={password} onChange={e => setPassword(e.target.value)} />
                  </Field>
                )}
                {!forgotPassword && (
                  <button type="button" className="signin__forgot" onClick={() => { setForgotPassword(true); setError('') }}>
                    Forgot password?
                  </button>
                )}
                <div style={{ marginTop: '20px' }}>
                  {errorBox}
                  <Button type="submit" size="lg" fullWidth busy={authBusy} busyLabel={forgotPassword ? 'Sending…' : 'Signing in…'}>
                    {forgotPassword ? 'Send reset link' : 'Sign in'}
                  </Button>
                </div>
                {forgotPassword && (
                  <Button variant="secondary" size="lg" fullWidth style={{ marginTop: '10px' }}
                    onClick={() => { setForgotPassword(false); setError('') }}>
                    Back to sign in
                  </Button>
                )}
              </form>
            )}
          </div>

          <footer className="signin__foot">
            <span>© {new Date().getFullYear()} Integrated Staffing Limited</span>
          </footer>
        </main>

        <aside className="signin__brand" aria-hidden="true">
          <span className="signin__watermark">
            <BrandMark size={560} tone="inverse" />
          </span>
          <BrandLogo className="signin__logo" />
        </aside>
      </div>
    )
  }

  if (profileLoading) return <FullPageSpinner />

  if (page === 'set-password') {
    return <SetPassword onComplete={() => navigate('dashboard')} />
  }

  if (userProfile?.deactivated || profileError) {
    const failed = profileError === 'failed'
    const title = failed ? 'We couldn’t load your account'
      : userProfile?.deactivated ? 'Account deactivated'
      : 'Your account isn’t set up yet'
    const message = failed ? 'Check your connection and try again.'
      : userProfile?.deactivated ? 'Your account has been deactivated. Please contact HR if you believe this is an error.'
      : 'You’re signed in, but no access has been assigned to this account. Please contact HR to finish setting it up.'
    return (
      <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.font, padding: '20px' }}>
        <div className="il-auth" role="alert" style={{ textAlign: 'center', maxWidth: '380px' }}>
          <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: T.text, marginBottom: '8px' }}>{title}</div>
          <div style={{ fontSize: 'var(--text-base)', color: T.muted, marginBottom: '24px', lineHeight: 1.6 }}>{message}</div>
          <div style={{ fontSize: 'var(--text-sm)', color: T.subtle, marginBottom: '16px' }}>Signed in as {session.user.email}</div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
            {failed && (
              <Button onClick={() => { profileUserId.current = null; fetchProfile(session.user.id) }}>Try again</Button>
            )}
            <Button variant="secondary" onClick={() => supabase.auth.signOut()}>Sign out</Button>
          </div>
        </div>
      </div>
    )
  }

  return <Suspense fallback={<FullPageSpinner />}>{renderPage()}</Suspense>

  function renderPage() {
    if (userProfile?.role === ROLE.EMPLOYEE) {
      return <EmployeePortal session={session} userProfile={userProfile} />
    }

    if (employeeView && userProfile?.employee_id) {
      return (
        <EmployeePortal
          session={session}
          userProfile={userProfile}
          onSwitchToAdmin={() => {
            localStorage.removeItem('il-view-mode')
            setEmployeeView(false)
          }}
        />
      )
    }

    if (page.startsWith('super-admin') && role === ROLE.SUPER_ADMIN) {
      return (
        <SuperAdmin
          session={session}
          userProfile={userProfile}
          currentPage={page}
          onNavigate={handleNavigate}
        />
      )
    }

    if (page === 'new-onboarding' && selectedRole) {
      return (
        <NewOnboarding
          session={session}
          userProfile={userProfile}
          roleId={selectedRole.id}
          roleName={selectedRole.name}
          roleBrand={selectedRole.brand}
          onBack={() => { setRefreshKey(k => k + 1); navigate('dashboard') }}
          onNavigate={handleNavigate}
          onComplete={(instanceId) => {
            setActiveInstanceId(instanceId)
            navigate('plan', { instanceId })
          }}
        />
      )
    }

    if (page === 'plan' && activeInstanceId) {
      return (
        <OnboardingPlan
          session={session}
          userProfile={userProfile}
          instanceId={activeInstanceId}
          onBack={() => { setRefreshKey(k => k + 1); navigate('dashboard') }}
          onNavigate={handleNavigate}
        />
      )
    }

    if (page === 'time-off' && canManage) {
      return (
        <TimeOff
          session={session}
          userProfile={userProfile}
          onNavigate={handleNavigate}
        />
      )
    }

    if (page === 'tech-support' && canManage) {
      return (
        <TechSupport
          session={session}
          userProfile={userProfile}
          onNavigate={handleNavigate}
        />
      )
    }

    if (ADMIN_PAGES.includes(page) && canManage) {
      return (
        <Admin
          session={session}
          userProfile={userProfile}
          initialTab={page}
          onBack={() => { setRefreshKey(k => k + 1); navigate('dashboard') }}
          onNavigate={handleNavigate}
          onStartOnboarding={(role) => {
            setSelectedRole(role)
            navigate('new-onboarding')
          }}
          onViewOnboarding={(instanceId) => {
            setActiveInstanceId(instanceId)
            navigate('plan', { instanceId })
          }}
        />
      )
    }

    return (
      <Dashboard
        session={session}
        userProfile={userProfile}
        refreshKey={refreshKey}
        onNavigate={handleNavigate}
        onStartOnboarding={(role) => {
          setSelectedRole(role)
          navigate('new-onboarding')
        }}
        onViewOnboarding={(instanceId) => {
          setActiveInstanceId(instanceId)
          navigate('plan', { instanceId })
        }}
      />
    )
  }
}

export default App