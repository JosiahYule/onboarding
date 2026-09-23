import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import Layout from '../components/Layout'
import Toast from '../components/Toast'
import ConfirmModal from '../components/ConfirmModal'
import { SkeletonLine } from '../components/Skeleton'
import useToast from '../hooks/useToast'
import { handleSupabaseError } from '../utils/handleError'
import { logAudit } from '../utils/auditLog'
import { clearSettingsCache } from '../utils/getHrEmail'
import { humanize } from '../utils/formatUtils'
import { formatDate } from '../utils/dates'
import { useWindowSize } from '../hooks/useWindowSize'
import { ROLE, BRANDS, brandName } from '../config'
import PageHeader from '../ui/PageHeader'
import Button from '../ui/Button'
import Field from '../ui/Field'
import Segmented from '../ui/Segmented'
import SearchInput from '../ui/SearchInput'
import EmptyState, { EmptyIcons } from '../ui/EmptyState'
import { T } from '../ui/theme'

const ACTION_LABELS = {
  onboarding_created: 'Onboarding created',
  onboarding_completed: 'Onboarding marked complete',
  onboarding_archived: 'Onboarding archived',
  onboarding_reactivated: 'Onboarding reactivated',
  employee_deleted: 'Employee deleted',
  employee_edited: 'Employee edited',
  role_changed: 'Role changed',
  user_deactivated: 'User deactivated',
  user_reactivated: 'User reactivated',
  document_hidden: 'Document hidden',
  document_restored: 'Document restored',
  system_setting_updated: 'System setting updated',
  task_added: 'Task added to a plan',
  task_removed: 'Task removed from a plan',
  role_deleted: 'Role deleted',
  document_removed: 'Document removed',
  resource_removed: 'Company resource removed',
  time_off_requested: 'Time off requested',
  time_off_approved: 'Time off approved',
  time_off_denied: 'Time off denied',
  time_off_cancelled: 'Time off cancelled',
  client_portal_opened: 'Client portal opened',
}

const CHANGEABLE_ROLES = [ROLE.ADMIN, ROLE.MANAGER, ROLE.EMPLOYEE]
const ROLE_HINTS = {
  [ROLE.ADMIN]: 'Can start and manage onboardings, templates, documents and time off.',
  [ROLE.MANAGER]: 'Read-only view of the dashboard and onboarding plans.',
  [ROLE.EMPLOYEE]: 'Their own onboarding portal only.',
}

const s = {
  card: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, boxShadow: T.shadowSm },
  th: { fontSize: '11px', fontWeight: 600, color: T.subtle, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '10px 12px', textAlign: 'left', borderBottom: `1px solid ${T.border}`, background: T.surfaceSunken, whiteSpace: 'nowrap' },
  td: { fontSize: '13px', color: T.text, padding: '12px', borderBottom: `1px solid ${T.borderSubtle}`, verticalAlign: 'middle' },
  statusDot: (active) => ({ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: active ? T.success : T.subtle, flexShrink: 0 }),
  badge: (role) => {
    const colors = {
      super_admin: { bg: 'color-mix(in srgb, #7c5cff 18%, var(--surface))', color: 'color-mix(in srgb, #7c5cff 75%, var(--text))' },
      admin: { bg: T.brandLight, color: T.brand },
      manager: { bg: T.successBg, color: T.success },
      employee: { bg: T.hoverBg, color: T.muted },
    }
    const c = colors[role] || colors.employee
    return { fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '99px', background: c.bg, color: c.color, whiteSpace: 'nowrap' }
  },
  muted: { fontSize: '12px', color: T.muted },
}

const TAB_ITEMS = [
  { id: 'super-admin-users', label: 'Users' },
  { id: 'super-admin-audit', label: 'Audit log' },
  { id: 'super-admin-settings', label: 'Settings' },
]

