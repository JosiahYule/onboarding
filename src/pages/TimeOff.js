import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import Layout from '../components/Layout'
import { SkeletonLine } from '../components/Skeleton'
import Toast from '../components/Toast'
import useToast from '../hooks/useToast'
import { handleSupabaseError } from '../utils/handleError'
import { logAudit } from '../utils/auditLog'
import { useWindowSize } from '../hooks/useWindowSize'
import { getToday, getCurrentYear, TIME_OFF_STATUS } from '../config'
import { TYPE_LABELS, StatusPill, TypeIcon, fmtDate, fmtDateRange } from '../utils/timeOffShared'
import { escapeHtml } from '../utils/escapeHtml'
import { T } from '../ui/theme'
import PageHeader from '../ui/PageHeader'
import Button from '../ui/Button'
import Field from '../ui/Field'
import EmptyState, { EmptyIcons } from '../ui/EmptyState'

// One hue per person (no blue: that's reserved for the "today" marker and UI
// accents). Bars are tinted by mixing the hue into the current surface, so
// they read in both light and dark themes.
const PALETTE = ['#15803d', '#b45309', '#be185d', '#6d28d9', '#0f766e', '#9f1239', '#854d0e', '#7e22ce']

function employeeColor(employeeId) {
  let h = 5381
  const id = employeeId || ''
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0
  return PALETTE[Math.abs(h) % PALETTE.length]
}

function eventColors(hue, pending) {
  return {
    background: pending ? `color-mix(in srgb, ${hue} 10%, var(--surface))` : `color-mix(in srgb, ${hue} 24%, var(--surface))`,
    color: `color-mix(in srgb, ${hue} 70%, var(--text))`,
    border: pending ? `1.5px dashed color-mix(in srgb, ${hue} 60%, var(--surface))` : '1px solid transparent',
  }
}

