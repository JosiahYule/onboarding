import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../supabaseClient'
import Layout from '../components/Layout'
import { SkeletonLine } from '../components/Skeleton'
import Toast from '../components/Toast'
import ConfirmModal from '../components/ConfirmModal'
import useToast from '../hooks/useToast'
import { handleSupabaseError } from '../utils/handleError'
import { logAudit } from '../utils/auditLog'
import { useWindowSize } from '../hooks/useWindowSize'
import { getToday, getCurrentYear, TIME_OFF_STATUS, BRANCHES, PROVINCES, branchName, branchProvince } from '../config'
import { TYPE_LABELS, StatusPill, TypeIcon, fmtDate, fmtDateRange } from '../utils/timeOffShared'
import { countsAgainstBalance, balanceBucket, BUCKETS, summarizeYear, remainingIfApproved, yearSplitOf, findOverlap, formatDays, workFromWhereverHint, othersOff } from '../utils/timeOffMath'
import { parseImportList } from '../utils/importList'
import { escapeHtml } from '../utils/escapeHtml'
import { sendTimeOffEmail, appLink } from '../utils/emailNotify'
import { formatDate } from '../utils/dates'
import { T } from '../ui/theme'
import PageHeader from '../ui/PageHeader'
import Button from '../ui/Button'
import Field from '../ui/Field'
import Modal from '../ui/Modal'
import Segmented from '../ui/Segmented'
import SearchInput from '../ui/SearchInput'
import EmptyState, { EmptyIcons } from '../ui/EmptyState'
import Avatar from '../ui/Avatar'
import Menu from '../ui/Menu'
import { weeksOfMonth, mondayOf, peopleOffInWeek, describeDays, weekTitle, weekEmail, copyRich } from '../utils/whosOff'
import { avatarHue } from '../utils/avatarColor'