export default function SuperAdmin({ session, userProfile, currentPage, onNavigate }) {
  const { isMobile } = useWindowSize()
  const tab = TAB_ITEMS.some(t => t.id === currentPage) ? currentPage : 'super-admin-users'
  const subtitle = {
    'super-admin-users': 'Who can sign in, and what they can do.',
    'super-admin-audit': 'A record of every significant change, newest first.',
    'super-admin-settings': 'Addresses and options used across the app.',
  }[tab]

  return (
    <Layout session={session} userProfile={userProfile} currentPage={currentPage} onNavigate={onNavigate}>
      <PageHeader
        title="System"
        subtitle={isMobile ? null : subtitle}
        tabs={{ mode: 'nav', label: 'System sections', items: TAB_ITEMS, value: tab, onChange: onNavigate }}
      />
      <div style={{ padding: isMobile ? '20px 16px 40px' : '28px 40px 48px', maxWidth: isMobile ? 'none' : '980px' }}>
        {tab === 'super-admin-users' && <UsersTab isMobile={isMobile} currentUserId={session?.user?.id} />}
        {tab === 'super-admin-audit' && <AuditLogTab isMobile={isMobile} />}
        {tab === 'super-admin-settings' && <SystemSettingsTab />}
      </div>
    </Layout>
  )
}

function roleLabel(role) {
  return role ? humanize(role) : 'No profile'
}

