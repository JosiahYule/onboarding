import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import Layout from '../components/Layout'
import { SkeletonLine } from '../components/Skeleton'
import Toast from '../components/Toast'
import ConfirmModal from '../components/ConfirmModal'
import useToast from '../hooks/useToast'
import { handleSupabaseError } from '../utils/handleError'
import { logAudit } from '../utils/auditLog'
import { useWindowSize } from '../hooks/useWindowSize'
import { getToday, getCurrentYear, TIME_OFF_STATUS } from '../config'
import { TYPE_LABELS, StatusPill, TypeIcon, fmtDate, fmtDateRange } from '../utils/timeOffShared'
import { countsAgainstBalance, summarizeYear, remainingIfApproved, yearSplitOf, formatDays } from '../utils/timeOffMath'
import { escapeHtml } from '../utils/escapeHtml'
import { sendEmail, appLink } from '../utils/emailNotify'
import { formatDate } from '../utils/dates'
import { T } from '../ui/theme'
import PageHeader from '../ui/PageHeader'
import Button from '../ui/Button'
import Field from '../ui/Field'
import Modal from '../ui/Modal'
import Segmented from '../ui/Segmented'
import SearchInput from '../ui/SearchInput'
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
  tHead: (cols) => ({ display: 'grid', gridTemplateColumns: cols, gap: '12px', padding: '10px 16px', background: T.surfaceSunken, borderBottom: `1px solid ${T.border}`, fontSize: 'var(--text-xs)', fontWeight: 600, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.4px', alignItems: 'center' }),
  tRow: (cols) => ({ display: 'grid', gridTemplateColumns: cols, gap: '12px', padding: '12px 16px', borderBottom: `1px solid ${T.borderSubtle}`, alignItems: 'center', fontSize: 'var(--text-base)', color: T.text }),
  thBtn: { display: 'inline-flex', alignItems: 'center', padding: 0, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 'var(--text-xs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' },
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

const FLEX_LABELS = { firm: 'Firm', moderately_adjustable: 'Moderately adjustable', flexible: 'Flexible', other: 'Other' }
const LEGACY_TYPES = new Set(['vacation', 'sick', 'personal'])
const LOG_TYPE_OPTIONS = Object.entries(TYPE_LABELS).filter(([k]) => !LEGACY_TYPES.has(k))
const EMPTY_LOG = { employeeId: '', start: '', end: '', portion: 'full', type: 'personal_vacation', notes: '', approve: true }

function isLive(r) {
  return r.status === TIME_OFF_STATUS.PENDING || r.status === TIME_OFF_STATUS.APPROVED
}

// An entitlement counts as "not set" when there's no row, or only the empty
// row an approval creates on its own (total 0, nothing carried).
function hasNoEntitlement(bal) {
  return !bal || (Number(bal.total_days) === 0 && Number(bal.carried_over) === 0)
}

export default function TimeOff({ session, userProfile, onNavigate }) {
  const [subView, setSubView] = useState('requests')
  const [requests, setRequests] = useState([])
  const [allBalances, setAllBalances] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [reviewNotes, setReviewNotes] = useState({})
  const [reviewingId, setReviewingId] = useState(null)
  const [confirmCancel, setConfirmCancel] = useState(null)
  const [expandedEmployeeId, setExpandedEmployeeId] = useState(null)
  const [calYear, setCalYear] = useState(new Date().getFullYear())
  const [calMonth, setCalMonth] = useState(new Date().getMonth())
  // Filter / sort
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterEmployee, setFilterEmployee] = useState('')
  const [sortField, setSortField] = useState('created_at')
  const [sortDir, setSortDir] = useState('desc')
  // Balances
  const [balYear, setBalYear] = useState(getCurrentYear())
  const [balSearch, setBalSearch] = useState('')
  const [editing, setEditing] = useState(null) // { employeeId, total, carried, used }
  const [savingBalance, setSavingBalance] = useState(false)
  const [bulkDays, setBulkDays] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [startYearOpen, setStartYearOpen] = useState(false)
  const [carryCap, setCarryCap] = useState('0')
  // Logging time off on someone's behalf
  const [logForm, setLogForm] = useState(null)
  const [logSaving, setLogSaving] = useState(false)
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
    await fetchCore()
    setLoading(false)
  }

  // One load serves every view: all requests, every balance row, every employee.
  async function fetchCore() {
    const [reqRes, balRes, empRes] = await Promise.all([
      supabase
        .from('time_off_requests')
        .select(`
          *,
          employee:employees!time_off_requests_employee_id_fkey(id, full_name, email),
          reviewer:employees!time_off_requests_reviewed_by_fkey(id, full_name)
        `)
        .order('created_at', { ascending: false }),
      supabase.from('time_off_balances').select('*'),
      supabase.from('employees').select('id, full_name, email').order('full_name'),
    ])
    const err = reqRes.error || balRes.error || empRes.error
    if (err) showToast(handleSupabaseError(err, 'Failed to load time off.'), 'error')
    setRequests(reqRes.data || [])
    setAllBalances(balRes.data || [])
    setEmployees(empRes.data || [])
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
    showToast('Holiday added. Pending requests have been recounted.')
    setSavingHoliday(false)
    await fetchHolidays()
  }

  async function deleteHoliday(id) {
    setDeletingHolidayId(id)
    const { error } = await supabase.from('company_holidays').delete().eq('id', id)
    if (error) { showToast(handleSupabaseError(error, 'Failed to delete holiday.'), 'error'); setDeletingHolidayId(null); return }
    showToast('Holiday removed. Pending requests have been recounted.')
    setDeletingHolidayId(null)
    setHolidays(prev => prev.filter(h => h.id !== id))
  }

  // employee id -> { "2026": balanceRow, ... }
  const balanceIndex = useMemo(() => {
    const idx = {}
    allBalances.forEach(b => {
      if (!idx[b.employee_id]) idx[b.employee_id] = {}
      idx[b.employee_id][String(b.year)] = b
    })
    return idx
  }, [allBalances])

  const requestsByEmployee = useMemo(() => {
    const idx = {}
    requests.forEach(r => { (idx[r.employee_id] = idx[r.employee_id] || []).push(r) })
    return idx
  }, [requests])

  function afterApproval(req) {
    return remainingIfApproved(req, balanceIndex[req.employee_id] || {}, requestsByEmployee[req.employee_id] || [])
  }

  function getOverlapNames(req) {
    return requests
      .filter(r => r.id !== req.id && r.status === TIME_OFF_STATUS.APPROVED && r.employee_id !== req.employee_id && r.start_date <= req.end_date && r.end_date >= req.start_date)
      .map(r => r.employee?.full_name?.split(' ')[0] || '?')
  }

  function decisionEmail(req, verb, notes, extra = '') {
    return `<p>Hi ${escapeHtml(req.employee.full_name)},</p>
<p>Your time off request has been <strong>${verb}</strong>.</p>
<p><strong>Dates:</strong> ${fmtDateRange(req.start_date, req.end_date)}<br/>
<strong>Type:</strong> ${escapeHtml(TYPE_LABELS[req.type] || req.type)}<br/>
<strong>Business days:</strong> ${formatDays(req.business_days)}${notes ? `<br/><strong>Note from HR:</strong> ${escapeHtml(notes)}` : ''}</p>
${extra}${appLink('/', 'See it in your portal')}`
  }

  async function approveRequest(req) {
    setReviewingId(req.id)
    const notes = (reviewNotes[req.id] || '').trim()

    // Status and balance change together in the database, which also recounts
    // the days against the current holiday list.
    const { data: approved, error } = await supabase.rpc('approve_time_off_request', { p_request_id: req.id, p_notes: notes || null })
    if (error) { showToast(handleSupabaseError(error, 'Failed to approve request.'), 'error'); setReviewingId(null); return }

    logAudit('time_off_approved', 'time_off_request', req.id, { employee_id: req.employee_id, days: approved?.business_days ?? req.business_days, type: req.type })

    const emailed = req.employee?.email
      ? await sendEmail({ to: req.employee.email, subject: 'Your time off request has been approved', html: decisionEmail({ ...req, ...(approved || {}) }, 'approved', notes, '<p>Enjoy your time off!</p>') })
      : null
    showToast(emailed === false ? 'Approved, but the email to the employee failed to send.' : 'Request approved.', emailed === false ? 'warning' : 'success')
    setReviewingId(null)
    await fetchCore()
  }

  async function denyRequest(req) {
    setReviewingId(req.id)
    const notes = (reviewNotes[req.id] || '').trim()

    const { error } = await supabase.rpc('deny_time_off_request', { p_request_id: req.id, p_notes: notes || null })
    if (error) { showToast(handleSupabaseError(error, 'Failed to deny.'), 'error'); setReviewingId(null); return }

    logAudit('time_off_denied', 'time_off_request', req.id, { employee_id: req.employee_id, days: req.business_days, type: req.type })

    const emailed = req.employee?.email
      ? await sendEmail({ to: req.employee.email, subject: 'Your time off request has been denied', html: decisionEmail(req, 'denied', notes, '<p>Please reach out to HR if you have questions.</p>') })
      : null
    showToast(emailed === false ? 'Denied, but the email to the employee failed to send.' : 'Request denied.', emailed === false ? 'warning' : 'success')
    setReviewingId(null)
    await fetchCore()
  }

  // HR can cancel approved leave at any point (an employee can only before it
  // starts). Any vacation days it used go back into the balance.
  async function adminCancel(req) {
    const { error } = await supabase.rpc('cancel_time_off_request', { p_request_id: req.id })
    if (error) { showToast(handleSupabaseError(error, 'Failed to cancel.'), 'error'); return }
    logAudit('time_off_cancelled', 'time_off_request', req.id, { employee_id: req.employee_id, days: req.business_days, type: req.type, previous_status: req.status, by_hr: true })
    const refund = countsAgainstBalance(req.type) ? `<p>${formatDays(req.business_days)} have gone back into your vacation balance.</p>` : ''
    const emailed = req.employee?.email
      ? await sendEmail({ to: req.employee.email, subject: 'Your time off has been cancelled', html: decisionEmail(req, 'cancelled by HR', '', refund) })
      : null
    showToast(emailed === false ? 'Cancelled, but the email to the employee failed to send.' : 'Time off cancelled.', emailed === false ? 'warning' : 'success')
    setConfirmCancel(null)
    await fetchCore()
  }

  // ── Balances ──
  async function saveBalance(row) {
    const total = parseFloat(editing.total)
    const carried = parseFloat(editing.carried === '' ? '0' : editing.carried)
    const used = parseFloat(editing.used === '' ? '0' : editing.used)
    if ([total, carried, used].some(v => isNaN(v) || v < 0)) { showToast('Enter numbers of 0 or more.', 'error'); return }
    setSavingBalance(true)
    const values = { total_days: total, carried_over: carried, used_days: used }
    const { error } = row.balance
      ? await supabase.from('time_off_balances').update(values).eq('id', row.balance.id)
      : await supabase.from('time_off_balances').insert({ employee_id: row.employee.id, year: balYear, ...values })
    setSavingBalance(false)
    if (error) { showToast(handleSupabaseError(error, 'Failed to save the balance.'), 'error'); return }
    logAudit('time_off_balance_updated', 'time_off_balance', row.employee.id, {
      employee: row.employee.full_name, year: balYear, ...values,
      previous: row.balance ? { total_days: row.balance.total_days, carried_over: row.balance.carried_over, used_days: row.balance.used_days } : null,
    })
    showToast('Balance saved.')
    setEditing(null)
    await fetchCore()
  }

  async function applyBulkEntitlement() {
    const days = parseFloat(bulkDays)
    if (isNaN(days) || days <= 0) { showToast('Enter a number of days above 0.', 'error'); return }
    const y = String(balYear)
    const targets = employees.filter(e => hasNoEntitlement(balanceIndex[e.id]?.[y]))
    if (targets.length === 0) return
    setBulkSaving(true)
    const inserts = targets.filter(e => !balanceIndex[e.id]?.[y]).map(e => ({ employee_id: e.id, year: balYear, total_days: days, used_days: 0 }))
    const updateIds = targets.filter(e => balanceIndex[e.id]?.[y]).map(e => balanceIndex[e.id][y].id)
    const results = await Promise.all([
      inserts.length ? supabase.from('time_off_balances').insert(inserts) : { error: null },
      updateIds.length ? supabase.from('time_off_balances').update({ total_days: days }).in('id', updateIds) : { error: null },
    ])
    setBulkSaving(false)
    const err = results.find(r => r.error)?.error
    if (err) { showToast(handleSupabaseError(err, 'Failed to set entitlements.'), 'error'); await fetchCore(); return }
    logAudit('time_off_balance_updated', 'time_off_balance', null, { bulk: true, year: balYear, total_days: days, employees: targets.length })
    showToast(`${targets.length} ${targets.length === 1 ? 'person' : 'people'} now have ${days} days for ${balYear}.`)
    setBulkDays('')
    await fetchCore()
  }

  async function startYear() {
    const cap = parseFloat(carryCap === '' ? '0' : carryCap)
    if (isNaN(cap) || cap < 0) { showToast('Enter a carry-over limit of 0 or more.', 'error'); return }
    const { data: count, error } = await supabase.rpc('start_time_off_year', { p_year: balYear, p_carry_cap: cap })
    if (error) { showToast(handleSupabaseError(error, `Failed to set up ${balYear}.`), 'error'); return }
    logAudit('time_off_year_started', 'time_off_balance', null, { year: balYear, carry_over_cap: cap, balances: count })
    showToast(`${balYear} set up for ${count} ${count === 1 ? 'person' : 'people'}.`)
    setStartYearOpen(false)
    await fetchCore()
  }

  // ── Logging time off for someone ──
  async function submitLog() {
    const f = logForm
    const half = f.portion !== 'full'
    const end = half ? f.start : f.end
    if (!f.employeeId) { showToast('Choose who the time off is for.', 'error'); return }
    if (!f.start || !end) { showToast('Choose the dates.', 'error'); return }
    if (end < f.start) { showToast('The last day must be on or after the first day.', 'error'); return }
    const clash = (requestsByEmployee[f.employeeId] || []).find(r => isLive(r) && r.start_date <= end && r.end_date >= f.start)
    if (clash) { showToast(`They already have a ${clash.status} request for ${fmtDateRange(clash.start_date, clash.end_date)}.`, 'error'); return }

    setLogSaving(true)
    const { data: created, error } = await supabase
      .from('time_off_requests')
      .insert({
        employee_id: f.employeeId, start_date: f.start, end_date: end,
        business_days: 0, // the database counts this on insert
        type: f.type, notes: f.notes.trim() || null, status: TIME_OFF_STATUS.PENDING,
        is_half_day: half, day_portion: f.portion,
      })
      .select('id, business_days')
      .single()
    if (error) { setLogSaving(false); showToast(handleSupabaseError(error, 'Failed to log time off.'), 'error'); return }

    if (f.approve) {
      const { error: apErr } = await supabase.rpc('approve_time_off_request', { p_request_id: created.id, p_notes: 'Logged by HR' })
      if (apErr) { setLogSaving(false); showToast(handleSupabaseError(apErr, 'Logged, but approving it failed. It is waiting in Requests.'), 'warning'); await fetchCore(); return }
    }
    setLogSaving(false)
    logAudit('time_off_logged', 'time_off_request', created.id, { employee_id: f.employeeId, type: f.type, start_date: f.start, end_date: end, approved: f.approve })
    showToast(f.approve ? 'Time off logged and approved.' : 'Time off logged. It is waiting in Requests.')
    setLogForm(null)
    await fetchCore()
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
        if (b.status === TIME_OFF_STATUS.PENDING && a.status !== TIME_OFF_STATUS.PENDING) return 1
      }
      let av = a[sortField] || ''
      let bv = b[sortField] || ''
      if (sortField === 'employee_name') { av = a.employee?.full_name || ''; bv = b.employee?.full_name || '' }
      if (sortField === 'business_days') { av = Number(a.business_days) || 0; bv = Number(b.business_days) || 0 }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })

  const s = {
    ...BASE_STYLES,
    page: { padding: isMobile ? '16px 16px 40px' : '24px 40px 48px', maxWidth: '1120px' },
  }

  const REQ_COLS = 'minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1.1fr) 56px 96px 120px 170px'
  const BAL_COLS = 'minmax(0, 1.6fr) 84px 84px 70px 74px 90px 70px'

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
        <span aria-hidden="true" style={{ fontSize: 'var(--text-xs)', marginLeft: '4px', color: active ? T.text : T.subtle }}>
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '⬍'}
        </span>
      </button>
    )
  }

  function remainingText(remaining) {
    return (
      <span className="il-tabular" style={{ color: remaining < 0 ? T.danger : T.muted, fontWeight: remaining < 0 ? 600 : 400 }}>
        {remaining < 0 ? `${formatDays(Math.abs(remaining))} over` : formatDays(remaining)}
      </span>
    )
  }

  // What's left after approval, per year the request touches.
  function afterCell(req) {
    if (!countsAgainstBalance(req.type)) return <span style={{ color: T.subtle, fontSize: 'var(--text-xs)' }}>Not from balance</span>
    const after = afterApproval(req)
    if (after.length === 0) return <span style={{ color: T.subtle }}>–</span>
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: '1px' }}>
        {after.map(a => (
          <span key={a.year} style={{ fontSize: after.length > 1 ? 'var(--text-sm)' : undefined }}>
            {after.length > 1 && <span style={{ color: T.subtle }}>{a.year}: </span>}
            {a.hasBalance ? remainingText(a.remaining) : <span style={{ color: T.warning, fontSize: 'var(--text-xs)' }}>No {a.year} balance</span>}
          </span>
        ))}
      </span>
    )
  }

  // What the employee told us, and who decided.
  function detailsLine(req) {
    const bits = []
    if (req.flexibility) bits.push(['Flexibility', `${FLEX_LABELS[req.flexibility] || req.flexibility}${req.flexibility_note ? `: ${req.flexibility_note}` : ''}`])
    if (req.volunteering_with) bits.push(['Volunteering with', req.volunteering_with])
    if (req.notes) bits.push(['Their note', req.notes])
    if (req.status !== TIME_OFF_STATUS.PENDING && req.reviewer?.full_name) bits.push([req.status === TIME_OFF_STATUS.APPROVED ? 'Approved by' : 'Decided by', req.reviewer.full_name])
    if (req.status !== TIME_OFF_STATUS.PENDING && req.review_notes) bits.push(['HR note', req.review_notes])
    if (bits.length === 0) return null
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 'var(--text-sm)', color: T.muted, lineHeight: 1.45 }}>
        {bits.map(([k, v]) => (
          <span key={k}><span style={{ color: T.subtle }}>{k}:</span> {v}</span>
        ))}
      </div>
    )
  }

  function canHrCancel(req) {
    return req.status === TIME_OFF_STATUS.APPROVED && req.end_date >= TODAY
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

  function cancelButton(req) {
    return (
      <Button size="xs" variant="ghost" style={{ color: T.danger }} onClick={() => setConfirmCancel(req)}
        aria-label={`Cancel ${req.employee?.full_name || ''}'s approved time off`}>Cancel</Button>
    )
  }

  function noteInput(req, style) {
    return (
      <input
        className="il-input"
        style={style}
        aria-label={`Note to ${req.employee?.full_name || 'the employee'}`}
        placeholder="Note to the employee (optional)"
        value={reviewNotes[req.id] || ''}
        onChange={e => setReviewNotes(prev => ({ ...prev, [req.id]: e.target.value }))}
      />
    )
  }

  function renderRequestCard(req) {
    const overlapNames = getOverlapNames(req)
    const pending = req.status === TIME_OFF_STATUS.PENDING
    const details = detailsLine(req)
    return (
      <div key={req.id} style={{ ...s.card, padding: '14px 16px', marginBottom: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 'var(--text-md)', fontWeight: 500, color: T.text }}>{req.employee?.full_name || '?'}</div>
            {overlapNames.length > 0 && (
              <div style={{ fontSize: 'var(--text-xs)', color: T.warning, marginTop: '2px' }}>{overlapNames.join(', ')} also off</div>
            )}
          </div>
          <StatusPill status={req.status} />
        </div>
        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: 'var(--text-base)', color: T.muted, marginBottom: '8px' }}>
          <span>{fmtDateRange(req.start_date, req.end_date)}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <TypeIcon type={req.type} size={12} />{TYPE_LABELS[req.type] || req.type}
          </span>
          <span className="il-tabular">{formatDays(req.business_days)}{req.is_half_day ? ' ½' : ''}</span>
          {pending && <span>After: {afterCell(req)}</span>}
        </div>
        {details && <div style={{ marginBottom: pending || canHrCancel(req) ? '10px' : 0 }}>{details}</div>}
        {pending && (
          <div>
            {noteInput(req, { marginBottom: '10px' })}
            {reviewButtons(req, false)}
          </div>
        )}
        {canHrCancel(req) && cancelButton(req)}
      </div>
    )
  }

  // ── Balances: derived rows for the chosen year ──
  const balY = String(balYear)
  const balanceRows = employees
    .filter(e => !balSearch || e.full_name.toLowerCase().includes(balSearch.toLowerCase()) || (e.email || '').toLowerCase().includes(balSearch.toLowerCase()))
    .map(emp => {
      const bal = balanceIndex[emp.id]?.[balY] || null
      const empReqs = requestsByEmployee[emp.id] || []
      return {
        employee: emp,
        balance: bal,
        summary: summarizeYear(bal, empReqs, balYear),
        requests: empReqs.filter(r => Number(yearSplitOf(r)[balY]) > 0 || r.start_date.startsWith(balY)).sort((a, b) => (a.start_date < b.start_date ? 1 : -1)),
      }
    })
  const missingCount = employees.filter(e => hasNoEntitlement(balanceIndex[e.id]?.[balY])).length
  const prevYearCount = allBalances.filter(b => Number(b.year) === balYear - 1).length

  const pendingCount = requests.filter(r => r.status === TIME_OFF_STATUS.PENDING).length
  const skeletonCards = [1, 2, 3].map(i => (
    <div key={i} style={{ ...s.card, padding: '16px', marginBottom: '10px' }}><SkeletonLine width={`${40 + i * 10}%`} height="13px" /></div>
  ))

  return (
    <Layout session={session} userProfile={userProfile} currentPage="time-off" onNavigate={onNavigate}>
      <PageHeader
        title="Time off"
        subtitle={isMobile ? null : 'Review requests, set yearly entitlements and see who’s away.'}
        actions={<Button size="sm" variant="secondary" onClick={() => setLogForm({ ...EMPTY_LOG })}>Log time off</Button>}
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
              <span aria-live="polite" style={{ fontSize: 'var(--text-sm)', color: T.subtle, marginLeft: 'auto' }}>
                {loading ? '' : `${displayRequests.length} result${displayRequests.length !== 1 ? 's' : ''}`}
              </span>
            </div>

            {loading ? skeletonCards : displayRequests.length === 0 ? (
              <div style={s.card}>
                <EmptyState icon={EmptyIcons.calendar}
                  title={requests.length === 0 ? 'No time off requests yet' : 'No requests match'}
                  message={requests.length === 0 ? 'Requests employees submit will show up here for review. You can also log time off for someone with "Log time off".' : 'Try clearing the filters.'} />
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
                  <div role="columnheader" title="Vacation balance left if this request is approved">Left after</div>
                  <div role="columnheader"><span className="il-visually-hidden">Actions</span></div>
                </div>
                {displayRequests.map(req => {
                  const overlapNames = getOverlapNames(req)
                  const pending = req.status === TIME_OFF_STATUS.PENDING
                  const details = detailsLine(req)
                  return (
                    <div key={req.id} role="row" style={{ borderBottom: `1px solid ${T.borderSubtle}`, background: pending ? T.surface : 'transparent' }}>
                      <div style={{ ...s.tRow(REQ_COLS), borderBottom: 'none' }}>
                        <div role="cell" style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 500 }}>{req.employee?.full_name || '?'}</div>
                          {overlapNames.length > 0 && (
                            <div style={{ fontSize: 'var(--text-xs)', color: T.warning, marginTop: '2px' }}>{overlapNames.join(', ')} also off</div>
                          )}
                        </div>
                        <div role="cell" style={{ color: T.muted, fontSize: 'var(--text-sm)' }}>{fmtDateRange(req.start_date, req.end_date)}</div>
                        <div role="cell" style={{ display: 'flex', alignItems: 'center', gap: '5px', color: T.muted, fontSize: 'var(--text-sm)', minWidth: 0 }}>
                          <TypeIcon type={req.type} size={12} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{TYPE_LABELS[req.type] || req.type}</span>
                        </div>
                        <div role="cell" className="il-tabular">{formatDays(req.business_days)}{req.is_half_day ? <span style={{ fontSize: 'var(--text-xs)', color: T.muted }}> ½</span> : null}</div>
                        <div role="cell"><StatusPill status={req.status} /></div>
                        <div role="cell" style={{ fontSize: 'var(--text-base)' }}>{pending ? afterCell(req) : <span style={{ color: T.subtle }}>–</span>}</div>
                        <div role="cell">{pending ? reviewButtons(req, true) : canHrCancel(req) ? cancelButton(req) : null}</div>
                      </div>
                      {(pending || details) && (
                        <div style={{ padding: '0 16px 12px', display: 'grid', gap: '8px' }}>
                          {details}
                          {pending && noteInput(req, { maxWidth: '420px', padding: '6px 10px', fontSize: 'var(--text-sm)' })}
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
          <>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '14px' }}>
              <Segmented size="sm" label="Balance year" value={balYear} onChange={y => { setBalYear(y); setEditing(null); setExpandedEmployeeId(null) }}
                options={[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map(y => ({ value: y, label: String(y) }))} />
              <div style={{ flex: isMobile ? '1 1 100%' : '0 1 260px', minWidth: 0 }}>
                <SearchInput value={balSearch} onChange={setBalSearch} placeholder="Find a person…" label="Find a person" />
              </div>
              {prevYearCount > 0 && (
                <Button size="sm" variant="secondary" style={{ marginLeft: isMobile ? 0 : 'auto' }} onClick={() => setStartYearOpen(true)}>
                  Set up {balYear} from {balYear - 1}
                </Button>
              )}
            </div>

            {!loading && missingCount > 0 && (
              <form onSubmit={e => { e.preventDefault(); applyBulkEntitlement() }}
                style={{ ...s.card, padding: '12px 16px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', background: T.surfaceSunken }}>
                <span style={{ fontSize: 'var(--text-sm)', color: T.text }}>
                  <strong>{missingCount}</strong> {missingCount === 1 ? 'person has' : 'people have'} no {balYear} entitlement yet. Give them all
                </span>
                <input className="il-input il-tabular" type="number" min="0.5" step="0.5" aria-label={`Days for everyone without a ${balYear} entitlement`}
                  style={{ width: '80px', padding: '5px 8px' }} value={bulkDays} onChange={e => setBulkDays(e.target.value)} placeholder="days" />
                <Button size="sm" type="submit" busy={bulkSaving} busyLabel="Saving…" disabled={!bulkDays}>Apply</Button>
              </form>
            )}

            {loading ? skeletonCards : balanceRows.length === 0 ? (
              <div style={s.card}><EmptyState icon={EmptyIcons.people} title={employees.length ? 'Nobody matches' : 'No employees yet'} message={employees.length ? 'Try a different name.' : 'Balances appear once employees are added.'} /></div>
            ) : (
              <div style={{ ...s.card, overflow: 'hidden' }}>
                {!isMobile && (
                  <div style={s.tHead(BAL_COLS)}>
                    <div>Employee</div><div title="Yearly allowance">Entitlement</div><div title="Brought forward from last year">Carried</div>
                    <div>Used</div><div>Pending</div><div>Remaining</div><div></div>
                  </div>
                )}
                {balanceRows.map(row => {
                  const { summary } = row
                  const isEditing = editing?.employeeId === row.employee.id
                  const isExpanded = expandedEmployeeId === row.employee.id
                  const notSet = hasNoEntitlement(row.balance)
                  const nameButton = (
                    <button type="button" aria-expanded={isExpanded} onClick={() => setExpandedEmployeeId(isExpanded ? null : row.employee.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
                      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={{ color: T.subtle, flexShrink: 0, transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
                        <path d="M3 1.5L6.5 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontWeight: 500, color: T.text }}>{row.employee.full_name}</span>
                        <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: T.subtle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.employee.email}</span>
                      </span>
                    </button>
                  )
                  const editButton = (
                    <Button size="xs" variant="secondary"
                      onClick={() => setEditing({ employeeId: row.employee.id, total: String(summary.entitlement), carried: String(summary.carried), used: String(summary.used) })}
                      aria-label={`Edit ${row.employee.full_name}'s ${balYear} balance`}>{notSet ? 'Set' : 'Edit'}</Button>
                  )
                  const numbers = {
                    entitlement: notSet ? <span style={{ color: T.warning, fontSize: 'var(--text-sm)' }}>Not set</span> : <span className="il-tabular">{formatDays(summary.entitlement)}</span>,
                    carried: <span className="il-tabular" style={{ color: summary.carried > 0 ? T.text : T.subtle }}>{summary.carried > 0 ? formatDays(summary.carried) : '–'}</span>,
                    used: <span className="il-tabular">{formatDays(summary.used)}</span>,
                    pending: <span className="il-tabular" style={{ color: summary.pending > 0 ? T.warning : T.subtle }}>{summary.pending > 0 ? formatDays(summary.pending) : '–'}</span>,
                    remaining: <span className="il-tabular" style={{ fontWeight: 600, color: summary.remaining < 0 ? T.danger : T.text }}>{formatDays(summary.remaining)}</span>,
                  }
                  const editForm = isEditing && (
                    <form onSubmit={e => { e.preventDefault(); saveBalance(row) }}
                      style={{ padding: isMobile ? '0 16px 14px' : '4px 16px 14px 42px', display: 'grid', gap: '10px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr 1fr' : 'repeat(3, 120px)', gap: '10px' }}>
                        {[['total', 'Entitlement'], ['carried', 'Carried over'], ['used', 'Used']].map(([key, label]) => (
                          <label key={key} style={{ display: 'grid', gap: '4px', fontSize: 'var(--text-xs)', color: T.muted, fontWeight: 500 }}>
                            {label}
                            <input className="il-input il-tabular" type="number" min="0" step="0.5" autoFocus={key === 'total'}
                              style={{ padding: '5px 8px' }} value={editing[key]}
                              onChange={e => setEditing(prev => ({ ...prev, [key]: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Escape') setEditing(null) }} />
                          </label>
                        ))}
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: T.subtle, lineHeight: 1.5, maxWidth: '560px' }}>
                        Approvals add to Used automatically. Only change Used to record days taken before this system, or to correct a mistake.
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <Button size="xs" type="submit" busy={savingBalance} busyLabel="Saving…">Save</Button>
                        <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                      </div>
                    </form>
                  )

                  return (
                    <div key={row.employee.id} style={{ borderBottom: `1px solid ${T.borderSubtle}`, background: isExpanded || isEditing ? T.surfaceSunken : 'transparent' }}>
                      {isMobile ? (
                        <div style={{ padding: '14px 16px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                            {nameButton}
                            <div style={{ fontSize: 'var(--text-lg)', flexShrink: 0 }}>{numbers.remaining}</div>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', fontSize: 'var(--text-sm)' }}>
                            {[['Entitlement', numbers.entitlement], ['Carried', numbers.carried], ['Used', numbers.used], ['Pending', numbers.pending]].map(([label, value]) => (
                              <div key={label} style={{ background: T.surfaceSunken, borderRadius: T.radiusSm, padding: '8px 10px' }}>
                                <div style={{ color: T.muted, marginBottom: '2px' }}>{label}</div>
                                <div style={{ fontWeight: 500, color: T.text }}>{value}</div>
                              </div>
                            ))}
                          </div>
                          {!isEditing && <div style={{ marginTop: '10px' }}>{editButton}</div>}
                        </div>
                      ) : (
                        <div style={{ ...s.tRow(BAL_COLS), borderBottom: 'none' }}>
                          <div style={{ minWidth: 0 }}>{nameButton}</div>
                          <div>{numbers.entitlement}</div>
                          <div>{numbers.carried}</div>
                          <div>{numbers.used}</div>
                          <div>{numbers.pending}</div>
                          <div>{numbers.remaining}</div>
                          <div>{!isEditing && editButton}</div>
                        </div>
                      )}
                      {editForm}
                      {isExpanded && (
                        <div style={{ borderTop: `1px solid ${T.borderSubtle}` }}>
                          {row.requests.length === 0 ? (
                            <div style={{ padding: '12px 24px', fontSize: 'var(--text-sm)', color: T.subtle }}>No requests in {balYear}.</div>
                          ) : row.requests.map(req => (
                            <div key={req.id} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr auto' : '1fr 1fr 70px 100px', gap: '8px', padding: isMobile ? '10px 16px' : '10px 24px 10px 42px', borderBottom: `1px solid ${T.borderSubtle}`, fontSize: 'var(--text-sm)', color: T.muted, alignItems: 'center' }}>
                              <div>{fmtDateRange(req.start_date, req.end_date)}{isMobile && <div style={{ marginTop: '2px' }}>{TYPE_LABELS[req.type] || req.type} · {formatDays(req.business_days)}</div>}</div>
                              {!isMobile && <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><TypeIcon type={req.type} size={11} />{TYPE_LABELS[req.type] || req.type}{!countsAgainstBalance(req.type) && <span style={{ color: T.subtle }}> (not from balance)</span>}</div>}
                              {!isMobile && <div className="il-tabular">{formatDays(req.business_days)}</div>}
                              <div><StatusPill status={req.status} /></div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            <p style={{ fontSize: 'var(--text-xs)', color: T.subtle, margin: '12px 2px 0', lineHeight: 1.6, maxWidth: '720px' }}>
              Remaining = entitlement + carried over − used − pending. Only Personal / Vacation leave uses these days; other types are tracked but don't change the balance.
            </p>
          </>
        )}

        {/* ── CALENDAR ── */}
        {subView === 'calendar' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
              <Button size="sm" variant="secondary" onClick={prevMonth} aria-label="Previous month">‹</Button>
              <h2 aria-live="polite" style={{ ...T.type.h2, margin: 0, fontSize: 'var(--text-md)', color: T.text, minWidth: isMobile ? '130px' : '160px', textAlign: 'center' }}>
                {MONTH_NAMES[calMonth]} {calYear}
              </h2>
              <Button size="sm" variant="secondary" onClick={nextMonth} aria-label="Next month">›</Button>
              <Button size="sm" variant="ghost" onClick={() => { setCalYear(new Date().getFullYear()); setCalMonth(new Date().getMonth()) }}>Today</Button>
              {!isMobile && (
                <div style={{ display: 'flex', gap: '14px', marginLeft: 'auto', alignItems: 'center', fontSize: 'var(--text-sm)', color: T.muted }}>
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
                    <div key={d} style={{ padding: isMobile ? '6px 4px' : '8px 10px', fontSize: 'var(--text-xs)', fontWeight: 600, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.4px', textAlign: 'center', borderRight: i < 6 ? `1px solid ${T.borderSubtle}` : 'none' }}>
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
                                  <span aria-label={`${day}, today`} style={{ background: T.brand, color: T.onAccent, borderRadius: '50%', width: '20px', height: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--text-xs)', fontWeight: 700 }}>
                                    {day}
                                  </span>
                                ) : (
                                  <span className="il-tabular" style={{ fontSize: 'var(--text-sm)', color: isWeekend ? T.subtle : T.muted }}>{day}</span>
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
                                  fontSize: 'var(--text-xs)', fontWeight: 600,
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
              <h2 style={{ ...T.type.h2, fontSize: 'var(--text-md)', margin: '0 0 6px', color: T.text }}>Add a holiday</h2>
              <p style={{ fontSize: 'var(--text-sm)', color: T.muted, margin: '0 0 14px', lineHeight: 1.55 }}>
                Holidays are skipped when business days are counted. Only tick “repeats” for holidays on the same date every year (like Canada Day). Ones that move, such as Heritage Day, Good Friday, Natal Day, Labour Day and Thanksgiving, need adding for each year.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) 170px', gap: '0 12px' }}>
                <Field label="Name"><input placeholder="e.g. Natal Day" value={newHolidayName} onChange={e => setNewHolidayName(e.target.value)} /></Field>
                <Field label="Date"><input type="date" value={newHolidayDate} onChange={e => setNewHolidayDate(e.target.value)} /></Field>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: 'var(--text-base)', color: T.muted, cursor: 'pointer' }}>
                  <input type="checkbox" checked={newHolidayRepeats} onChange={e => setNewHolidayRepeats(e.target.checked)} style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: 'var(--brand)' }} />
                  Repeats every year on this date
                </label>
                <Button type="submit" busy={savingHoliday} busyLabel="Adding…" disabled={!newHolidayName.trim() || !newHolidayDate}>Add holiday</Button>
              </div>
              <p style={{ fontSize: 'var(--text-xs)', color: T.subtle, margin: '12px 0 0', lineHeight: 1.5 }}>
                Adding or removing a holiday recounts every pending request automatically. Approved requests keep the count they were approved with.
              </p>
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
                        {isMobile && <div style={{ fontSize: 'var(--text-sm)', color: T.muted, marginTop: '2px' }}>{formatDate(h.date)}{h.repeats_yearly ? ' · Every year' : ''}</div>}
                      </div>
                      {!isMobile && <div style={{ color: T.muted, fontSize: 'var(--text-sm)' }}>{h.repeats_yearly ? fmtDate(h.date) : formatDate(h.date)}</div>}
                      {!isMobile && <div style={{ fontSize: 'var(--text-sm)', color: h.repeats_yearly ? T.success : T.subtle }}>{h.repeats_yearly ? 'Every year' : 'Once'}</div>}
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

      {confirmCancel && (
        <ConfirmModal
          title={`Cancel ${confirmCancel.employee?.full_name?.split(' ')[0] || 'this'}'s time off?`}
          message={`${fmtDateRange(confirmCancel.start_date, confirmCancel.end_date)}, ${TYPE_LABELS[confirmCancel.type] || confirmCancel.type}.${countsAgainstBalance(confirmCancel.type) ? ` ${formatDays(confirmCancel.business_days)} go back into their balance.` : ''} They'll get an email.`}
          confirmLabel="Cancel time off"
          confirmDanger
          onConfirm={() => adminCancel(confirmCancel)}
          onCancel={() => setConfirmCancel(null)}
        />
      )}

      {startYearOpen && (
        <Modal
          title={`Set up ${balYear} from ${balYear - 1}`}
          description={`Copies each person's ${balYear - 1} entitlement into ${balYear} and carries unused days forward, up to the limit below. People who already have a ${balYear} entitlement keep it; only their carry-over is refreshed.`}
          onClose={() => setStartYearOpen(false)}
          maxWidth={460}
          footer={(
            <>
              <Button variant="secondary" onClick={() => setStartYearOpen(false)}>Close</Button>
              <Button onClick={startYear}>Set up {balYear}</Button>
            </>
          )}
        >
          <Field label="Carry over at most (days)" hint="0 means unused days don't carry over.">
            <input className="il-input il-tabular" type="number" min="0" step="0.5" value={carryCap} onChange={e => setCarryCap(e.target.value)} />
          </Field>
          <p style={{ fontSize: 'var(--text-sm)', color: T.muted, margin: 0, lineHeight: 1.55 }}>
            It's safe to run more than once. Run it in December so people can book January, then again in early January once December's leave is final, so carry-over reflects what was really left.
          </p>
        </Modal>
      )}

      {logForm && (
        <Modal
          title="Log time off"
          description="For when someone calls in, emails, or doesn't have a portal login. It shows in their history like any other request."
          onClose={() => setLogForm(null)}
          busy={logSaving}
          maxWidth={480}
          footer={(
            <>
              <Button variant="secondary" onClick={() => setLogForm(null)} disabled={logSaving}>Cancel</Button>
              <Button onClick={submitLog} busy={logSaving} busyLabel="Saving…">{logForm.approve ? 'Log and approve' : 'Log as pending'}</Button>
            </>
          )}
        >
          <Field label="Employee" required>
            <select value={logForm.employeeId} onChange={e => setLogForm(f => ({ ...f, employeeId: e.target.value }))}>
              <option value="">Choose…</option>
              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.full_name}</option>)}
            </select>
          </Field>
          <div style={{ marginBottom: '18px' }}>
            <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 500, color: T.muted, marginBottom: '6px' }}>Duration</span>
            <Segmented size="sm" label="Duration" value={logForm.portion} onChange={v => setLogForm(f => ({ ...f, portion: v }))}
              options={[{ value: 'full', label: 'Full day(s)' }, { value: 'am', label: 'Morning' }, { value: 'pm', label: 'Afternoon' }]} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: logForm.portion === 'full' ? '1fr 1fr' : '1fr', gap: '0 12px' }}>
            <Field label={logForm.portion === 'full' ? 'First day' : 'Date'} required>
              <input type="date" value={logForm.start} onChange={e => setLogForm(f => ({ ...f, start: e.target.value }))} />
            </Field>
            {logForm.portion === 'full' && (
              <Field label="Last day" required>
                <input type="date" min={logForm.start || undefined} value={logForm.end} onChange={e => setLogForm(f => ({ ...f, end: e.target.value }))} />
              </Field>
            )}
          </div>
          <Field label="Type" hint={countsAgainstBalance(logForm.type) ? 'Uses vacation days.' : "Doesn't use vacation days."}>
            <select value={logForm.type} onChange={e => setLogForm(f => ({ ...f, type: e.target.value }))}>
              {LOG_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Note" optional>
            <input placeholder="e.g. Called in sick" value={logForm.notes} onChange={e => setLogForm(f => ({ ...f, notes: e.target.value }))} />
          </Field>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: 'var(--text-base)', color: T.text, cursor: 'pointer' }}>
            <input type="checkbox" checked={logForm.approve} onChange={e => setLogForm(f => ({ ...f, approve: e.target.checked }))} style={{ width: '15px', height: '15px', accentColor: 'var(--brand)' }} />
            Approve it now
          </label>
        </Modal>
      )}

      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onClose={hideToast} />}
    </Layout>
  )
}