// Each person's bar is drawn in their avatar colour (see avatarColor.js), so
// the calendar and the avatars agree. Bars are tinted by mixing the hue into
// the current surface, so they read in both light and dark themes.
function eventColors(hue, pending) {
  return {
    background: pending ? `color-mix(in srgb, ${hue} 12%, var(--surface))` : `color-mix(in srgb, ${hue} 26%, var(--surface))`,
    color: `color-mix(in srgb, ${hue} 72%, var(--text))`,
    border: pending ? `1.5px dashed color-mix(in srgb, ${hue} 75%, var(--surface))` : '1px solid transparent',
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

// Roomy enough that a month reads at a glance: each week is at least
// DATE_ROW_H + WEEK_MIN_EVENTS_H tall, and grows when more people are off.
const DATE_ROW_H = 34
const EVENT_H = 24
const EVENT_GAP = 4
const SLOT_H = EVENT_H + EVENT_GAP
const WEEK_MIN_EVENTS_H = 72

function addDaysIso(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

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

// Allowances count as "not set" when there's no row, or only the empty row an
// approval creates on its own (no vacation and no care days).
function hasNoEntitlement(bal) {
  return !bal || (Number(bal.total_days) === 0 && Number(bal.care_days) === 0)
}

// Partners, casual staff without vacation and former staff are marked as not
// taking time off: they stay out of Balances, the bulk shortcut and "Log time
// off", and are listed separately so they can be switched back on.
function takesTimeOff(emp) {
  return emp.takes_time_off !== false
}

// The holiday table has one row per province (or one row for every branch).
// For showing them, rows for the same day and name are merged into one, with
// the provinces it applies to and whether it's statutory or observed in each.
function groupHolidays(rows) {
  const groups = new Map()
  rows.forEach(h => {
    const key = `${h.date}|${h.name}`
    const g = groups.get(key) || { key, date: h.date, name: h.name, note: h.note, repeats: h.repeats_yearly, ids: [], provinces: [], kinds: {} }
    g.ids.push(h.id)
    if (h.province) { g.provinces.push(h.province); g.kinds[h.province] = h.kind }
    else { g.allBranches = true; g.kind = h.kind }
    g.note = g.note || h.note
    groups.set(key, g)
  })
  return [...groups.values()].map(g => ({
    ...g,
    provinces: PROVINCES.map(p => p.code).filter(c => g.provinces.includes(c)),
    everywhere: g.allBranches || PROVINCES.every(p => g.provinces.includes(p.code)),
  })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)))
}

// Does a holiday row fall on this YYYY-MM-DD date? Repeating holidays match
// the same month and day in any year.
function holidayOn(h, iso) {
  return h.date === iso || (h.repeats_yearly && h.date.slice(5) === iso.slice(5))
}

const KIND_LABEL = { statutory: 'Statutory', observed: 'Observed', company: 'Company' }
const ALL_PROVINCES = PROVINCES.map(p => p.code)

export default function TimeOff({ session, userProfile, onNavigate }) {
  const [subView, setSubView] = useState('requests')
  const [requests, setRequests] = useState([])
  const [allBalances, setAllBalances] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [reviewNotes, setReviewNotes] = useState({})
  const [reviewingId, setReviewingId] = useState(null)
  const [confirmCancel, setConfirmCancel] = useState(null)
  const [denyReq, setDenyReq] = useState(null)
  const [expandedEmployeeId, setExpandedEmployeeId] = useState(null)
  const [calYear, setCalYear] = useState(new Date().getFullYear())
  const [calMonth, setCalMonth] = useState(new Date().getMonth())
  // Requests
  const [noteOpen, setNoteOpen] = useState({})
  const [detailsOpen, setDetailsOpen] = useState({})
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterEmployee, setFilterEmployee] = useState('')
  const [decidedLimit, setDecidedLimit] = useState(20)
  // Balances
  const [balYear, setBalYear] = useState(getCurrentYear())
  const [balSearch, setBalSearch] = useState('')
  const [editing, setEditing] = useState(null) // { employeeId, vacation, vacationUsed, care, careUsed, branch, startDate }
  const [savingBalance, setSavingBalance] = useState(false)
  const [bulkDays, setBulkDays] = useState('')
  const [bulkCare, setBulkCare] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  // Opens on the year that has allowances, once, so HR isn't greeted by a
  // column of "Not set" when only next year has been loaded.
  const balYearChosen = useRef(false)
  const [startYearOpen, setStartYearOpen] = useState(false)
  // HR's yearly list
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importYear, setImportYear] = useState(getCurrentYear() + 1)
  const [importing, setImporting] = useState(false)
  // Calendar
  const [calBranch, setCalBranch] = useState('')
  const [copiedWeek, setCopiedWeek] = useState(null)
  // Logging time off on someone's behalf
  const [logForm, setLogForm] = useState(null)
  const [logSaving, setLogSaving] = useState(false)
  // Holidays
  const [holidays, setHolidays] = useState([])
  const [holidaysLoading, setHolidaysLoading] = useState(false)
  const [newHolidayName, setNewHolidayName] = useState('')
  const [newHolidayDate, setNewHolidayDate] = useState('')
  const [newHolidayRepeats, setNewHolidayRepeats] = useState(false)
  const [newHolidayProvinces, setNewHolidayProvinces] = useState(ALL_PROVINCES)
  const [savingHoliday, setSavingHoliday] = useState(false)
  const [deletingHolidayKey, setDeletingHolidayKey] = useState(null)
  const [holidayYear, setHolidayYear] = useState(getCurrentYear())
  const [addingYear, setAddingYear] = useState(false)
  const [holidayFormOpen, setHolidayFormOpen] = useState(false)
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
    await Promise.all([fetchCore(), subView === 'calendar' ? fetchHolidays() : null])
    setLoading(false)
  }

  // One load serves every view: all requests, every balance row, every employee.
  async function fetchCore() {
    const [reqRes, balRes, empRes] = await Promise.all([
      supabase
        .from('time_off_requests')
        .select(`
          *,
          employee:employees!time_off_requests_employee_id_fkey(id, full_name, email, branch),
          reviewer:employees!time_off_requests_reviewed_by_fkey(id, full_name)
        `)
        .order('created_at', { ascending: false }),
      supabase.from('time_off_balances').select('*'),
      supabase.from('employees').select('id, full_name, email, branch, hire_date, takes_time_off').order('full_name'),
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
    if (!newHolidayName.trim() || !newHolidayDate) { showToast('Name and date are required.', 'error'); return false }
    if (newHolidayProvinces.length === 0) { showToast('Choose at least one branch.', 'error'); return false }
    setSavingHoliday(true)
    const base = { name: newHolidayName.trim(), date: newHolidayDate, repeats_yearly: newHolidayRepeats, kind: 'company' }
    // One row for every branch, or one per province it applies to.
    const rows = newHolidayProvinces.length === ALL_PROVINCES.length
      ? [{ ...base, province: null }]
      : newHolidayProvinces.map(province => ({ ...base, province }))
    const { error } = await supabase.from('company_holidays').insert(rows)
    if (error) { showToast(handleSupabaseError(error, 'Failed to add holiday.'), 'error'); setSavingHoliday(false); return false }
    setNewHolidayName('')
    setNewHolidayDate('')
    setNewHolidayRepeats(false)
    setNewHolidayProvinces(ALL_PROVINCES)
    showToast('Holiday added. Pending requests have been recounted.')
    setSavingHoliday(false)
    await fetchHolidays()
    return true
  }

  async function deleteHoliday(group) {
    setDeletingHolidayKey(group.key)
    const { error } = await supabase.from('company_holidays').delete().in('id', group.ids)
    if (error) { showToast(handleSupabaseError(error, 'Failed to delete holiday.'), 'error'); setDeletingHolidayKey(null); return }
    showToast('Holiday removed. Pending requests have been recounted.')
    setDeletingHolidayKey(null)
    setHolidays(prev => prev.filter(h => !group.ids.includes(h.id)))
  }

  // Fills in every handbook holiday for a year, for each province.
  async function addYearHolidays(year) {
    setAddingYear(true)
    const { data: count, error } = await supabase.rpc('add_province_holidays', { p_year: year })
    setAddingYear(false)
    if (error) { showToast(handleSupabaseError(error, `Failed to add ${year}'s holidays.`), 'error'); return }
    logAudit('holidays_added', 'company_holidays', null, { year, added: count })
    showToast(count > 0 ? `Added ${year}'s holidays. Pending requests have been recounted.` : `${year}'s holidays are already in the list.`)
    await fetchHolidays()
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

  useEffect(() => {
    if (balYearChosen.current || allBalances.length === 0) return
    balYearChosen.current = true
    const has = y => allBalances.some(b => Number(b.year) === y && !hasNoEntitlement(b))
    if (!has(CURRENT_YEAR) && has(CURRENT_YEAR + 1)) setBalYear(CURRENT_YEAR + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, when balances first arrive
  }, [allBalances])

  const requestsByEmployee = useMemo(() => {
    const idx = {}
    requests.forEach(r => { (idx[r.employee_id] = idx[r.employee_id] || []).push(r) })
    return idx
  }, [requests])

  function afterApproval(req) {
    return remainingIfApproved(req, balanceIndex[req.employee_id] || {}, requestsByEmployee[req.employee_id] || [])
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
      ? await sendTimeOffEmail({ to: req.employee.email, subject: 'Your time off request has been approved', html: decisionEmail({ ...req, ...(approved || {}) }, 'approved', notes, '<p>Enjoy your time off!</p>') })
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
      ? await sendTimeOffEmail({ to: req.employee.email, subject: 'Your time off request has been denied', html: decisionEmail(req, 'denied', notes, '<p>Please reach out to HR if you have questions.</p>') })
      : null
    showToast(emailed === false ? 'Denied, but the email to the employee failed to send.' : 'Request denied.', emailed === false ? 'warning' : 'success')
    setReviewingId(null)
    setDenyReq(null)
    await fetchCore()
  }

  // HR can cancel approved leave at any point (an employee can only before it
  // starts). Any vacation days it used go back into the balance.
  async function adminCancel(req) {
    const { error } = await supabase.rpc('cancel_time_off_request', { p_request_id: req.id })
    if (error) { showToast(handleSupabaseError(error, 'Failed to cancel.'), 'error'); return }
    logAudit('time_off_cancelled', 'time_off_request', req.id, { employee_id: req.employee_id, days: req.business_days, type: req.type, previous_status: req.status, by_hr: true })
    const bucket = balanceBucket(req.type)
    const refund = bucket && req.status === TIME_OFF_STATUS.APPROVED ? `<p>${formatDays(req.business_days)} have gone back into your ${BUCKETS[bucket].short}.</p>` : ''
    const emailed = req.employee?.email
      ? await sendTimeOffEmail({ to: req.employee.email, subject: 'Your time off has been cancelled', html: decisionEmail(req, 'cancelled by HR', '', refund) })
      : null
    showToast(emailed === false ? 'Cancelled, but the email to the employee failed to send.' : 'Time off cancelled.', emailed === false ? 'warning' : 'success')
    setConfirmCancel(null)
    await fetchCore()
  }

  // ── Balances ──
  async function saveBalance(row) {
    const num = v => parseFloat(v === '' ? '0' : v)
    const values = {
      total_days: num(editing.vacation), used_days: num(editing.vacationUsed),
      care_days: num(editing.care), care_used: num(editing.careUsed),
    }
    if (Object.values(values).some(v => isNaN(v) || v < 0)) { showToast('Enter numbers of 0 or more.', 'error'); return }
    const empChanges = {}
    if ((editing.branch || null) !== (row.employee.branch || null)) empChanges.branch = editing.branch || null
    if ((editing.startDate || null) !== (row.employee.hire_date || null)) empChanges.hire_date = editing.startDate || null

    setSavingBalance(true)
    const { error } = row.balance
      ? await supabase.from('time_off_balances').update(values).eq('id', row.balance.id)
      : await supabase.from('time_off_balances').insert({ employee_id: row.employee.id, year: balYear, ...values })
    const empError = !error && Object.keys(empChanges).length
      ? (await supabase.from('employees').update(empChanges).eq('id', row.employee.id)).error
      : null
    setSavingBalance(false)
    if (error || empError) { showToast(handleSupabaseError(error || empError, 'Failed to save.'), 'error'); await fetchCore(); return }
    logAudit('time_off_balance_updated', 'time_off_balance', row.employee.id, {
      employee: row.employee.full_name, year: balYear, ...values, ...empChanges,
      previous: row.balance ? { total_days: row.balance.total_days, used_days: row.balance.used_days, care_days: row.balance.care_days, care_used: row.balance.care_used } : null,
    })
    showToast('Saved.')
    setEditing(null)
    await fetchCore()
  }

  // Takes someone out of (or back into) time off tracking. Their requests and
  // balances are kept either way.
  async function setTakesTimeOff(emp, value) {
    const { error } = await supabase.from('employees').update({ takes_time_off: value }).eq('id', emp.id)
    if (error) { showToast(handleSupabaseError(error, 'Failed to save.'), 'error'); return }
    logAudit('time_off_tracking_changed', 'employee', emp.id, { employee: emp.full_name, takes_time_off: value })
    showToast(value ? `${emp.full_name} is back on Balances.` : `${emp.full_name} won't appear on Balances.`)
    setEditing(null)
    await fetchCore()
  }

  async function applyBulkEntitlement() {
    const days = bulkDays === '' ? 0 : parseFloat(bulkDays)
    const care = bulkCare === '' ? 0 : parseFloat(bulkCare)
    if ([days, care].some(v => isNaN(v) || v < 0) || days + care === 0) { showToast('Enter a number of days above 0.', 'error'); return }
    const y = String(balYear)
    const targets = employees.filter(e => takesTimeOff(e) && hasNoEntitlement(balanceIndex[e.id]?.[y]))
    if (targets.length === 0) return
    setBulkSaving(true)
    const values = { total_days: days, care_days: care }
    const inserts = targets.filter(e => !balanceIndex[e.id]?.[y]).map(e => ({ employee_id: e.id, year: balYear, ...values, used_days: 0, care_used: 0 }))
    const updateIds = targets.filter(e => balanceIndex[e.id]?.[y]).map(e => balanceIndex[e.id][y].id)
    const results = await Promise.all([
      inserts.length ? supabase.from('time_off_balances').insert(inserts) : { error: null },
      updateIds.length ? supabase.from('time_off_balances').update(values).in('id', updateIds) : { error: null },
    ])
    setBulkSaving(false)
    const err = results.find(r => r.error)?.error
    if (err) { showToast(handleSupabaseError(err, 'Failed to set allowances.'), 'error'); await fetchCore(); return }
    logAudit('time_off_balance_updated', 'time_off_balance', null, { bulk: true, year: balYear, ...values, employees: targets.length })
    showToast(`${targets.length} ${targets.length === 1 ? 'person' : 'people'} now have ${days} vacation and ${care} care days for ${balYear}.`)
    setBulkDays('')
    setBulkCare('')
    await fetchCore()
  }

  async function startYear() {
    const { data: count, error } = await supabase.rpc('start_time_off_year', { p_year: balYear })
    if (error) { showToast(handleSupabaseError(error, `Failed to set up ${balYear}.`), 'error'); return }
    logAudit('time_off_year_started', 'time_off_balance', null, { year: balYear, balances: count })
    showToast(`${balYear} set up for ${count} ${count === 1 ? 'person' : 'people'}.`)
    setStartYearOpen(false)
    await fetchCore()
  }

  // HR's yearly list: preview first, then only lines with no problems are sent.
  const importPreview = useMemo(() => (importOpen ? parseImportList(importText, employees) : null), [importOpen, importText, employees])
  const importReady = importPreview ? importPreview.rows.filter(r => r.employee && r.problems.length === 0) : []

  async function runImport() {
    if (importReady.length === 0) return
    setImporting(true)
    const rows = importReady.map(r => ({ employee_id: r.employee.id, ...r.values }))
    const { data, error } = await supabase.rpc('import_time_off_list', { p_year: importYear, p_rows: rows })
    setImporting(false)
    if (error) { showToast(handleSupabaseError(error, 'The import failed, so nothing was changed.'), 'error'); return }
    logAudit('time_off_list_imported', 'time_off_balance', null, { year: importYear, lines: rows.length, ...(data || {}) })
    const skipped = importPreview.rows.length - importReady.length
    showToast(`Imported ${rows.length} ${rows.length === 1 ? 'person' : 'people'} for ${importYear}.${skipped ? ` ${skipped} line${skipped === 1 ? '' : 's'} skipped.` : ''}`)
    setImportOpen(false)
    setImportText('')
    setBalYear(importYear)
    await fetchCore()
  }

  async function readImportFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 1024 * 1024) { showToast('That file is too large. Save it as CSV first.', 'error'); return }
    setImportText(await file.text())
  }

  // ── Logging time off for someone ──
  async function submitLog() {
    const f = logForm
    const half = f.portion !== 'full'
    const end = half ? f.start : f.end
    if (!f.employeeId) { showToast('Choose who the time off is for.', 'error'); return }
    if (!f.start || !end) { showToast('Choose the dates.', 'error'); return }
    if (end < f.start) { showToast('The last day must be on or after the first day.', 'error'); return }
    const clash = findOverlap(requestsByEmployee[f.employeeId], f.start, end, { portion: f.portion })
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

  const allEmployees = [...new Map(requests.filter(r => r.employee).map(r => [r.employee_id, r.employee])).values()].sort((a, b) => a.full_name.localeCompare(b.full_name))

  const s = {
    ...BASE_STYLES,
    page: { padding: isMobile ? '16px 16px 40px' : '24px 40px 48px', maxWidth: '1120px' },
  }

  const BAL_COLS = 'minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1fr) 72px'

  // Plain render helpers, not components: a component defined inside this one
  // is a new type on every render, so React would remount it each keystroke
  // (the review-note field lost focus after every character).

  // What approving would leave, in words: "7 vacation days left in 2027".
  function balanceSummary(req) {
    const bucket = balanceBucket(req.type)
    if (!bucket) return <span>Doesn't use an allowance</span>
    const short = BUCKETS[bucket].short
    const n = v => formatDays(Math.abs(v)).slice(0, -1)
    return afterApproval(req).map(a => (
      <span key={a.year} style={!a.hasBalance ? { color: T.warning } : a.remaining < 0 ? { color: T.danger, fontWeight: 600 } : undefined}>
        {!a.hasBalance ? `No ${a.year} allowance set`
          : a.remaining < 0 ? `${n(a.remaining)} ${short} over in ${a.year}`
          : `${n(a.remaining)} ${short} left in ${a.year} after this`}
      </span>
    ))
  }

  // What the employee told us, and who decided.
  function detailsLine(req) {
    const bits = []
    if (req.direct_manager_name) bits.push(['Direct manager', req.direct_manager_name])
    const wfw = req.status === TIME_OFF_STATUS.PENDING && workFromWhereverHint(req.type, req.start_date, req.end_date, req.day_portion || 'full')
    if (wfw) bits.push(['Heads up', 'Not one full Monday to Friday week', true])
    if (req.flexibility) bits.push(['Flexibility', `${FLEX_LABELS[req.flexibility] || req.flexibility}${req.flexibility_note ? `: ${req.flexibility_note}` : ''}`])
    if (req.volunteering_with) bits.push(['Volunteering with', req.volunteering_with])
    if (req.notes) bits.push(['Their note', req.notes])
    if (bits.length === 0) return null
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 'var(--text-sm)', color: T.muted, lineHeight: 1.45 }}>
        {bits.map(([k, v, warn]) => (
          <span key={k} style={warn ? { color: T.warning } : undefined}><span style={{ color: warn ? T.warning : T.subtle }}>{k}:</span> {v}</span>
        ))}
      </div>
    )
  }

  function canHrCancel(req) {
    return req.status === TIME_OFF_STATUS.APPROVED && req.end_date >= TODAY
  }

  function cancelButton(req) {
    return (
      <Button size="xs" variant="ghost" style={{ color: T.muted }} onClick={() => setConfirmCancel(req)}
        aria-label={`Cancel ${req.employee?.full_name || ''}'s approved time off`}>Cancel</Button>
    )
  }

  // A request waiting for Shelley: who, when, what it leaves, then the two
  // decisions. The note to the employee only opens when it's wanted.
  function renderPendingCard(req) {
    const overlap = othersOff(req, requests)
    const details = detailsLine(req)
    const busy = reviewingId === req.id
    const first = req.employee?.full_name?.split(' ')[0] || 'them'
    const portion = req.day_portion === 'am' ? ', morning' : req.day_portion === 'pm' ? ', afternoon' : ''
    const actions = (
      <div style={{ display: 'flex', gap: '8px', flexShrink: 0, ...(isMobile ? { marginTop: '14px' } : {}) }}>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDenyReq(req)} style={{ color: T.danger, flex: isMobile ? 1 : undefined }}
          aria-label={`Deny ${req.employee?.full_name || ''}'s request`}>Deny</Button>
        <Button size="sm" busy={busy} busyLabel="Saving…" onClick={() => approveRequest(req)} style={{ flex: isMobile ? 1 : undefined, minWidth: '96px' }}
          aria-label={`Approve ${req.employee?.full_name || ''}'s request`}>Approve</Button>
      </div>
    )
    return (
      <article key={req.id} style={{ ...s.card, padding: isMobile ? '16px' : '18px 20px', marginBottom: '10px' }}>
        <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
          <Avatar name={req.employee?.full_name} colorKey={req.employee?.email} size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: T.text }}>{req.employee?.full_name || '?'}</span>
              <span style={{ fontSize: 'var(--text-sm)', color: T.muted }}>{TYPE_LABELS[req.type] || req.type}</span>
            </div>
            <div style={{ fontSize: 'var(--text-md)', color: T.text, marginTop: '4px' }}>
              {fmtDateRange(req.start_date, req.end_date)}
              <span style={{ color: T.muted }}> · {formatDays(req.business_days).slice(0, -1)} day{Number(req.business_days) === 1 ? '' : 's'}{portion}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px', fontSize: 'var(--text-sm)', color: T.muted, marginTop: '6px' }}>
              {balanceSummary(req)}
              {overlap.approved.length > 0 && <span style={{ color: T.warning }}>Also off: {overlap.approved.join(', ')}</span>}
              {overlap.pending.length > 0 && <span style={{ color: T.warning }}>Also waiting for approval: {overlap.pending.join(', ')}</span>}
            </div>
            {details && <div style={{ marginTop: '8px' }}>{details}</div>}
            <div style={{ marginTop: '10px' }}>
              {noteOpen[req.id] ? (
                <input className="il-input" autoFocus style={{ maxWidth: '440px', padding: '6px 10px', fontSize: 'var(--text-sm)' }}
                  aria-label={`Note to ${req.employee?.full_name || 'the employee'}`}
                  placeholder={`Note to ${first}, included in the email`}
                  value={reviewNotes[req.id] || ''}
                  onChange={e => setReviewNotes(prev => ({ ...prev, [req.id]: e.target.value }))} />
              ) : (
                <button type="button" className="il-link-subtle" onClick={() => setNoteOpen(prev => ({ ...prev, [req.id]: true }))}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', fontSize: 'var(--text-sm)', color: T.brand }}>
                  Add a note for {first}
                </button>
              )}
            </div>
            {isMobile && actions}
          </div>
          {!isMobile && actions}
        </div>
      </article>
    )
  }

  // A request that's been decided: one quiet line, and Cancel while approved
  // time off is still ahead. What the employee wrote (note, flexibility,
  // volunteering) stays one click away under "Details".
  function renderDecidedRow(req) {
    const verb = req.status === TIME_OFF_STATUS.APPROVED ? 'Approved' : req.status === TIME_OFF_STATUS.DENIED ? 'Denied' : null
    const by = verb && req.reviewer?.full_name ? `${verb} by ${req.reviewer.full_name.split(' ')[0]}` : null
    const details = detailsLine(req)
    const open = Boolean(detailsOpen[req.id])
    return (
      <div key={req.id} style={{ borderBottom: `1px solid ${T.borderSubtle}`, background: open ? T.surfaceSunken : 'transparent' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px' }}>
        <Avatar name={req.employee?.full_name} colorKey={req.employee?.email} size={28} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, color: T.text, fontSize: 'var(--text-base)' }}>{req.employee?.full_name || '?'}</div>
          <div style={{ fontSize: 'var(--text-sm)', color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isMobile ? 'normal' : 'nowrap' }}>
            {[fmtDateRange(req.start_date, req.end_date), TYPE_LABELS[req.type] || req.type, formatDays(req.business_days), by].filter(Boolean).join(' · ')}
            {req.review_notes && <span style={{ color: T.subtle }}> · “{req.review_notes}”</span>}
          </div>
          {isMobile && <div style={{ marginTop: '6px' }}><StatusPill status={req.status} /></div>}
        </div>
        {details && (
          <button type="button" className="il-link-subtle" aria-expanded={open}
            onClick={() => setDetailsOpen(prev => ({ ...prev, [req.id]: !prev[req.id] }))}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', fontSize: 'var(--text-sm)', color: T.brand, flexShrink: 0 }}>
            {open ? 'Hide details' : 'Details'}
          </button>
        )}
        {!isMobile && <StatusPill status={req.status} />}
        <div style={{ width: isMobile ? 'auto' : '64px', textAlign: 'right' }}>{canHrCancel(req) && cancelButton(req)}</div>
      </div>
      {open && details && <div style={{ padding: isMobile ? '0 16px 12px' : '0 16px 12px 56px' }}>{details}</div>}
      </div>
    )
  }

  // ── Balances: derived rows for the chosen year ──
  const balY = String(balYear)
  const balanceRows = employees
    .filter(takesTimeOff)
    .filter(e => !balSearch || e.full_name.toLowerCase().includes(balSearch.toLowerCase()) || (e.email || '').toLowerCase().includes(balSearch.toLowerCase()))
    .map(emp => {
      const bal = balanceIndex[emp.id]?.[balY] || null
      const empReqs = requestsByEmployee[emp.id] || []
      return {
        employee: emp,
        balance: bal,
        vac: summarizeYear(bal, empReqs, balYear, { bucket: 'vacation' }),
        care: summarizeYear(bal, empReqs, balYear, { bucket: 'care' }),
        requests: empReqs.filter(r => Number(yearSplitOf(r)[balY]) > 0 || r.start_date.startsWith(balY)).sort((a, b) => (a.start_date < b.start_date ? 1 : -1)),
      }
    })
  const missingCount = employees.filter(e => takesTimeOff(e) && hasNoEntitlement(balanceIndex[e.id]?.[balY])).length
  const notTracked = employees.filter(e => !takesTimeOff(e))
  const prevYearCount = allBalances.filter(b => Number(b.year) === balYear - 1).length

  // People and holidays for the calendar's branch. Someone with no branch set
  // counts as Halifax, as the day counts do.
  const calProvince = calBranch ? branchProvince(calBranch) : null
  const calRequests = calBranch ? requests.filter(r => (r.employee?.branch || 'halifax') === calBranch) : requests
  const calHolidays = calProvince ? holidays.filter(h => !h.province || h.province === calProvince) : holidays
  const holidaysOn = iso => groupHolidays(calHolidays.filter(h => holidayOn(h, iso)))
  const holidayLabel = g => g.everywhere || calProvince ? g.name : `${g.name} (${g.provinces.join(', ')})`

  async function copyWeek(monday, entries, weekHols, showBranch) {
    const ok = await copyRich(weekEmail(monday, entries, { holidays: weekHols, showBranch }))
    if (!ok) { showToast("Your browser wouldn't allow copying. Select the list and copy it instead.", 'error'); return }
    setCopiedWeek(monday)
    showToast('Copied. Paste it into your email.')
    setTimeout(() => setCopiedWeek(c => (c === monday ? null : c)), 2500)
  }

  const pendingCount = requests.filter(r => r.status === TIME_OFF_STATUS.PENDING).length
  const skeletonCards = [1, 2, 3].map(i => (
    <div key={i} style={{ ...s.card, padding: '16px', marginBottom: '10px' }}><SkeletonLine width={`${40 + i * 10}%`} height="13px" /></div>
  ))

  return (
    <Layout session={session} userProfile={userProfile} currentPage="time-off" onNavigate={onNavigate}>
      <PageHeader
        title="Time off"
        subtitle={isMobile ? null : 'Review requests, set yearly allowances and see who’s away.'}
        actions={<Button size="sm" variant="secondary" onClick={() => setLogForm({ ...EMPTY_LOG })}>Log time off</Button>}
        tabs={{
          mode: 'tabs', label: 'Time off views', value: subView, onChange: setSubView,
          items: [
            { id: 'requests', label: 'Requests', badge: pendingCount || null },
            { id: 'calendar', label: "Who's off" },
            { id: 'balances', label: 'Balances' },
            { id: 'holidays', label: 'Holidays' },
          ],
        }}
      />

      <div style={s.page} role="tabpanel" aria-label={subView}>
        {/* ── REQUESTS ── */}
        {subView === 'requests' && (() => {
          const pending = requests.filter(r => r.status === TIME_OFF_STATUS.PENDING).sort((a, b) => (a.start_date < b.start_date ? -1 : 1))
          const decidedAll = requests.filter(r => r.status !== TIME_OFF_STATUS.PENDING)
          const decided = decidedAll
            .filter(r => filterStatus === 'all' || r.status === filterStatus)
            .filter(r => !filterEmployee || r.employee_id === filterEmployee)
            .sort((a, b) => (a.start_date < b.start_date ? 1 : -1))
          const shown = decided.slice(0, decidedLimit)
          return (
            <>
              <section aria-labelledby="il-waiting">
                <h2 id="il-waiting" className="il-section-title" style={{ marginBottom: '12px' }}>
                  Waiting for you{!loading && pending.length > 0 && <span style={{ color: T.muted, fontWeight: 500 }}> · {pending.length}</span>}
                </h2>
                {loading ? skeletonCards : pending.length === 0 ? (
                  <div style={{ ...s.card, padding: '18px 20px', color: T.muted, fontSize: 'var(--text-base)' }}>
                    You're all caught up. New requests will appear here, and you'll get an email when one comes in.
                  </div>
                ) : pending.map(renderPendingCard)}
              </section>

              {!loading && decidedAll.length > 0 && (
                <section aria-labelledby="il-decided" style={{ marginTop: '36px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                    <h2 id="il-decided" className="il-section-title" style={{ marginRight: 'auto' }}>Decided</h2>
                    <select className="il-input" aria-label="Show" style={{ width: 'auto', padding: '5px 30px 5px 10px', fontSize: 'var(--text-sm)' }} value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setDecidedLimit(20) }}>
                      <option value="all">All decisions</option>
                      <option value={TIME_OFF_STATUS.APPROVED}>Approved</option>
                      <option value={TIME_OFF_STATUS.DENIED}>Denied</option>
                      <option value={TIME_OFF_STATUS.CANCELLED}>Cancelled</option>
                    </select>
                    <select className="il-input" aria-label="Person" style={{ width: 'auto', maxWidth: '200px', padding: '5px 30px 5px 10px', fontSize: 'var(--text-sm)' }} value={filterEmployee} onChange={e => { setFilterEmployee(e.target.value); setDecidedLimit(20) }}>
                      <option value="">Everyone</option>
                      {allEmployees.map(emp => <option key={emp.id} value={emp.id}>{emp.full_name}</option>)}
                    </select>
                  </div>
                  <div style={{ ...s.card, overflow: 'hidden' }}>
                    {shown.length === 0
                      ? <div style={{ padding: '16px', fontSize: 'var(--text-sm)', color: T.muted }}>Nothing matches. <button type="button" className="il-link-subtle" onClick={() => { setFilterStatus('all'); setFilterEmployee('') }} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: T.brand }}>Show everything</button></div>
                      : shown.map(renderDecidedRow)}
                  </div>
                  {decided.length > shown.length && (
                    <Button size="sm" variant="ghost" style={{ marginTop: '8px' }} onClick={() => setDecidedLimit(n => n + 20)}>Show more</Button>
                  )}
                </section>
              )}
            </>
          )
        })()}

        {/* ── BALANCES ── */}
        {subView === 'balances' && (
          <>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '14px' }}>
              <Segmented size="sm" label="Balance year" value={balYear} onChange={y => { setBalYear(y); setEditing(null); setExpandedEmployeeId(null); setBulkOpen(false) }}
                options={[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map(y => ({ value: y, label: String(y) }))} />
              <div style={{ flex: isMobile ? '1 1 100%' : '0 1 260px', minWidth: 0, order: isMobile ? 3 : 0 }}>
                <SearchInput value={balSearch} onChange={setBalSearch} placeholder="Find a person…" label="Find a person" />
              </div>
              <div style={{ marginLeft: 'auto' }}>
                <Menu label="Yearly set-up" triggerLabel="Set up a year" items={[
                  { label: 'Import HR list', hint: "Each person's start date and allowances, from Excel", onClick: () => { setImportYear(balYear); setImportOpen(true) } },
                  { label: `Copy ${balYear - 1} into ${balYear}`, hint: prevYearCount > 0 ? 'Same allowances as last year' : `No ${balYear - 1} allowances to copy`, disabled: prevYearCount === 0, onClick: () => setStartYearOpen(true) },
                ]} />
              </div>
            </div>

            {!loading && missingCount > 0 && (
              <div style={{ fontSize: 'var(--text-sm)', color: T.muted, margin: '0 2px 14px' }}>
                {!bulkOpen ? (
                  <>
                    {missingCount} {missingCount === 1 ? 'person has' : 'people have'} no {balYear} allowance yet.{' '}
                    <button type="button" className="il-link-subtle" onClick={() => setBulkOpen(true)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: T.brand }}>
                      Set one for all of them
                    </button>
                  </>
                ) : (
                  <form onSubmit={e => { e.preventDefault(); applyBulkEntitlement() }} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span>Give the {missingCount} {missingCount === 1 ? 'person' : 'people'} without a {balYear} allowance</span>
                    <input className="il-input il-tabular" type="number" min="0" step="0.5" aria-label="Vacation days" autoFocus
                      style={{ width: '64px', padding: '4px 8px' }} value={bulkDays} onChange={e => setBulkDays(e.target.value)} placeholder="0" />
                    <span>vacation and</span>
                    <input className="il-input il-tabular" type="number" min="0" step="0.5" aria-label="Care days"
                      style={{ width: '64px', padding: '4px 8px' }} value={bulkCare} onChange={e => setBulkCare(e.target.value)} placeholder="0" />
                    <span>care days</span>
                    <Button size="xs" type="submit" busy={bulkSaving} busyLabel="Saving…" disabled={!bulkDays && !bulkCare}>Apply</Button>
                    <Button size="xs" variant="ghost" onClick={() => setBulkOpen(false)}>Cancel</Button>
                  </form>
                )}
              </div>
            )}

            {loading ? skeletonCards : balanceRows.length === 0 ? (
              <div style={s.card}><EmptyState icon={EmptyIcons.people} title={employees.length ? 'Nobody matches' : 'No employees yet'} message={employees.length ? 'Try a different name.' : 'Balances appear once employees are added.'} /></div>
            ) : (
              <div style={{ ...s.card, overflow: 'hidden' }}>
                {!isMobile && (
                  <div style={s.tHead(BAL_COLS)}>
                    <div>Employee</div>
                    <div title="Personal / Vacation days">Vacation</div>
                    <div>Care days</div>
                    <div></div>
                  </div>
                )}
                {balanceRows.map(row => {
                  const { vac, care } = row
                  const isEditing = editing?.employeeId === row.employee.id
                  const isExpanded = expandedEmployeeId === row.employee.id
                  const notSet = hasNoEntitlement(row.balance)
                  const subtitle = [
                    row.employee.branch ? branchName(row.employee.branch) : null,
                    row.employee.hire_date ? `Started ${formatDate(row.employee.hire_date, { month: 'short', year: 'numeric' })}` : null,
                  ].filter(Boolean).join(' · ') || row.employee.email
                  const nameButton = (
                    <button type="button" aria-expanded={isExpanded} onClick={() => setExpandedEmployeeId(isExpanded ? null : row.employee.id)}
                      title={isExpanded ? 'Hide requests' : `Show ${balYear} requests`}
                      style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
                      <Avatar name={row.employee.full_name} colorKey={row.employee.email} size={30} />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontWeight: 500, color: T.text }}>{row.employee.full_name}</span>
                        <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: T.subtle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</span>
                      </span>
                    </button>
                  )
                  const editButton = (
                    <Button size="xs" variant={notSet ? 'secondary' : 'ghost'}
                      onClick={() => setEditing({
                        employeeId: row.employee.id,
                        vacation: String(vac.entitlement), vacationUsed: String(vac.used),
                        care: String(care.entitlement), careUsed: String(care.used),
                        branch: row.employee.branch || '', startDate: row.employee.hire_date || '',
                      })}
                      aria-label={`Edit ${row.employee.full_name}'s ${balYear} balance`}>{notSet ? 'Set' : 'Edit'}</Button>
                  )
                  // "7 left of 15", with used and pending underneath.
                  const cell = sum => notSet ? <span style={{ color: T.subtle, fontSize: 'var(--text-sm)' }}>Not set</span> : (
                    <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.3 }}>
                      <span className="il-tabular">
                        <strong style={{ fontWeight: 600, fontSize: 'var(--text-md)', color: sum.remaining < 0 ? T.danger : T.text }}>
                          {formatDays(Math.abs(sum.remaining)).slice(0, -1)}{sum.remaining < 0 ? ' over' : ''}
                        </strong>
                        <span style={{ color: T.muted, fontSize: 'var(--text-sm)' }}>{sum.remaining < 0 ? ' · ' : ' left of '}{sum.remaining < 0 ? `${formatDays(sum.entitlement).slice(0, -1)} allowed` : formatDays(sum.entitlement).slice(0, -1)}</span>
                      </span>
                      {(sum.used > 0 || sum.pending > 0) && (
                        <span className="il-tabular" style={{ fontSize: 'var(--text-xs)', color: T.subtle }}>
                          {[sum.used > 0 ? `${formatDays(sum.used).slice(0, -1)} used` : null, sum.pending > 0 ? `${formatDays(sum.pending).slice(0, -1)} pending` : null].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </span>
                  )
                  const editForm = isEditing && (
                    <form onSubmit={e => { e.preventDefault(); saveBalance(row) }}
                      style={{ padding: isMobile ? '0 16px 16px' : '4px 16px 16px 56px', display: 'grid', gap: '12px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 130px)', gap: '10px' }}>
                        {[['vacation', `${balYear} vacation`], ['vacationUsed', 'Vacation used'], ['care', `${balYear} care days`], ['careUsed', 'Care days used']].map(([key, label]) => (
                          <label key={key} style={{ display: 'grid', gap: '4px', fontSize: 'var(--text-xs)', color: T.muted, fontWeight: 500 }}>
                            {label}
                            <input className="il-input il-tabular" type="number" min="0" step="0.5" autoFocus={key === 'vacation'}
                              style={{ padding: '5px 8px' }} value={editing[key]}
                              onChange={e => setEditing(prev => ({ ...prev, [key]: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Escape') setEditing(null) }} />
                          </label>
                        ))}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '170px 150px', gap: '10px' }}>
                        <label style={{ display: 'grid', gap: '4px', fontSize: 'var(--text-xs)', color: T.muted, fontWeight: 500 }}>
                          Branch
                          <select className="il-input" style={{ padding: '5px 8px' }} value={editing.branch} onChange={e => setEditing(prev => ({ ...prev, branch: e.target.value }))}>
                            <option value="">Not set (Halifax holidays)</option>
                            {BRANCHES.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
                          </select>
                        </label>
                        <label style={{ display: 'grid', gap: '4px', fontSize: 'var(--text-xs)', color: T.muted, fontWeight: 500 }}>
                          Start date
                          <input className="il-input" type="date" style={{ padding: '5px 8px' }} value={editing.startDate} onChange={e => setEditing(prev => ({ ...prev, startDate: e.target.value }))} />
                        </label>
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: T.subtle, lineHeight: 1.5, maxWidth: '560px' }}>
                        Approvals add to Used on their own. Only change Used to record days taken before this system, or to fix a mistake.
                      </div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <Button size="xs" type="submit" busy={savingBalance} busyLabel="Saving…">Save</Button>
                        <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                        <Button size="xs" variant="ghost" style={{ marginLeft: 'auto', color: T.muted }} disabled={savingBalance}
                          onClick={() => setTakesTimeOff(row.employee, false)}
                          title="For partners, casual staff without vacation, or someone who has left">
                          Doesn't take time off
                        </Button>
                      </div>
                    </form>
                  )

                  return (
                    <div key={row.employee.id} style={{ borderBottom: `1px solid ${T.borderSubtle}`, background: isExpanded || isEditing ? T.surfaceSunken : 'transparent' }}>
                      {isMobile ? (
                        <div style={{ padding: '14px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px' }}>
                            {nameButton}
                            {!isEditing && editButton}
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', paddingLeft: '40px' }}>
                            <div><div style={{ fontSize: 'var(--text-xs)', color: T.subtle, marginBottom: '2px' }}>Vacation</div>{cell(vac)}</div>
                            <div><div style={{ fontSize: 'var(--text-xs)', color: T.subtle, marginBottom: '2px' }}>Care days</div>{cell(care)}</div>
                          </div>
                        </div>
                      ) : (
                        <div style={{ ...s.tRow(BAL_COLS), borderBottom: 'none' }}>
                          <div style={{ minWidth: 0 }}>{nameButton}</div>
                          <div>{cell(vac)}</div>
                          <div>{cell(care)}</div>
                          <div style={{ textAlign: 'right' }}>{!isEditing && editButton}</div>
                        </div>
                      )}
                      {editForm}
                      {isExpanded && (
                        <div style={{ borderTop: `1px solid ${T.borderSubtle}` }}>
                          {row.requests.length === 0 ? (
                            <div style={{ padding: isMobile ? '12px 16px' : '12px 16px 12px 56px', fontSize: 'var(--text-sm)', color: T.subtle }}>No requests in {balYear}.</div>
                          ) : row.requests.map(req => (
                            <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: isMobile ? '10px 16px' : '10px 16px 10px 56px', borderBottom: `1px solid ${T.borderSubtle}`, fontSize: 'var(--text-sm)', color: T.muted }}>
                              <span style={{ flex: 1, minWidth: 0 }}>{fmtDateRange(req.start_date, req.end_date)} · {TYPE_LABELS[req.type] || req.type} · {formatDays(req.business_days)}</span>
                              <StatusPill status={req.status} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {!loading && notTracked.length > 0 && (
              <details style={{ marginTop: '14px' }}>
                <summary style={{ cursor: 'pointer', fontSize: 'var(--text-sm)', color: T.muted, padding: '4px 2px' }}>
                  Not tracked ({notTracked.length}): partners, casual staff and people who have left
                </summary>
                <div style={{ ...s.card, overflow: 'hidden', marginTop: '8px' }}>
                  {notTracked.map(emp => (
                    <div key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderBottom: `1px solid ${T.borderSubtle}` }}>
                      <Avatar name={emp.full_name} colorKey={emp.email} size={28} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-base)', color: T.text }}>{emp.full_name}</span>
                      <Button size="xs" variant="secondary" onClick={() => setTakesTimeOff(emp, true)}>Track time off</Button>
                    </div>
                  ))}
                </div>
              </details>
            )}
            <p style={{ fontSize: 'var(--text-xs)', color: T.subtle, margin: '12px 2px 0', lineHeight: 1.6, maxWidth: '720px' }}>
              "Left" counts pending requests as if they're approved. Personal / Vacation requests use Vacation; Care Day requests use Care days; other leave doesn't use either. Unused days don't carry over.
            </p>
          </>
        )}

        {/* ── WHO'S OFF (calendar + weekly list) ── */}
        {subView === 'calendar' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
              <Button size="sm" variant="secondary" onClick={prevMonth} aria-label="Previous month">‹</Button>
              <h2 aria-live="polite" className="il-section-title" style={{ minWidth: isMobile ? '140px' : '170px', textAlign: 'center' }}>
                {MONTH_NAMES[calMonth]} {calYear}
              </h2>
              <Button size="sm" variant="secondary" onClick={nextMonth} aria-label="Next month">›</Button>
              <Button size="sm" variant="ghost" onClick={() => { setCalYear(new Date().getFullYear()); setCalMonth(new Date().getMonth()) }}>Today</Button>
              <select className="il-input" aria-label="Show branch" style={{ width: 'auto', padding: '5px 30px 5px 10px', fontSize: 'var(--text-sm)', marginLeft: isMobile ? 0 : 'auto' }} value={calBranch} onChange={e => setCalBranch(e.target.value)}>
                <option value="">All branches</option>
                {BRANCHES.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
              </select>
            </div>

            <div style={{ overflowX: isMobile ? 'auto' : 'visible', WebkitOverflowScrolling: 'touch' }}>
              <div style={{ ...s.card, overflow: 'hidden', minWidth: isMobile ? '560px' : 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: `1px solid ${T.border}`, background: T.surfaceSunken }}>
                  {DOW_LABELS.map((d, i) => (
                    <div key={d} style={{ padding: isMobile ? '7px 4px' : '9px 10px', fontSize: 'var(--text-xs)', fontWeight: 600, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.4px', textAlign: 'center', borderRight: i < 6 ? `1px solid ${T.borderSubtle}` : 'none' }}>
                      {isMobile ? d.slice(0, 1) : d}
                    </div>
                  ))}
                </div>

                {loading ? (
                  <div style={{ padding: '24px' }}><SkeletonLine width="100%" height="320px" /></div>
                ) : (() => {
                  const cells = buildCalendarDays(calYear, calMonth)
                  const weeks = []
                  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

                  return weeks.map((week, wi) => {
                    const weekDates = week.map(day => day ? `${calYear}-${pad(calMonth + 1)}-${pad(day)}` : null)
                    const { assignments, trackCount } = getWeekEventLayout(weekDates, calRequests)
                    const eventsH = Math.max(WEEK_MIN_EVENTS_H, trackCount * SLOT_H + 10)
                    const weekHolidays = weekDates.map(d => (d ? holidaysOn(d) : []))
                    const cellBg = (day, di) => !day || di === 0 || di === 6 ? T.surfaceSunken : weekHolidays[di].length ? T.brandLight : T.surface

                    return (
                      <div key={wi} style={{ borderBottom: wi < weeks.length - 1 ? `1px solid ${T.border}` : 'none' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                          {week.map((day, di) => {
                            const isToday = weekDates[di] === TODAY
                            const isWeekend = di === 0 || di === 6
                            const hols = weekHolidays[di]
                            const holTitle = hols.map(g => `${holidayLabel(g)}${g.note ? `. ${g.note}` : ''}`).join('\n')
                            return (
                              <div key={di} title={holTitle || undefined} style={{ height: DATE_ROW_H, padding: '7px 9px 0', display: 'flex', justifyContent: 'space-between', gap: '4px', alignItems: 'flex-start', background: cellBg(day, di), borderRight: di < 6 ? `1px solid ${T.borderSubtle}` : 'none', minWidth: 0 }}>
                                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: T.brandStrong, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, lineHeight: '20px' }}>
                                  {hols.length > 0 && <span aria-hidden="true">{isMobile ? '•' : `${holidayLabel(hols[0])}${hols.length > 1 ? ` +${hols.length - 1}` : ''}`}</span>}
                                  {hols.length > 0 && <span className="il-visually-hidden">{`, holiday: ${hols.map(holidayLabel).join(', ')}`}</span>}
                                </span>
                                {day && (isToday ? (
                                  <span aria-label={`${day}, today`} style={{ background: T.brand, color: T.onAccent, borderRadius: '50%', width: '22px', height: '22px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--text-xs)', fontWeight: 700, flexShrink: 0 }}>
                                    {day}
                                  </span>
                                ) : (
                                  <span className="il-tabular" style={{ fontSize: 'var(--text-sm)', lineHeight: '20px', color: isWeekend ? T.subtle : T.muted }}>{day}</span>
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
                            const lOff = startsThisWeek ? 3 : 0
                            const rOff = endsThisWeek ? 3 : 0
                            const label = `${req.employee?.full_name || 'Someone'}: ${TYPE_LABELS[req.type] || req.type}${isPending ? ' (pending)' : ''}, ${fmtDateRange(req.start_date, req.end_date)}, ${req.business_days} days`
                            return (
                              <div
                                key={`${req.id}-${wi}`}
                                title={label}
                                aria-label={label}
                                role="img"
                                style={{
                                  position: 'absolute',
                                  top: track * SLOT_H + 6,
                                  left: `calc(${startCol * colPct}% + ${lOff}px)`,
                                  width: `calc(${(endCol - startCol + 1) * colPct}% - ${lOff + rOff}px)`,
                                  height: EVENT_H,
                                  ...eventColors(avatarHue(req.employee?.email || req.employee?.full_name), isPending),
                                  fontSize: 'var(--text-xs)', fontWeight: 600,
                                  display: 'flex', alignItems: 'center', paddingLeft: '8px',
                                  overflow: 'hidden', whiteSpace: 'nowrap',
                                  borderRadius: `${startsThisWeek ? 4 : 0}px ${endsThisWeek ? 4 : 0}px ${endsThisWeek ? 4 : 0}px ${startsThisWeek ? 4 : 0}px`,
                                  zIndex: 1,
                                }}
                              >
                                {firstName}{isPending ? ' (pending)' : ''}
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
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center', fontSize: 'var(--text-xs)', color: T.muted, margin: '10px 2px 0' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span aria-hidden="true" style={{ width: '20px', height: '10px', borderRadius: '3px', ...eventColors(avatarHue('legend'), false) }} />Approved
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span aria-hidden="true" style={{ width: '20px', height: '10px', borderRadius: '3px', ...eventColors(avatarHue('legend'), true) }} />Pending
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span aria-hidden="true" style={{ width: '10px', height: '10px', borderRadius: '3px', background: T.brandLight, border: `1px solid ${T.border}` }} />Holiday
              </span>
              <span>Each person keeps their own colour.</span>
            </div>

            {/* Who's off, week by week: the list HR emails to managers. */}
            {!loading && (
              <section aria-labelledby="il-weekly" style={{ marginTop: '36px', maxWidth: '760px' }}>
                <h2 id="il-weekly" className="il-section-title">Who's off, week by week</h2>
                <p style={{ fontSize: 'var(--text-sm)', color: T.muted, margin: '4px 0 14px', lineHeight: 1.5 }}>
                  Approved time off{calBranch ? ` in ${branchName(calBranch)}` : ''}, Monday to Friday. Use “Copy for email” and paste it straight into a message to managers.
                </p>
                <div style={{ display: 'grid', gap: '10px' }}>
                  {weeksOfMonth(calYear, calMonth).map(w => {
                    const entries = peopleOffInWeek(calRequests, w.monday, w.friday)
                    const waiting = peopleOffInWeek(calRequests, w.monday, w.friday, { includePending: true }).length - entries.length
                    const weekHols = []
                    for (let i = 0; i < 5; i++) {
                      const d = addDaysIso(w.monday, i)
                      holidaysOn(d).forEach(g => weekHols.push({ date: d, name: holidayLabel(g) }))
                    }
                    const showBranch = !calBranch && new Set(entries.map(e => e.branch || 'halifax')).size > 1
                    const thisMonday = mondayOf(TODAY)
                    const tag = w.monday === thisMonday ? 'This week' : w.monday === addDaysIso(thisMonday, 7) ? 'Next week' : null
                    const copied = copiedWeek === w.monday
                    return (
                      <div key={w.monday} style={{ ...s.card, padding: isMobile ? '14px 16px' : '16px 20px', ...(tag === 'This week' ? { borderColor: T.brand } : {}), ...(w.friday < TODAY ? { opacity: 0.6 } : {}) }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                          <h3 style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 600, color: T.text }}>{weekTitle(w.monday)}</h3>
                          {tag && <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, padding: '1px 7px', borderRadius: T.radiusSm, background: T.brandLight, color: T.brandStrong }}>{tag}</span>}
                          <Button size="xs" variant={copied ? 'ghost' : 'secondary'} style={{ marginLeft: 'auto' }}
                            onClick={() => copyWeek(w.monday, entries, weekHols, showBranch)}>
                            {copied ? 'Copied' : 'Copy for email'}
                          </Button>
                        </div>
                        {entries.length === 0 ? (
                          <div style={{ fontSize: 'var(--text-sm)', color: T.subtle, marginTop: '8px' }}>Nobody is booked off.</div>
                        ) : (
                          <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: '8px' }}>
                            {entries.map(e => (
                              <li key={`${e.id}-${e.from}`} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: 'var(--text-base)' }}>
                                <Avatar name={e.name} colorKey={e.email} size={24} />
                                <span style={{ fontWeight: 500, color: T.text }}>{e.name}</span>
                                {showBranch && <span style={{ fontSize: 'var(--text-xs)', color: T.subtle }}>{branchName(e.branch || 'halifax')}</span>}
                                <span style={{ color: T.muted, marginLeft: 'auto', textAlign: 'right' }}>{describeDays(e)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {(weekHols.length > 0 || waiting > 0) && (
                          <div style={{ display: 'flex', gap: '4px 16px', flexWrap: 'wrap', fontSize: 'var(--text-xs)', color: T.subtle, marginTop: '10px' }}>
                            {weekHols.length > 0 && <span>Holiday: {weekHols.map(h => `${h.name}, ${formatDate(h.date, { weekday: 'short', month: 'short', day: 'numeric' })}`).join('; ')}</span>}
                            {waiting > 0 && (
                              <button type="button" className="il-link-subtle" onClick={() => setSubView('requests')}
                                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: T.warning }}>
                                {waiting} pending request{waiting === 1 ? '' : 's'} not included yet
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )}
          </div>
        )}

        {/* ── HOLIDAYS ── */}
        {subView === 'holidays' && (() => {
          const years = [...new Set([CURRENT_YEAR, CURRENT_YEAR + 1, ...holidays.filter(h => !h.repeats_yearly).map(h => Number(h.date.slice(0, 4)))])]
            .filter(y => y >= CURRENT_YEAR - 1).sort((x, y) => x - y)
          // A repeating holiday is shown on its date in the chosen year.
          const yearGroups = groupHolidays(holidays
            .filter(h => h.repeats_yearly || h.date.startsWith(String(holidayYear)))
            .map(h => (h.repeats_yearly ? { ...h, date: `${holidayYear}${h.date.slice(4)}` } : h)))
          const hasHandbookYear = holidays.some(h => h.kind !== 'company' && h.date.startsWith(String(holidayYear)))
          const HOL_COLS = 'minmax(0, 1fr) 130px minmax(0, 1.2fr) 90px'
          const provinceChips = g => g.everywhere && !Object.keys(g.kinds).length
            ? <span style={{ fontSize: 'var(--text-sm)', color: T.muted }}>All branches</span>
            : (
              <span style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {g.provinces.map(code => (
                  <span key={code} title={`${PROVINCES.find(p => p.code === code)?.branches}: ${KIND_LABEL[g.kinds[code]] || ''}`}
                    style={{ fontSize: 'var(--text-xs)', fontWeight: 600, padding: '1px 6px', borderRadius: T.radiusSm, whiteSpace: 'nowrap',
                      ...(g.kinds[code] === 'statutory' ? { background: T.brandLight, color: T.brandStrong } : { border: `1px solid ${T.border}`, color: T.muted }) }}>
                    {code}{g.kinds[code] === 'statutory' ? ' · Stat' : g.kinds[code] === 'observed' ? ' · Obs' : ''}
                  </span>
                ))}
              </span>
            )
          return (
            <div style={{ display: 'grid', gap: '14px', maxWidth: '860px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <Segmented size="sm" label="Holiday year" value={holidayYear} onChange={setHolidayYear}
                  options={years.map(y => ({ value: y, label: String(y) }))} />
                {!holidaysLoading && !hasHandbookYear && (
                  <Button size="sm" variant="secondary" busy={addingYear} busyLabel="Adding…" onClick={() => addYearHolidays(holidayYear)}>
                    Add {holidayYear}'s handbook holidays
                  </Button>
                )}
                <Button size="sm" variant="secondary" style={{ marginLeft: 'auto' }} onClick={() => setHolidayFormOpen(true)}>Add a holiday</Button>
              </div>

              <div style={{ ...s.card, overflow: 'hidden' }}>
                {holidaysLoading ? (
                  [1, 2, 3].map(i => <div key={i} style={{ padding: '16px', borderBottom: `1px solid ${T.borderSubtle}` }}><SkeletonLine width="50%" height="13px" /></div>)
                ) : yearGroups.length === 0 ? (
                  <EmptyState icon={EmptyIcons.calendar} title={`No ${holidayYear} holidays yet`}
                    message="Add this year's handbook holidays with the button above. They're worked out for each province, including the ones that move, like Easter and Natal Day." />
                ) : (
                  <>
                    {!isMobile && (
                      <div style={s.tHead(HOL_COLS)}>
                        <div>Holiday</div><div>Date</div><div>Branches</div><div></div>
                      </div>
                    )}
                    {yearGroups.map(g => (
                      <div key={g.key} className="il-task-row" style={isMobile
                        ? { display: 'grid', gap: '6px', padding: '13px 16px', borderBottom: `1px solid ${T.borderSubtle}` }
                        : { ...s.tRow(HOL_COLS), opacity: g.date < TODAY ? 0.6 : 1 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 500, color: T.text }}>{g.name}</div>
                          {(g.note || g.repeats || isMobile) && (
                            <div style={{ fontSize: 'var(--text-xs)', color: T.subtle, marginTop: '2px', lineHeight: 1.4 }}>
                              {[isMobile ? formatDate(g.date, { weekday: 'short', month: 'short', day: 'numeric' }) : null, g.repeats ? 'Every year' : null, g.note].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </div>
                        {!isMobile && <div style={{ color: T.muted, fontSize: 'var(--text-sm)' }}>{formatDate(g.date, { weekday: 'short', month: 'short', day: 'numeric' })}</div>}
                        <div>{provinceChips(g)}</div>
                        <div style={{ textAlign: isMobile ? 'left' : 'right' }}>
                          <span className="il-row-actions">
                            <Button size="xs" variant="ghost" style={{ color: T.danger }} busy={deletingHolidayKey === g.key} busyLabel="…" onClick={() => deleteHoliday(g)} aria-label={`Remove ${g.name}`}>Remove</Button>
                          </span>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
              <p style={{ fontSize: 'var(--text-xs)', color: T.subtle, margin: '0 2px', lineHeight: 1.6 }}>
                NS is Halifax, NB is Moncton and Saint John, NL is St. John's, PE is Charlottetown. Stat is a statutory holiday and Obs an observed one, as in the handbook. A fixed-date holiday on a weekend is given the Monday after. Regatta Day depends on the weather: if it moves, change it here. Changing holidays recounts pending requests.
              </p>
            </div>
          )
        })()}
      </div>

      {confirmCancel && (
        <ConfirmModal
          title={`Cancel ${confirmCancel.employee?.full_name?.split(' ')[0] || 'this'}'s time off?`}
          message={`${fmtDateRange(confirmCancel.start_date, confirmCancel.end_date)}, ${TYPE_LABELS[confirmCancel.type] || confirmCancel.type}.${balanceBucket(confirmCancel.type) ? ` ${formatDays(confirmCancel.business_days)} go back into their ${BUCKETS[balanceBucket(confirmCancel.type)].short}.` : ''} They'll get an email.`}
          confirmLabel="Cancel time off"
          confirmDanger
          onConfirm={() => adminCancel(confirmCancel)}
          onCancel={() => setConfirmCancel(null)}
        />
      )}

      {denyReq && (() => {
        const first = denyReq.employee?.full_name?.split(' ')[0] || 'them'
        const busy = reviewingId === denyReq.id
        return (
          <Modal
            title={`Deny ${first}'s request?`}
            description={`${fmtDateRange(denyReq.start_date, denyReq.end_date)}, ${TYPE_LABELS[denyReq.type] || denyReq.type}. A denied request can't be reopened; ${first} would need to send a new one.`}
            onClose={() => setDenyReq(null)}
            busy={busy}
            maxWidth={460}
            footer={(
              <>
                <Button variant="secondary" onClick={() => setDenyReq(null)} disabled={busy}>Back</Button>
                <Button variant="danger" busy={busy} busyLabel="Denying…" onClick={() => denyRequest(denyReq)}>Deny request</Button>
              </>
            )}
          >
            <Field label={`Tell ${first} why`} optional hint={`${first} sees this with the decision.`}>
              <textarea rows={3} style={{ resize: 'vertical' }} placeholder="e.g. Two people on the desk are already off that week."
                value={reviewNotes[denyReq.id] || ''}
                onChange={e => setReviewNotes(prev => ({ ...prev, [denyReq.id]: e.target.value }))} />
            </Field>
          </Modal>
        )
      })()}

      {startYearOpen && (
        <Modal
          title={`Copy ${balYear - 1} into ${balYear}`}
          description={`Gives each person the same Personal / Vacation and Care day allowances in ${balYear} as they had in ${balYear - 1}, starting with nothing used. Unused days don't carry over. Anyone who already has a ${balYear} allowance keeps it.`}
          onClose={() => setStartYearOpen(false)}
          maxWidth={460}
          footer={(
            <>
              <Button variant="secondary" onClick={() => setStartYearOpen(false)}>Close</Button>
              <Button onClick={startYear}>Copy into {balYear}</Button>
            </>
          )}
        >
          <p style={{ fontSize: 'var(--text-sm)', color: T.muted, margin: 0, lineHeight: 1.55 }}>
            If HR has sent next year's list, use Import HR list instead: it sets each person's own numbers.
          </p>
        </Modal>
      )}

      {holidayFormOpen && (
        <Modal
          title="Add a holiday"
          description="For anything beyond the handbook list, like an extra day the office closes. It's skipped when business days are counted, for the branches it applies to."
          onClose={() => setHolidayFormOpen(false)}
          busy={savingHoliday}
          maxWidth={520}
          footer={(
            <>
              <Button variant="secondary" onClick={() => setHolidayFormOpen(false)} disabled={savingHoliday}>Cancel</Button>
              <Button busy={savingHoliday} busyLabel="Adding…" disabled={!newHolidayName.trim() || !newHolidayDate || newHolidayProvinces.length === 0}
                onClick={async () => { if (await addHoliday()) setHolidayFormOpen(false) }}>Add holiday</Button>
            </>
          )}
        >
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) 170px', gap: '0 12px' }}>
            <Field label="Name"><input placeholder="e.g. Office closure" value={newHolidayName} onChange={e => setNewHolidayName(e.target.value)} /></Field>
            <Field label="Date"><input type="date" value={newHolidayDate} onChange={e => setNewHolidayDate(e.target.value)} /></Field>
          </div>
          <fieldset style={{ border: 'none', padding: 0, margin: '0 0 16px' }}>
            <legend style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: T.muted, marginBottom: '6px', padding: 0 }}>Applies to</legend>
            <div style={{ display: 'flex', gap: '6px 16px', flexWrap: 'wrap' }}>
              {PROVINCES.map(p => (
                <label key={p.code} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-base)', color: T.text, cursor: 'pointer' }}>
                  <input type="checkbox" checked={newHolidayProvinces.includes(p.code)} style={{ width: '15px', height: '15px', accentColor: 'var(--brand)' }}
                    onChange={e => setNewHolidayProvinces(prev => e.target.checked ? ALL_PROVINCES.filter(c => c === p.code || prev.includes(c)) : prev.filter(c => c !== p.code))} />
                  {p.branches} <span style={{ color: T.subtle, fontSize: 'var(--text-sm)' }}>({p.code})</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: 'var(--text-base)', color: T.muted, cursor: 'pointer' }}>
            <input type="checkbox" checked={newHolidayRepeats} onChange={e => setNewHolidayRepeats(e.target.checked)} style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: 'var(--brand)' }} />
            Same date every year
          </label>
        </Modal>
      )}

      {importOpen && (
        <Modal
          title="Import HR list"
          description="Start dates, branches and each person's Personal / Vacation and Care days for a year. Paste it straight from Excel, or choose a CSV file."
          onClose={() => setImportOpen(false)}
          busy={importing}
          maxWidth={760}
          footer={(
            <>
              <Button variant="secondary" onClick={() => setImportOpen(false)} disabled={importing}>Cancel</Button>
              <Button onClick={runImport} busy={importing} busyLabel="Importing…" disabled={importReady.length === 0}>
                Import {importReady.length || ''} {importReady.length === 1 ? 'person' : 'people'}
              </Button>
            </>
          )}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: T.muted }}>Allowances are for</span>
            <Segmented size="sm" label="Import year" value={importYear} onChange={setImportYear}
              options={[CURRENT_YEAR, CURRENT_YEAR + 1].map(y => ({ value: y, label: String(y) }))} />
          </div>
          <Field label="The list" hint={'First line is the header. Use a "Name" or "Email" column to match people, plus any of "Start date", "Branch", "Vacation" and "Care". Blank cells are left as they are.'}>
            <textarea rows={6} style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--text-sm)', resize: 'vertical' }}
              placeholder={'Name\tStart date\tBranch\tVacation\tCare\nJane Smith\t2019-03-14\tHalifax\t15\t5'}
              value={importText} onChange={e => setImportText(e.target.value)} />
          </Field>
          <label className="il-link-subtle" style={{ display: 'inline-block', fontSize: 'var(--text-sm)', color: T.brand, cursor: 'pointer', marginBottom: '14px' }}>
            Or choose a CSV file…
            <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={readImportFile} className="il-visually-hidden" />
          </label>

          {importPreview?.error && importText.trim() && (
            <div className="il-field-hint" data-tone="error" role="alert">{importPreview.error}</div>
          )}
          {importPreview && !importPreview.error && importPreview.rows.length > 0 && (
            <div style={{ border: `1px solid ${T.border}`, borderRadius: T.radiusMd, maxHeight: '280px', overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
                <thead>
                  <tr style={{ background: T.surfaceSunken, position: 'sticky', top: 0 }}>
                    {['Person', 'Start date', 'Branch', 'Vacation', 'Care', ''].map(h => (
                      <th key={h} scope="col" style={{ textAlign: 'left', padding: '7px 10px', fontSize: 'var(--text-xs)', color: T.muted, fontWeight: 600, borderBottom: `1px solid ${T.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {importPreview.rows.map(r => {
                    const ok = r.employee && r.problems.length === 0
                    const v = r.values
                    const cell = { padding: '7px 10px', borderBottom: `1px solid ${T.borderSubtle}`, verticalAlign: 'top' }
                    return (
                      <tr key={r.line} style={{ background: ok ? 'transparent' : T.warningBg }}>
                        <td style={cell}>{r.employee?.full_name || r.label}</td>
                        <td style={cell}>{v.start_date ? formatDate(v.start_date, { month: 'short', day: 'numeric', year: 'numeric' }) : '–'}</td>
                        <td style={cell}>{v.branch ? branchName(v.branch) : '–'}</td>
                        <td style={cell} className="il-tabular">{v.vacation_days ?? '–'}</td>
                        <td style={cell} className="il-tabular">{v.care_days ?? '–'}</td>
                        <td style={{ ...cell, color: ok ? T.success : T.warning }}>{ok ? 'Ready' : r.problems.join('. ')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {importPreview && !importPreview.error && importPreview.rows.length > importReady.length && (
            <p style={{ fontSize: 'var(--text-xs)', color: T.muted, margin: '10px 0 0', lineHeight: 1.5 }}>
              Highlighted lines will be skipped. Fix them in the list above, or set those people by hand afterwards.
            </p>
          )}
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
              {employees.filter(takesTimeOff).map(emp => <option key={emp.id} value={emp.id}>{emp.full_name}</option>)}
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
          <Field label="Type" hint={balanceBucket(logForm.type) ? `Uses ${BUCKETS[balanceBucket(logForm.type)].short}.` : "Doesn't use a balance."}>
            <select value={logForm.type} onChange={e => setLogForm(f => ({ ...f, type: e.target.value }))}>
              {LOG_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          {workFromWhereverHint(logForm.type, logForm.start, logForm.portion === 'full' ? logForm.end : logForm.start, logForm.portion) && (
            <div className="il-field-hint" data-tone="warning" role="status" style={{ margin: '-8px 0 14px' }}>
              {workFromWhereverHint(logForm.type, logForm.start, logForm.portion === 'full' ? logForm.end : logForm.start, logForm.portion)}
            </div>
          )}
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