function UsersTab({ isMobile, currentUserId }) {
  const [users, setUsers] = useState([])
  const [allEmployees, setAllEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [showInvitePanel, setShowInvitePanel] = useState(false)
  const [inviteMode, setInviteMode] = useState('employees')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState(ROLE.EMPLOYEE)
  const [inviteBrand, setInviteBrand] = useState('')
  const [pendingInvite, setPendingInvite] = useState(null)
  const [pendingRole, setPendingRole] = useState(ROLE.EMPLOYEE)
  const [inviting, setInviting] = useState(false)
  const [query, setQuery] = useState('')
  const [confirm, setConfirm] = useState(null)
  const { toast, showToast, hideToast } = useToast()

  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch functions are stable, mount-only fetch
  useEffect(() => { fetchUsers(); fetchAllEmployees() }, [])

  async function fetchUsers() {
    const { data, error } = await supabase.rpc('get_all_users_admin')
    if (error) showToast(handleSupabaseError(error, 'Failed to load users.'), 'error')
    else setUsers(data || [])
    setLoading(false)
  }

  async function fetchAllEmployees() {
    const { data } = await supabase.from('employees').select('id, full_name, email, brand').order('full_name')
    if (data) setAllEmployees(data)
  }

  const linkedEmployeeIds = useMemo(() => new Set(users.filter(u => u.employee_id).map(u => u.employee_id)), [users])
  const unlinkedEmployees = useMemo(() => allEmployees.filter(e => !linkedEmployeeIds.has(e.id)), [allEmployees, linkedEmployeeIds])

  async function sendInviteToEmployee(employee, role) {
    setInviting(true)
    const { data, error } = await supabase.functions.invoke('invite-user', {
      body: { email: employee.email, role, employee_id: employee.id, brand: employee.brand },
    })
    setInviting(false)
    if (error || data?.error) {
      showToast(data?.error || 'Failed to send invite.', 'error')
    } else {
      showToast(`Invite sent to ${employee.email}`)
      setPendingInvite(null)
      fetchUsers()
      fetchAllEmployees()
    }
  }

  async function sendManualInvite(e) {
    e?.preventDefault()
    if (!inviteEmail.trim() || inviting) return
    setInviting(true)
    const { data, error } = await supabase.functions.invoke('invite-user', {
      body: { email: inviteEmail.trim(), role: inviteRole, brand: inviteBrand || null },
    })
    setInviting(false)
    if (error || data?.error) {
      showToast(data?.error || 'Failed to send invite.', 'error')
    } else {
      showToast(`Invite sent to ${inviteEmail.trim()}`)
      setInviteEmail('')
      setInviteRole(ROLE.EMPLOYEE)
      setInviteBrand('')
      fetchUsers()
    }
  }

  // Access changes are easy to fat-finger in a dropdown and hard to notice
  // afterwards, so each one is confirmed first.
  function requestRoleChange(user, newRole) {
    if (newRole === user.role) return
    setConfirm({
      title: 'Change access level?',
      message: `${user.email} will go from ${roleLabel(user.role)} to ${roleLabel(newRole)}. ${ROLE_HINTS[newRole] || ''}`,
      confirmLabel: `Make ${roleLabel(newRole).toLowerCase()}`,
      confirmDanger: false,
      onConfirm: async () => {
        const { error } = await supabase.from('user_profiles').update({ role: newRole }).eq('id', user.id)
        setConfirm(null)
        if (error) { showToast(handleSupabaseError(error, 'Failed to update role.'), 'error'); return }
        await logAudit('role_changed', 'user', user.id, { user_email: user.email, new_role: newRole })
        showToast('Access updated')
        fetchUsers()
      },
    })
  }

  function requestToggleDeactivated(user) {
    const deactivating = !user.deactivated
    setConfirm({
      title: deactivating ? 'Deactivate this account?' : 'Reactivate this account?',
      message: deactivating
        ? `${user.email} will be signed out of Integrated Launch and blocked from signing back in. You can reactivate them later.`
        : `${user.email} will be able to sign in again with their existing access.`,
      confirmLabel: deactivating ? 'Deactivate' : 'Reactivate',
      confirmDanger: deactivating,
      onConfirm: async () => {
        const { error } = await supabase.from('user_profiles').update({ deactivated: deactivating }).eq('id', user.id)
        setConfirm(null)
        if (error) { showToast(handleSupabaseError(error, 'Failed to update user status.'), 'error'); return }
        await logAudit(deactivating ? 'user_deactivated' : 'user_reactivated', 'user', user.id, { user_email: user.email })
        showToast(deactivating ? 'User deactivated' : 'User reactivated')
        fetchUsers()
      },
    })
  }

  const q = query.trim().toLowerCase()
  const visibleUsers = q
    ? users.filter(u => [u.email, u.role, brandName(u.brand)].some(v => (v || '').toLowerCase().includes(q)))
    : users

  function roleControl(u) {
    const isSelf = u.id === currentUserId
    if (u.role === ROLE.SUPER_ADMIN || !u.role || u.role === 'none') return <span style={s.badge(u.role)}>{roleLabel(u.role)}</span>
    return (
      <select className="il-input" aria-label={`Access level for ${u.email}`} disabled={isSelf}
        style={{ width: 'auto', padding: '5px 8px', fontSize: '12px' }}
        value={u.role} onChange={e => requestRoleChange(u, e.target.value)}>
        {CHANGEABLE_ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
      </select>
    )
  }

  function statusControl(u) {
    if (u.role === ROLE.SUPER_ADMIN || !u.role || u.role === 'none' || u.id === currentUserId) return null
    return (
      <Button size="xs" variant={u.deactivated ? 'secondary' : 'danger-outline'} onClick={() => requestToggleDeactivated(u)}>
        {u.deactivated ? 'Reactivate' : 'Deactivate'}
      </Button>
    )
  }

  const status = (u) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: u.deactivated ? T.muted : T.success, fontWeight: 500 }}>
      <span style={s.statusDot(!u.deactivated)} aria-hidden="true" />{u.deactivated ? 'Deactivated' : 'Active'}
    </span>
  )

  return (
    <>
      {/* ── Invite panel ── */}
      <section style={{ ...s.card, marginBottom: '20px', overflow: 'hidden' }}>
        <button
          type="button"
          aria-expanded={showInvitePanel}
          onClick={() => setShowInvitePanel(o => !o)}
          className="il-btn-ghost"
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '14px 18px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: T.text }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', textAlign: 'left' }}>
            <span style={{ fontSize: '13px', fontWeight: 600 }}>Invite someone</span>
            {unlinkedEmployees.length > 0 && (
              <span style={{ fontSize: '11px', fontWeight: 600, background: T.brandLight, color: T.brand, padding: '2px 8px', borderRadius: '99px' }}>
                {unlinkedEmployees.length} employee{unlinkedEmployees.length !== 1 ? 's' : ''} without a login
              </span>
            )}
          </span>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={{ color: T.subtle, transform: showInvitePanel ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
            <path d="M1.5 3.5L5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {showInvitePanel && (
          <div className="il-tab-content" style={{ borderTop: `1px solid ${T.border}`, padding: '16px 18px' }}>
            <div style={{ marginBottom: '14px' }}>
              <Segmented size="sm" label="How to invite" value={inviteMode} onChange={setInviteMode} options={[
                { value: 'employees', label: `Employees without a login (${unlinkedEmployees.length})` },
                { value: 'manual', label: 'By email' },
              ]} />
            </div>

            {inviteMode === 'employees' && (
              unlinkedEmployees.length === 0 ? (
                <div style={{ fontSize: '13px', color: T.subtle, padding: '4px 0' }}>Every employee already has a login.</div>
              ) : (
                unlinkedEmployees.map(emp => (
                  <div key={emp.id} style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? '10px' : '12px', padding: '10px 0', borderBottom: `1px solid ${T.borderSubtle}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: T.text }}>{emp.full_name}</div>
                      <div style={s.muted}>{emp.email || 'No email on file'}{emp.brand ? ` · ${brandName(emp.brand)}` : ''}</div>
                    </div>
                    {pendingInvite === emp.id ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <select className="il-input" aria-label={`Access level for ${emp.full_name}`} style={{ width: 'auto', padding: '5px 8px', fontSize: '12px' }} value={pendingRole} onChange={e => setPendingRole(e.target.value)}>
                          {CHANGEABLE_ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                        </select>
                        <Button size="xs" busy={inviting} busyLabel="Sending…" onClick={() => sendInviteToEmployee(emp, pendingRole)}>Send invite</Button>
                        <Button size="xs" variant="ghost" onClick={() => setPendingInvite(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <Button size="xs" variant="secondary" disabled={!emp.email} title={emp.email ? undefined : 'Add an email to this employee first'}
                        onClick={() => { setPendingInvite(emp.id); setPendingRole(ROLE.EMPLOYEE) }}>
                        Invite…
                      </Button>
                    )}
                  </div>
                ))
              )
            )}

            {inviteMode === 'manual' && (
              <form onSubmit={sendManualInvite} noValidate style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1.2fr) auto', gap: '0 10px', alignItems: 'end' }}>
                <Field label="Email"><input type="email" placeholder="name@integratedstaffing.ca" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} /></Field>
                <Field label="Access">
                  <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
                    {CHANGEABLE_ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                  </select>
                </Field>
                <Field label="Agency" optional>
                  <select value={inviteBrand} onChange={e => setInviteBrand(e.target.value)}>
                    <option value="">None</option>
                    {BRANDS.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
                  </select>
                </Field>
                <div style={{ marginBottom: '18px' }}>
                  <Button type="submit" busy={inviting} busyLabel="Sending…" disabled={!inviteEmail.trim()}>Send invite</Button>
                </div>
              </form>
            )}
          </div>
        )}
      </section>

      {/* ── Users list ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px', maxWidth: '320px' }}>
          <SearchInput value={query} onChange={setQuery} placeholder="Search by email, access or agency" label="Search users" />
        </div>
        {!loading && <span aria-live="polite" style={{ fontSize: '12px', color: T.subtle, marginLeft: 'auto' }}>{visibleUsers.length} of {users.length} users</span>}
      </div>

      {loading ? (
        <div style={{ ...s.card, padding: '8px 16px' }} aria-busy="true">
          {[1, 2, 3, 4].map(i => <div key={i} style={{ padding: '14px 0', borderBottom: `1px solid ${T.borderSubtle}` }}><SkeletonLine width={`${35 + i * 10}%`} /></div>)}
        </div>
      ) : visibleUsers.length === 0 ? (
        <div style={s.card}><EmptyState icon={EmptyIcons.search} title={users.length ? 'No matches' : 'No users yet'} message={users.length ? `Nobody matches “${query}”.` : 'Invite someone above to get started.'} /></div>
      ) : isMobile ? (
        <div>
          {visibleUsers.map(u => (
            <div key={u.id} style={{ ...s.card, padding: '14px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '10px' }}>
                <div style={{ fontSize: '13px', color: T.text, wordBreak: 'break-all', lineHeight: 1.4, fontWeight: 500 }}>{u.email}</div>
                {status(u)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                {roleControl(u)}
                {u.brand && <span style={s.muted}>{brandName(u.brand)}</span>}
              </div>
              <div style={{ fontSize: '11px', color: T.subtle, marginBottom: statusControl(u) ? '10px' : 0 }}>
                Joined {u.created_at ? formatDate(u.created_at, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'} · Last sign-in {u.last_sign_in_at ? formatDate(u.last_sign_in_at, { month: 'short', day: 'numeric', year: 'numeric' }) : 'never'}
              </div>
              {statusControl(u)}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ ...s.card, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={s.th} scope="col">User</th>
                <th style={s.th} scope="col">Access</th>
                <th style={s.th} scope="col">Agency</th>
                <th style={s.th} scope="col">Last sign-in</th>
                <th style={s.th} scope="col">Status</th>
                <th style={s.th} scope="col"><span className="il-visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map(u => (
                <tr key={u.id} className="il-row">
                  <td style={s.td}>
                    <div style={{ fontWeight: 500 }}>{u.email}{u.id === currentUserId && <span style={{ ...s.muted, fontWeight: 400 }}> (you)</span>}</div>
                    <div style={{ fontSize: '11px', color: T.subtle, marginTop: '2px' }}>Joined {u.created_at ? formatDate(u.created_at, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</div>
                  </td>
                  <td style={s.td}>{roleControl(u)}</td>
                  <td style={{ ...s.td, ...s.muted }}>{brandName(u.brand) || '—'}</td>
                  <td style={{ ...s.td, ...s.muted }} className="il-tabular">{u.last_sign_in_at ? formatDate(u.last_sign_in_at, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never'}</td>
                  <td style={s.td}>{status(u)}</td>
                  <td style={{ ...s.td, textAlign: 'right' }}>{statusControl(u)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirm && <ConfirmModal {...confirm} onCancel={() => setConfirm(null)} />}
      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onClose={hideToast} />}
    </>
  )
}

function AuditLogTab({ isMobile }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterAction, setFilterAction] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [logLimit, setLogLimit] = useState(100)
  const { toast, showToast, hideToast } = useToast()

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(logLimit)

    if (filterAction) query = query.eq('action', filterAction)
    // Date filters are local calendar days, converted to exact instants so the
    // database compares them correctly (not as UTC midnight).
    if (filterFrom) query = query.gte('created_at', new Date(`${filterFrom}T00:00:00`).toISOString())
    if (filterTo) query = query.lte('created_at', new Date(`${filterTo}T23:59:59.999`).toISOString())

    const { data, error } = await query
    if (error) showToast(handleSupabaseError(error, 'Failed to load the audit log.'), 'error')
    setLogs(data || [])
    setLoading(false)
  }, [filterAction, filterFrom, filterTo, logLimit, showToast])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  function formatTime(ts) {
    if (!ts) return '—'
    return new Date(ts).toLocaleString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  // A human description of what an entry touched, from whatever the logger
  // recorded (names are more useful than ids).
  function describeEntity(log) {
    const m = log.metadata || {}
    const parts = []
    const subject = m.employee_name || m.user_email || m.role_name || m.document_name || m.task_name
    if (subject) parts.push(subject)
    if (m.task_name && m.task_name !== subject) parts.push(`“${m.task_name}”`)
    if (m.new_role) parts.push(`→ ${roleLabel(m.new_role)}`)
    if (m.role && !m.new_role) parts.push(m.role)
    if (m.type) parts.push(humanize(m.type))
    if (m.days) parts.push(`${m.days}d`)
    if (log.action === 'system_setting_updated') parts.push(`${humanize(log.entity_id || '')}: “${m.value ?? ''}”`)
    if (parts.length === 0 && log.entity_type) parts.push(humanize(log.entity_type))
    return parts.join(' · ')
  }

  const hasFilters = filterAction || filterFrom || filterTo

  return (
    <>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <select className="il-input" aria-label="Filter by action" style={{ width: isMobile ? '100%' : 'auto', minWidth: '200px' }} value={filterAction} onChange={e => { setFilterAction(e.target.value); setLogLimit(100) }}>
          <option value="">All actions</option>
          {Object.entries(ACTION_LABELS).sort((a, b) => a[1].localeCompare(b[1])).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flex: isMobile ? '1 1 100%' : undefined }}>
          <input className="il-input" aria-label="From date" style={{ flex: 1, width: 'auto', minWidth: '130px' }} type="date" value={filterFrom} onChange={e => { setFilterFrom(e.target.value); setLogLimit(100) }} />
          <span style={{ fontSize: 12, color: T.subtle, flexShrink: 0 }}>to</span>
          <input className="il-input" aria-label="To date" style={{ flex: 1, width: 'auto', minWidth: '130px' }} type="date" value={filterTo} min={filterFrom || undefined} onChange={e => { setFilterTo(e.target.value); setLogLimit(100) }} />
        </div>
        {hasFilters && (
          <Button size="sm" variant="ghost" onClick={() => { setFilterAction(''); setFilterFrom(''); setFilterTo(''); setLogLimit(100) }}>Clear filters</Button>
        )}
      </div>

      <div style={{ ...s.card, overflow: 'hidden' }}>
        {loading && logs.length === 0 ? (
          <div style={{ padding: '8px 16px' }} aria-busy="true">
            {[1, 2, 3, 4, 5].map(i => <div key={i} style={{ padding: '14px 0', borderBottom: `1px solid ${T.borderSubtle}` }}><SkeletonLine width={`${30 + i * 9}%`} /></div>)}
          </div>
        ) : logs.length === 0 ? (
          <EmptyState icon={EmptyIcons.list} title={hasFilters ? 'No matching entries' : 'No audit entries yet'} message={hasFilters ? 'Try widening the dates or clearing the action filter.' : 'Changes people make will be recorded here.'} />
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {logs.map(log => {
              const entity = describeEntity(log)
              return (
                <li key={log.id} style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? '3px' : '16px', padding: '12px 16px', borderBottom: `1px solid ${T.borderSubtle}`, alignItems: isMobile ? 'stretch' : 'baseline' }}>
                  {!isMobile && <time dateTime={log.created_at} className="il-tabular" style={{ fontSize: '12px', color: T.subtle, whiteSpace: 'nowrap', width: '160px', flexShrink: 0 }}>{formatTime(log.created_at)}</time>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', color: T.text, fontWeight: 500 }}>{ACTION_LABELS[log.action] || humanize(log.action)}</div>
                    {entity && <div style={{ fontSize: '12px', color: T.muted, marginTop: '2px', overflowWrap: 'anywhere' }}>{entity}</div>}
                  </div>
                  <div style={{ fontSize: '12px', color: T.muted, flexShrink: 0, maxWidth: isMobile ? 'none' : '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {isMobile && <>{formatTime(log.created_at)} · </>}{log.user_email || 'Unknown user'}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>
      {logs.length >= logLimit && (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <Button variant="secondary" size="sm" busy={loading} busyLabel="Loading…" onClick={() => setLogLimit(l => l + 100)}>Load more</Button>
        </div>
      )}
      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onClose={hideToast} />}
    </>
  )
}

const SETTING_META = {
  hr_notification_email: { label: 'HR notification email', hint: 'Receives new-onboarding, completion and time-off notifications.', type: 'email' },
  tech_support_email: { label: 'Tech support email', hint: 'Receives tech support tickets from the employee portal.', type: 'email' },
}

function SystemSettingsTab() {
  const [settings, setSettings] = useState([])
  const [values, setValues] = useState({})
  const [saving, setSaving] = useState({})
  const [loading, setLoading] = useState(true)
  const { toast, showToast, hideToast } = useToast()

  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchSettings is stable, mount-only fetch
  useEffect(() => { fetchSettings() }, [])

  async function fetchSettings() {
    const { data, error } = await supabase.from('system_settings').select('*').order('key')
    if (error) {
      showToast(handleSupabaseError(error, 'Failed to load settings.'), 'error')
    } else if (data) {
      setSettings(data)
      const v = {}
      data.forEach(row => { v[row.key] = row.value })
      setValues(v)
    }
    setLoading(false)
  }

  async function handleSave(key) {
    const meta = SETTING_META[key]
    const value = (values[key] ?? '').trim()
    if (meta?.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      showToast('Enter a valid email address.', 'error')
      return
    }
    setSaving(prev => ({ ...prev, [key]: true }))
    const { error } = await supabase
      .from('system_settings')
      .update({ value, updated_at: new Date().toISOString() })
      .eq('key', key)
    if (error) {
      showToast(handleSupabaseError(error, 'Failed to save setting.'), 'error')
    } else {
      await logAudit('system_setting_updated', 'system_settings', key, { value })
      // Notification senders cache these; drop the cache so the new address
      // is used right away rather than after the next page load.
      clearSettingsCache()
      setSettings(prev => prev.map(row => row.key === key ? { ...row, value } : row))
      showToast('Setting saved')
    }
    setSaving(prev => ({ ...prev, [key]: false }))
  }

  function labelFor(key) {
    return SETTING_META[key]?.label || humanize(key)
  }

  return (
    <div style={{ ...s.card, padding: '4px 20px', maxWidth: '640px' }}>
      {loading ? (
        <div aria-busy="true">{[1, 2].map(i => <div key={i} style={{ padding: '18px 0', borderBottom: `1px solid ${T.borderSubtle}` }}><SkeletonLine width="40%" style={{ marginBottom: '10px' }} /><SkeletonLine height="34px" /></div>)}</div>
      ) : settings.length === 0 ? (
        <EmptyState icon={EmptyIcons.list} title="No settings configured" message="Settings rows are created in the database." />
      ) : settings.map((setting, i) => {
        const dirty = (values[setting.key] ?? '') !== (setting.value ?? '')
        return (
          <form key={setting.key} onSubmit={e => { e.preventDefault(); handleSave(setting.key) }}
            style={{ padding: '16px 0 0', borderBottom: i < settings.length - 1 ? `1px solid ${T.borderSubtle}` : 'none' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <Field label={labelFor(setting.key)} hint={SETTING_META[setting.key]?.hint} style={{ flex: 1 }}>
                <input type={SETTING_META[setting.key]?.type || 'text'} value={values[setting.key] ?? ''}
                  onChange={e => setValues(prev => ({ ...prev, [setting.key]: e.target.value }))} />
              </Field>
              {/* Label height (~21px) + half the height difference to the input */}
              <div style={{ marginTop: '22px' }}>
                <Button type="submit" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} busy={saving[setting.key]} busyLabel="Saving…">Save</Button>
              </div>
            </div>
          </form>
        )
      })}
      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onClose={hideToast} />}
    </div>
  )
}