function buildCalendarDays(year, month) {
  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = Array(firstDow).fill(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function pad(n) { return String(n).padStart(2, '0') }


const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DOW_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

const DATE_ROW_H = 28
const EVENT_H = 20
const EVENT_GAP = 3
const SLOT_H = EVENT_H + EVENT_GAP

const BASE_STYLES = {
  card: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, boxShadow: T.shadowSm },
  tHead: (cols) => ({ display: 'grid', gridTemplateColumns: cols, gap: '12px', padding: '10px 16px', background: T.surfaceSunken, borderBottom: `1px solid ${T.border}`, fontSize: '11px', fontWeight: 600, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.4px', alignItems: 'center' }),
  tRow: (cols) => ({ display: 'grid', gridTemplateColumns: cols, gap: '12px', padding: '12px 16px', borderBottom: `1px solid ${T.borderSubtle}`, alignItems: 'center', fontSize: '13px', color: T.text }),
  thBtn: { display: 'inline-flex', alignItems: 'center', padding: 0, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' },
  approve: { background: T.successBg, color: T.success, border: `1px solid ${T.successBorder}` },
}

function getWeekEventLayout(weekDates, allRequests) {
  const activeDates = weekDates.filter(d => d)
  if (activeDates.length === 0) return { assignments: [], trackCount: 0 }
  const weekMin = activeDates[0]
  const weekMax = activeDates[activeDates.length - 1]

  const relevant = allRequests.filter(r =>
    (r.status === TIME_OFF_STATUS.APPROVED || r.status === TIME_OFF_STATUS.PENDING) &&
    r.start_date <= weekMax &&
    r.end_date >= weekMin
  )

  relevant.sort((a, b) => {
    if (a.start_date !== b.start_date) return a.start_date < b.start_date ? -1 : 1
    return a.end_date < b.end_date ? 1 : -1
  })

  const tracks = []
  const assignments = []

  for (const req of relevant) {
    let startCol = weekDates.findIndex(d => d && d >= req.start_date)
    if (startCol === -1) startCol = weekDates.findIndex(d => d)

    let endCol = -1
    for (let i = 6; i >= 0; i--) {
      if (weekDates[i] && weekDates[i] <= req.end_date) { endCol = i; break }
    }
    if (endCol === -1 || startCol > endCol) continue

    let track = 0
    while (true) {
      if (!tracks[track]) break
      const conflict = tracks[track].some(([s, e]) => startCol <= e && endCol >= s)
      if (!conflict) break
      track++
    }
    if (!tracks[track]) tracks[track] = []
    tracks[track].push([startCol, endCol])

    assignments.push({
      req, track, startCol, endCol,
      startsThisWeek: req.start_date >= weekMin,
      endsThisWeek: req.end_date <= weekMax,
    })
  }

  return { assignments, trackCount: tracks.length }
}

export default function TimeOff({ session, userProfile, onNavigate }) {
  const [subView, setSubView] = useState('requests')
  const [requests, setRequests] = useState([])
  const [reqBalances, setReqBalances] = useState([])
  const [balances, setBalances] = useState([])
  const [loading, setLoading] = useState(true)
  const [reviewNotes, setReviewNotes] = useState({})
  const [reviewingId, setReviewingId] = useState(null)
  const [editingBalanceId, setEditingBalanceId] = useState(null)
  const [editTotalDays, setEditTotalDays] = useState('')
  const [savingBalanceId, setSavingBalanceId] = useState(null)
  const [expandedEmployeeId, setExpandedEmployeeId] = useState(null)
  const [calYear, setCalYear] = useState(new Date().getFullYear())
  const [calMonth, setCalMonth] = useState(new Date().getMonth())
  // Filter / sort
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterEmployee, setFilterEmployee] = useState('')
  const [sortField, setSortField] = useState('created_at')
  const [sortDir, setSortDir] = useState('desc')
  // Holidays
  const [holidays, setHolidays] = useState([])
  const [holidaysLoading, setHolidaysLoading] = useState(false)
  const [newHolidayName, setNewHolidayName] = useState('')
  const [newHolidayDate, setNewHolidayDate] = useState('')
  const [newHolidayRepeats, setNewHolidayRepeats] = useState(false)
  const [savingHoliday, setSavingHoliday] = useState(false)
  const [deletingHolidayId, setDeletingHolidayId] = useState(null)
  const { toast, showToast, hideToast } = useToast()
  const { isMobile } = useWindowSize()

  // Recomputed each render so a long-lived tab stays on the correct date/year.
  const TODAY = getToday()
  const CURRENT_YEAR = getCurrentYear()

  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchData is stable, re-fetch on view change
  useEffect(() => { fetchData() }, [subView])

  async function fetchData() {
    if (subView === 'holidays') { await fetchHolidays(); return }
    setLoading(true)
    if (subView === 'balances') await fetchBalances()
    else await fetchRequests()
    setLoading(false)
  }

  async function fetchRequests() {
    const { data, error } = await supabase
      .from('time_off_requests')
      .select(`
        *,
        employee:employees!time_off_requests_employee_id_fkey(id, full_name, email),
        reviewer:employees!time_off_requests_reviewed_by_fkey(id, full_name)
      `)
      .order('created_at', { ascending: false })

    if (error) { showToast(handleSupabaseError(error, 'Failed to load requests.'), 'error'); return }

    const sorted = [
      ...(data || []).filter(r => r.status === TIME_OFF_STATUS.PENDING),
      ...(data || []).filter(r => r.status !== TIME_OFF_STATUS.PENDING),
    ]
    setRequests(sorted)

    const { data: bals } = await supabase.from('time_off_balances').select('*').eq('year', CURRENT_YEAR)
    setReqBalances(bals || [])
  }

  async function fetchBalances() {
    const { data: emps, error: empsErr } = await supabase.from('employees').select('id, full_name, email').order('full_name')
    if (empsErr) { showToast(handleSupabaseError(empsErr, 'Failed to load employees.'), 'error'); return }

    const { data: bals } = await supabase.from('time_off_balances').select('*').eq('year', CURRENT_YEAR)
    const { data: reqs } = await supabase.from('time_off_requests').select('*')

    const balMap = {}
    if (bals) bals.forEach(b => { balMap[b.employee_id] = b })

    const reqsByEmp = {}
    if (reqs) reqs.forEach(r => {
      if (!reqsByEmp[r.employee_id]) reqsByEmp[r.employee_id] = []
      reqsByEmp[r.employee_id].push(r)
    })

    setBalances((emps || []).map(emp => {
      const bal = balMap[emp.id] || null
      const empReqs = (reqsByEmp[emp.id] || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      const pendingDays = empReqs.filter(r => r.status === TIME_OFF_STATUS.PENDING).reduce((s, r) => s + Number(r.business_days), 0)
      return { employee: emp, balance: bal, pendingDays, requests: empReqs }
    }))
  }

  async function fetchHolidays() {
    setHolidaysLoading(true)
    const { data, error } = await supabase.from('company_holidays').select('*').order('date', { ascending: true })
    if (error) showToast(handleSupabaseError(error, 'Failed to load holidays.'), 'error')
    setHolidays(data || [])
    setHolidaysLoading(false)
  }

  async function addHoliday() {
    if (!newHolidayName.trim() || !newHolidayDate) { showToast('Name and date are required.', 'error'); return }
    setSavingHoliday(true)
    const { error } = await supabase.from('company_holidays').insert({
      name: newHolidayName.trim(),
      date: newHolidayDate,
      repeats_yearly: newHolidayRepeats,
    })
    if (error) { showToast(handleSupabaseError(error, 'Failed to add holiday.'), 'error'); setSavingHoliday(false); return }
    setNewHolidayName('')
    setNewHolidayDate('')
    setNewHolidayRepeats(false)
    showToast('Holiday added.')
    setSavingHoliday(false)
    await fetchHolidays()
  }

  async function deleteHoliday(id) {
    setDeletingHolidayId(id)
    const { error } = await supabase.from('company_holidays').delete().eq('id', id)
    if (error) { showToast(handleSupabaseError(error, 'Failed to delete holiday.'), 'error'); setDeletingHolidayId(null); return }
    showToast('Holiday removed.')
    setDeletingHolidayId(null)
    setHolidays(prev => prev.filter(h => h.id !== id))
  }

  function getBalForEmployee(employeeId) {
    return reqBalances.find(b => b.employee_id === employeeId) || null
  }

  function getOverlapNames(req) {
    return requests
      .filter(r => r.id !== req.id && r.status === TIME_OFF_STATUS.APPROVED && r.employee_id !== req.employee_id && r.start_date <= req.end_date && r.end_date >= req.start_date)
      .map(r => r.employee?.full_name?.split(' ')[0] || '?')
  }

  function getRemainingAfterApproval(req) {
    const bal = getBalForEmployee(req.employee_id)
    if (!bal) return null
    const otherPending = requests.filter(r => r.id !== req.id && r.employee_id === req.employee_id && r.status === TIME_OFF_STATUS.PENDING).reduce((s, r) => s + Number(r.business_days), 0)
    return Number(bal.total_days) - Number(bal.used_days) - otherPending - Number(req.business_days)
  }

  async function approveRequest(req) {
    setReviewingId(req.id)
    const notes = reviewNotes[req.id] || ''

    // Request status + balance are updated atomically server-side.
    const { error } = await supabase.rpc('approve_time_off_request', { p_request_id: req.id, p_notes: notes || null })
    if (error) { showToast(handleSupabaseError(error, 'Failed to approve request.'), 'error'); setReviewingId(null); return }

    logAudit('time_off_approved', 'time_off_request', req.id, { employee_id: req.employee_id, days: req.business_days, type: req.type })

    let emailFailed = false
    if (req.employee?.email) {
      const { error: emailErr } = await supabase.functions.invoke('send-email', {
        body: {
          to: req.employee.email,
          subject: 'Your time off request has been approved',
          html: `<p>Hi ${escapeHtml(req.employee.full_name)},</p>
<p>Your time off request has been <strong>approved</strong>.</p>
<p><strong>Dates:</strong> ${fmtDateRange(req.start_date, req.end_date)}<br/>
<strong>Type:</strong> ${escapeHtml(TYPE_LABELS[req.type] || req.type)}<br/>
<strong>Business days:</strong> ${req.business_days}${notes ? `<br/><strong>Notes:</strong> ${escapeHtml(notes)}` : ''}</p>
<p>Enjoy your time off!</p>`
        }
      })
      if (emailErr) emailFailed = true
    }

    showToast(emailFailed ? 'Approved — email to employee failed to send.' : 'Request approved.')
    setReviewingId(null)
    await fetchData()
  }

  async function denyRequest(req) {
    setReviewingId(req.id)
    const notes = reviewNotes[req.id] || ''

    // Server-side RPC sets denied and refunds the balance if it was approved.
    const { error } = await supabase.rpc('deny_time_off_request', { p_request_id: req.id, p_notes: notes || null })
    if (error) { showToast(handleSupabaseError(error, 'Failed to deny.'), 'error'); setReviewingId(null); return }

    logAudit('time_off_denied', 'time_off_request', req.id, { employee_id: req.employee_id, days: req.business_days, type: req.type })

    let emailFailed = false
    if (req.employee?.email) {
      const { error: emailErr } = await supabase.functions.invoke('send-email', {
        body: {
          to: req.employee.email,
          subject: 'Your time off request has been denied',
          html: `<p>Hi ${escapeHtml(req.employee.full_name)},</p>
<p>Your time off request has been <strong>denied</strong>.</p>
<p><strong>Dates:</strong> ${fmtDateRange(req.start_date, req.end_date)}<br/>
<strong>Type:</strong> ${escapeHtml(TYPE_LABELS[req.type] || req.type)}<br/>
<strong>Business days:</strong> ${req.business_days}${notes ? `<br/><strong>Reason:</strong> ${escapeHtml(notes)}` : ''}</p>
<p>Please reach out to HR if you have questions.</p>`
        }
      })
      if (emailErr) emailFailed = true
    }

    showToast(emailFailed ? 'Denied — email to employee failed to send.' : 'Request denied.')
    setReviewingId(null)
    await fetchData()
  }

  async function saveTotalDays(row) {
    const val = parseFloat(editTotalDays)
    if (isNaN(val) || val < 0) { showToast('Enter a valid number of days.', 'error'); return }
    setSavingBalanceId(row.employee.id)
    if (row.balance) {
      const { error } = await supabase.from('time_off_balances').update({ total_days: val, updated_at: new Date().toISOString() }).eq('id', row.balance.id)
      if (error) { showToast(handleSupabaseError(error, 'Failed to update.'), 'error'); setSavingBalanceId(null); return }
    } else {
      const { error } = await supabase.from('time_off_balances').insert({ employee_id: row.employee.id, year: CURRENT_YEAR, total_days: val, used_days: 0 })
      if (error) { showToast(handleSupabaseError(error, 'Failed to create balance.'), 'error'); setSavingBalanceId(null); return }
    }
    showToast('Balance updated.')
    setSavingBalanceId(null)
    setEditingBalanceId(null)
    await fetchBalances()
    setLoading(false)
  }

  function prevMonth() {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11) }
    else setCalMonth(m => m - 1)
  }
  function nextMonth() {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0) }
    else setCalMonth(m => m + 1)
  }

  function handleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const allEmployees = [...new Map(requests.filter(r => r.employee).map(r => [r.employee_id, r.employee])).values()].sort((a, b) => a.full_name.localeCompare(b.full_name))

  const displayRequests = requests
    .filter(r => filterStatus === 'all' || r.status === filterStatus)
    .filter(r => !filterEmployee || r.employee_id === filterEmployee)
    .sort((a, b) => {
      if (sortField !== 'status') {
        if (a.status === TIME_OFF_STATUS.PENDING && b.status !== TIME_OFF_STATUS.PENDING) return -1
        if (b.status === TIME_OFF_STATUS.PENDING && a.status !== 'pending') return 1
      }
      let av = a[sortField] || ''
      let bv = b[sortField] || ''
      if (sortField === 'employee_name') { av = a.employee?.full_name || ''; bv = b.employee?.full_name || '' }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })

  const s = {
    ...BASE_STYLES,
    page: { padding: isMobile ? '16px 16px 40px' : '24px 40px 48px', maxWidth: '1120px' },
  }

  const REQ_COLS = 'minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1.1fr) 56px 96px 90px 170px'
  const BAL_COLS = 'minmax(0, 1.6fr) 90px 80px 80px 96px 90px'

  // Plain render helpers, not components: a component defined inside this one
  // is a new type on every render, so React would remount it each keystroke
  // (the mobile review-notes field lost focus after every character).
  function sortHeader(field, label) {
    const active = sortField === field
    return (
      <button type="button" onClick={() => handleSort(field)} className="il-link-subtle"
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
        style={{ ...s.thBtn, color: active ? T.text : T.muted }}>
        {label}
        <span aria-hidden="true" style={{ fontSize: '9px', marginLeft: '4px', color: active ? T.text : T.subtle }}>
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '⬍'}
        </span>
      </button>
    )
  }

  function remainingText(remaining) {
    return (
      <span className="il-tabular" style={{ color: remaining < 0 ? T.danger : T.muted, fontWeight: remaining < 0 ? 600 : 400 }}>
        {remaining}d{remaining < 0 ? ' over' : ''}
      </span>
    )
  }

  function reviewButtons(req, compact) {
    const busy = reviewingId === req.id
    const size = compact ? 'xs' : 'sm'
    return (
      <div style={{ display: 'flex', gap: '6px', flex: compact ? undefined : 1 }}>
        <Button size={size} busy={busy} busyLabel="…" onClick={() => approveRequest(req)} aria-label={`Approve ${req.employee?.full_name || ''}'s request`}
          style={{ ...s.approve, flex: compact ? undefined : 1 }}>Approve</Button>
        <Button size={size} variant="danger-outline" disabled={busy} onClick={() => denyRequest(req)} aria-label={`Deny ${req.employee?.full_name || ''}'s request`}
          style={{ flex: compact ? undefined : 1 }}>Deny</Button>
      </div>
    )
  }

  function renderRequestCard(req) {
    const remaining = getRemainingAfterApproval(req)
    const overlapNames = getOverlapNames(req)
    return (
      <div key={req.id} style={{ ...s.card, padding: '14px 16px', marginBottom: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '14px', fontWeight: 500, color: T.text }}>{req.employee?.full_name || '—'}</div>
            {overlapNames.length > 0 && (
              <div style={{ fontSize: '11px', color: T.warning, marginTop: '2px' }}>{overlapNames.join(', ')} also off</div>
            )}
          </div>
          <StatusPill status={req.status} />
        </div>
        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '13px', color: T.muted, marginBottom: req.status === TIME_OFF_STATUS.PENDING ? '12px' : '0' }}>
          <span>{fmtDateRange(req.start_date, req.end_date)}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <TypeIcon type={req.type} size={12} />{TYPE_LABELS[req.type] || req.type}
          </span>
          <span className="il-tabular">{req.business_days}d{req.is_half_day ? ' ½' : ''}</span>
          {req.status === TIME_OFF_STATUS.PENDING && remaining != null && <span>→ {remainingText(remaining)} left</span>}
        </div>
        {req.status !== TIME_OFF_STATUS.PENDING && req.review_notes && (
          <div style={{ fontSize: '12px', color: T.muted, fontStyle: 'italic', marginTop: '6px' }}>{req.review_notes}</div>
        )}
        {req.status === TIME_OFF_STATUS.PENDING && (
          <div>
            <input
              className="il-input"
              style={{ marginBottom: '10px' }}
              aria-label={`Review note for ${req.employee?.full_name || 'this request'}`}
              placeholder="Note to the employee (optional)"
              value={reviewNotes[req.id] || ''}
              onChange={e => setReviewNotes(prev => ({ ...prev, [req.id]: e.target.value }))}
            />
            {reviewButtons(req, false)}
          </div>
        )}
      </div>
    )
  }

  const pendingCount = requests.filter(r => r.status === TIME_OFF_STATUS.PENDING).length
  const skeletonCards = [1, 2, 3].map(i => (
    <div key={i} style={{ ...s.card, padding: '16px', marginBottom: '10px' }}><SkeletonLine width={`${40 + i * 10}%`} height="13px" /></div>
  ))

  return (
    <Layout session={session} userProfile={userProfile} currentPage="time-off" onNavigate={onNavigate}>
      <PageHeader
        title="Time off"
        subtitle={isMobile ? null : 'Review requests, set yearly entitlements and see who’s away.'}
        tabs={{
          mode: 'tabs', label: 'Time off views', value: subView, onChange: setSubView,
          items: [
            { id: 'requests', label: 'Requests', badge: pendingCount || null },
            { id: 'balances', label: 'Balances' },
            { id: 'calendar', label: 'Calendar' },
            { id: 'holidays', label: 'Holidays' },
          ],
        }}
      />

      <div style={s.page} role="tabpanel" aria-label={subView}>
        {/* ── REQUESTS ── */}
        {subView === 'requests' && (
          <>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="il-input" aria-label="Filter by status" style={{ width: isMobile ? 'auto' : '170px', flex: isMobile ? 1 : 'none' }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="all">All statuses</option>
                <option value={TIME_OFF_STATUS.PENDING}>Pending</option>
                <option value={TIME_OFF_STATUS.APPROVED}>Approved</option>
                <option value={TIME_OFF_STATUS.DENIED}>Denied</option>
                <option value={TIME_OFF_STATUS.CANCELLED}>Cancelled</option>
              </select>
              {allEmployees.length > 0 && (
                <select className="il-input" aria-label="Filter by employee" style={{ width: isMobile ? 'auto' : '200px', flex: isMobile ? 1 : 'none', minWidth: 0 }} value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)}>
                  <option value="">All employees</option>
                  {allEmployees.map(emp => <option key={emp.id} value={emp.id}>{emp.full_name}</option>)}
                </select>
              )}
              {(filterStatus !== 'all' || filterEmployee) && (
                <Button size="sm" variant="ghost" onClick={() => { setFilterStatus('all'); setFilterEmployee('') }}>Clear filters</Button>
              )}
              <span aria-live="polite" style={{ fontSize: '12px', color: T.subtle, marginLeft: 'auto' }}>
                {loading ? '' : `${displayRequests.length} result${displayRequests.length !== 1 ? 's' : ''}`}
              </span>
            </div>

            {loading ? skeletonCards : displayRequests.length === 0 ? (
              <div style={s.card}>
                <EmptyState icon={EmptyIcons.calendar}
                  title={requests.length === 0 ? 'No time off requests yet' : 'No requests match'}
                  message={requests.length === 0 ? 'Requests employees submit will show up here for review.' : 'Try clearing the filters.'} />
              </div>
            ) : isMobile ? (
              displayRequests.map(renderRequestCard)
            ) : (
              <div style={{ ...s.card, overflow: 'hidden' }} role="table" aria-label="Time off requests">
                <div style={s.tHead(REQ_COLS)} role="row">
                  <div role="columnheader">{sortHeader('employee_name', 'Employee')}</div>
                  <div role="columnheader">{sortHeader('start_date', 'Dates')}</div>
                  <div role="columnheader">Type</div>
                  <div role="columnheader">{sortHeader('business_days', 'Days')}</div>
                  <div role="columnheader">{sortHeader('status', 'Status')}</div>
                  <div role="columnheader" title="Balance remaining if this request is approved">After</div>
                  <div role="columnheader"><span className="il-visually-hidden">Actions</span></div>
                </div>
                {displayRequests.map(req => {
                  const remaining = getRemainingAfterApproval(req)
                  const overlapNames = getOverlapNames(req)
                  const pending = req.status === TIME_OFF_STATUS.PENDING
                  return (
                    <div key={req.id} style={{ borderBottom: `1px solid ${T.borderSubtle}`, background: pending ? T.surface : 'transparent' }}>
                      <div style={{ ...s.tRow(REQ_COLS), borderBottom: 'none' }} role="row">
                        <div role="cell" style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 500 }}>{req.employee?.full_name || '—'}</div>
                          {overlapNames.length > 0 && (
                            <div style={{ fontSize: '11px', color: T.warning, marginTop: '2px' }}>{overlapNames.join(', ')} also off</div>
                          )}
                        </div>
                        <div role="cell" style={{ color: T.muted, fontSize: '12px' }}>{fmtDateRange(req.start_date, req.end_date)}</div>
                        <div role="cell" style={{ display: 'flex', alignItems: 'center', gap: '5px', color: T.muted, fontSize: '12px', minWidth: 0 }}>
                          <TypeIcon type={req.type} size={12} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{TYPE_LABELS[req.type] || req.type}</span>
                        </div>
                        <div role="cell" className="il-tabular">{req.business_days}d{req.is_half_day ? <span style={{ fontSize: '10px', color: T.muted }}> ½</span> : null}</div>
                        <div role="cell"><StatusPill status={req.status} /></div>
                        <div role="cell" style={{ fontSize: '13px' }}>{pending && remaining != null ? remainingText(remaining) : <span style={{ color: T.subtle }}>—</span>}</div>
                        <div role="cell">
                          {pending ? reviewButtons(req, true) : req.review_notes && (
                            <div style={{ fontSize: '11px', color: T.muted, fontStyle: 'italic', maxWidth: '170px' }}>{req.review_notes}</div>
                          )}
                        </div>
                      </div>
                      {pending && (
                        <div style={{ padding: '0 16px 12px' }}>
                          <input
                            className="il-input"
                            style={{ maxWidth: '360px', padding: '6px 10px', fontSize: '12px' }}
                            aria-label={`Review note for ${req.employee?.full_name || 'this request'}`}
                            placeholder="Note to the employee (optional)"
                            value={reviewNotes[req.id] || ''}
                            onChange={e => setReviewNotes(prev => ({ ...prev, [req.id]: e.target.value }))}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ── BALANCES ── */}
        {subView === 'balances' && (
          loading ? skeletonCards : balances.length === 0 ? (
            <div style={s.card}><EmptyState icon={EmptyIcons.people} title="No employees yet" message="Balances appear once employees are added." /></div>
          ) : (
            <div style={{ ...s.card, overflow: 'hidden' }}>
              {!isMobile && (
                <div style={s.tHead(BAL_COLS)}>
                  <div>Employee</div><div>Total ({CURRENT_YEAR})</div><div>Used</div>
                  <div>Pending</div><div>Remaining</div><div></div>
                </div>
              )}
              {balances.map(row => {
                const total = row.balance ? Number(row.balance.total_days) : 0
                const used = row.balance ? Number(row.balance.used_days) : 0
                const pending = row.pendingDays
                const remaining = total - used - pending
                const isEditing = editingBalanceId === row.employee.id
                const isExpanded = expandedEmployeeId === row.employee.id
                const saving = savingBalanceId === row.employee.id
                const nameButton = (
                  <button type="button" aria-expanded={isExpanded} onClick={() => setExpandedEmployeeId(isExpanded ? null : row.employee.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={{ color: T.subtle, flexShrink: 0, transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
                      <path d="M3 1.5L6.5 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 500, color: T.text }}>{row.employee.full_name}</span>
                      <span style={{ display: 'block', fontSize: '11px', color: T.subtle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.employee.email}</span>
                    </span>
                  </button>
                )
                const totalCell = isEditing ? (
                  <form onSubmit={e => { e.preventDefault(); saveTotalDays(row) }} style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <input className="il-input il-tabular" style={{ width: '64px', padding: '4px 8px' }} type="number" min="0" step="0.5" autoFocus
                      aria-label={`Total days for ${row.employee.full_name}`} value={editTotalDays} onChange={e => setEditTotalDays(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape') setEditingBalanceId(null) }} />
                  </form>
                ) : <span className="il-tabular">{total}d</span>
                const actions = isEditing ? (
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <Button size="xs" busy={saving} busyLabel="…" onClick={() => saveTotalDays(row)}>Save</Button>
                    <Button size="xs" variant="ghost" onClick={() => setEditingBalanceId(null)} aria-label="Cancel">✕</Button>
                  </div>
                ) : (
                  <Button size="xs" variant="secondary" onClick={() => { setEditingBalanceId(row.employee.id); setEditTotalDays(String(total)) }} aria-label={`Edit ${row.employee.full_name}'s total days`}>Edit</Button>
                )

                return (
                  <div key={row.employee.id} style={{ borderBottom: `1px solid ${T.borderSubtle}` }}>
                    {isMobile ? (
                      <div style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                          {nameButton}
                          <div className="il-tabular" style={{ fontSize: '18px', fontWeight: 600, color: remaining < 0 ? T.danger : T.text, flexShrink: 0 }}>{remaining}d</div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', fontSize: '12px' }}>
                          {[['Total', totalCell], ['Used', <span className="il-tabular">{used}d</span>], ['Pending', <span className="il-tabular" style={{ color: pending > 0 ? T.warning : T.subtle }}>{pending > 0 ? `${pending}d` : '—'}</span>]].map(([label, value]) => (
                            <div key={label} style={{ background: T.surfaceSunken, borderRadius: T.radiusSm, padding: '8px 10px' }}>
                              <div style={{ color: T.muted, marginBottom: '2px' }}>{label}</div>
                              <div style={{ fontWeight: 500, color: T.text }}>{value}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ marginTop: '10px' }}>{actions}</div>
                      </div>
                    ) : (
                      <div style={{ ...s.tRow(BAL_COLS), borderBottom: 'none', background: isExpanded ? T.surfaceSunken : 'transparent' }}>
                        <div style={{ minWidth: 0 }}>{nameButton}</div>
                        <div>{totalCell}</div>
                        <div className="il-tabular">{used}d</div>
                        <div className="il-tabular" style={{ color: pending > 0 ? T.warning : T.subtle }}>{pending > 0 ? `${pending}d` : '—'}</div>
                        <div className="il-tabular" style={{ fontWeight: 600, color: remaining < 0 ? T.danger : T.text }}>{remaining}d</div>
                        <div>{actions}</div>
                      </div>
                    )}
                    {isExpanded && (
                      <div style={{ background: T.surfaceSunken, borderTop: `1px solid ${T.borderSubtle}` }}>
                        {row.requests.length === 0 ? (
                          <div style={{ padding: '12px 24px', fontSize: '12px', color: T.subtle }}>No requests yet.</div>
                        ) : row.requests.map(req => (
                          <div key={req.id} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr auto' : '1fr 1fr 60px 100px', gap: '8px', padding: isMobile ? '10px 16px' : '10px 24px 10px 42px', borderBottom: `1px solid ${T.borderSubtle}`, fontSize: '12px', color: T.muted, alignItems: 'center' }}>
                            <div>{fmtDateRange(req.start_date, req.end_date)}{isMobile && <div style={{ marginTop: '2px' }}>{TYPE_LABELS[req.type] || req.type} · {req.business_days}d</div>}</div>
                            {!isMobile && <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><TypeIcon type={req.type} size={11} />{TYPE_LABELS[req.type] || req.type}</div>}
                            {!isMobile && <div className="il-tabular">{req.business_days}d</div>}
                            <div><StatusPill status={req.status} /></div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        )}

        {/* ── CALENDAR ── */}
        {subView === 'calendar' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
              <Button size="sm" variant="secondary" onClick={prevMonth} aria-label="Previous month">‹</Button>
              <h2 aria-live="polite" style={{ ...T.type.h2, margin: 0, fontSize: '15px', color: T.text, minWidth: isMobile ? '130px' : '160px', textAlign: 'center' }}>
                {MONTH_NAMES[calMonth]} {calYear}
              </h2>
              <Button size="sm" variant="secondary" onClick={nextMonth} aria-label="Next month">›</Button>
              <Button size="sm" variant="ghost" onClick={() => { setCalYear(new Date().getFullYear()); setCalMonth(new Date().getMonth()) }}>Today</Button>
              {!isMobile && (
                <div style={{ display: 'flex', gap: '14px', marginLeft: 'auto', alignItems: 'center', fontSize: '12px', color: T.muted }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span aria-hidden="true" style={{ width: '22px', height: '12px', borderRadius: '3px', ...eventColors(PALETTE[0], false) }} />Approved
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span aria-hidden="true" style={{ width: '22px', height: '12px', borderRadius: '3px', ...eventColors(PALETTE[0], true) }} />Pending
                  </span>
                  <span style={{ color: T.subtle }}>One colour per person</span>
                </div>
              )}
            </div>

            <div style={{ overflowX: isMobile ? 'auto' : 'visible', WebkitOverflowScrolling: 'touch' }}>
              <div style={{ ...s.card, overflow: 'hidden', minWidth: isMobile ? '560px' : 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: `1px solid ${T.border}`, background: T.surfaceSunken }}>
                  {DOW_LABELS.map((d, i) => (
                    <div key={d} style={{ padding: isMobile ? '6px 4px' : '8px 10px', fontSize: '11px', fontWeight: 600, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.4px', textAlign: 'center', borderRight: i < 6 ? `1px solid ${T.borderSubtle}` : 'none' }}>
                      {isMobile ? d.slice(0, 1) : d}
                    </div>
                  ))}
                </div>

                {loading ? (
                  <div style={{ padding: '24px' }}><SkeletonLine width="100%" height="220px" /></div>
                ) : (() => {
                  const cells = buildCalendarDays(calYear, calMonth)
                  const weeks = []
                  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

                  return weeks.map((week, wi) => {
                    const weekDates = week.map(day => day ? `${calYear}-${pad(calMonth + 1)}-${pad(day)}` : null)
                    const { assignments, trackCount } = getWeekEventLayout(weekDates, requests)
                    const eventsH = trackCount * SLOT_H + (trackCount > 0 ? 8 : 6)
                    const cellBg = (day, di) => !day || di === 0 || di === 6 ? T.surfaceSunken : T.surface

                    return (
                      <div key={wi} style={{ borderBottom: wi < weeks.length - 1 ? `1px solid ${T.border}` : 'none' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                          {week.map((day, di) => {
                            const isToday = weekDates[di] === TODAY
                            const isWeekend = di === 0 || di === 6
                            return (
                              <div key={di} style={{ height: DATE_ROW_H, padding: '5px 8px', display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start', background: cellBg(day, di), borderRight: di < 6 ? `1px solid ${T.borderSubtle}` : 'none' }}>
                                {day && (isToday ? (
                                  <span aria-label={`${day}, today`} style={{ background: T.brand, color: T.onAccent, borderRadius: '50%', width: '20px', height: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700 }}>
                                    {day}
                                  </span>
                                ) : (
                                  <span className="il-tabular" style={{ fontSize: '12px', color: isWeekend ? T.subtle : T.muted }}>{day}</span>
                                ))}
                              </div>
                            )
                          })}
                        </div>

                        <div style={{ position: 'relative', height: eventsH }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', height: '100%', position: 'absolute', inset: 0 }}>
                            {week.map((day, di) => (
                              <div key={di} style={{ background: cellBg(day, di), borderRight: di < 6 ? `1px solid ${T.borderSubtle}` : 'none' }} />
                            ))}
                          </div>

                          {assignments.map(({ req, track, startCol, endCol, startsThisWeek, endsThisWeek }) => {
                            const isPending = req.status === TIME_OFF_STATUS.PENDING
                            const firstName = req.employee?.full_name?.split(' ')[0] || '?'
                            const colPct = 100 / 7
                            const lOff = startsThisWeek ? 2 : 0
                            const rOff = endsThisWeek ? 2 : 0
                            const label = `${req.employee?.full_name || 'Someone'}: ${TYPE_LABELS[req.type] || req.type}${isPending ? ' (pending)' : ''}, ${fmtDateRange(req.start_date, req.end_date)}, ${req.business_days} days`
                            return (
                              <div
                                key={`${req.id}-${wi}`}
                                title={label}
                                aria-label={label}
                                role="img"
                                style={{
                                  position: 'absolute',
                                  top: track * SLOT_H + 4,
                                  left: `calc(${startCol * colPct}% + ${lOff}px)`,
                                  width: `calc(${(endCol - startCol + 1) * colPct}% - ${lOff + rOff}px)`,
                                  height: EVENT_H,
                                  ...eventColors(employeeColor(req.employee_id), isPending),
                                  fontSize: '11px', fontWeight: 600,
                                  display: 'flex', alignItems: 'center', paddingLeft: '6px',
                                  overflow: 'hidden', whiteSpace: 'nowrap',
                                  borderRadius: `${startsThisWeek ? 4 : 0}px ${endsThisWeek ? 4 : 0}px ${endsThisWeek ? 4 : 0}px ${startsThisWeek ? 4 : 0}px`,
                                  zIndex: 1,
                                }}
                              >
                                {firstName}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>
            </div>
          </div>
        )}

        {/* ── HOLIDAYS ── */}
        {subView === 'holidays' && (
          <div style={{ display: 'grid', gap: '16px', maxWidth: '760px' }}>
            <form onSubmit={e => { e.preventDefault(); addHoliday() }} style={{ ...s.card, padding: '18px 20px' }}>
              <h2 style={{ ...T.type.h2, fontSize: '14px', margin: '0 0 14px', color: T.text }}>Add a holiday</h2>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) 170px', gap: '0 12px' }}>
                <Field label="Name"><input placeholder="e.g. Natal Day" value={newHolidayName} onChange={e => setNewHolidayName(e.target.value)} /></Field>
                <Field label="Date"><input type="date" value={newHolidayDate} onChange={e => setNewHolidayDate(e.target.value)} /></Field>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: T.muted, cursor: 'pointer' }}>
                  <input type="checkbox" checked={newHolidayRepeats} onChange={e => setNewHolidayRepeats(e.target.checked)} style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: 'var(--brand)' }} />
                  Repeats every year on this date
                </label>
                <Button type="submit" busy={savingHoliday} busyLabel="Adding…" disabled={!newHolidayName.trim() || !newHolidayDate}>Add holiday</Button>
              </div>
            </form>

            <div style={{ ...s.card, overflow: 'hidden' }}>
              {holidaysLoading ? (
                [1, 2, 3].map(i => <div key={i} style={{ padding: '16px', borderBottom: `1px solid ${T.borderSubtle}` }}><SkeletonLine width="50%" height="13px" /></div>)
              ) : holidays.length === 0 ? (
                <EmptyState icon={EmptyIcons.calendar} title="No holidays yet" message="Company holidays are skipped when business days are counted for time off." />
              ) : (
                <>
                  {!isMobile && (
                    <div style={s.tHead('minmax(0, 1fr) 120px 120px 90px')}>
                      <div>Name</div><div>Date</div><div>Repeats</div><div></div>
                    </div>
                  )}
                  {holidays.map(h => (
                    <div key={h.id} className="il-task-row" style={isMobile
                      ? { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '13px 16px', borderBottom: `1px solid ${T.borderSubtle}` }
                      : s.tRow('minmax(0, 1fr) 120px 120px 90px')}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 500, color: T.text }}>{h.name}</div>
                        {isMobile && <div style={{ fontSize: '12px', color: T.muted, marginTop: '2px' }}>{fmtDate(h.date)}{h.repeats_yearly ? ' · Every year' : ''}</div>}
                      </div>
                      {!isMobile && <div style={{ color: T.muted, fontSize: '12px' }}>{fmtDate(h.date)}</div>}
                      {!isMobile && <div style={{ fontSize: '12px', color: h.repeats_yearly ? T.success : T.subtle }}>{h.repeats_yearly ? 'Every year' : 'Once'}</div>}
                      <div style={{ textAlign: 'right' }}>
                        <span className="il-row-actions">
                          <Button size="xs" variant="ghost" style={{ color: T.danger }} busy={deletingHolidayId === h.id} busyLabel="…" onClick={() => deleteHoliday(h.id)} aria-label={`Remove ${h.name}`}>Remove</Button>
                        </span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
      </div>
      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onClose={hideToast} />}
    </Layout>
  )
}
