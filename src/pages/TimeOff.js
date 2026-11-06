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
import { getToday, getCurrentYear, TIME_OFF_STATUS, BRANCHES, PROVINCES, branchName, branchProvince } from '../config'
import { TYPE_LABELS, StatusPill, TypeIcon, fmtDate, fmtDateRange } from '../utils/timeOffShared'
import { countsAgainstBalance, balanceBucket, BUCKETS, summarizeYear, remainingIfApproved, yearSplitOf, findOverlap, formatDays, workFromWhereverHint } from '../utils/timeOffMath'
import { parseImportList } from '../utils/importList'
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
import Avatar from '../ui/Avatar'
import { avatarHue } from '../utils/avatarColor'

// Each person's bar is drawn in their avatar colour (see avatarColor.js), so
// the calendar and the avatars agree. Bars are tinted by mixing the hue into
// the current surface, so they read in both light and dark themes.
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

// Allowances count as "not set" when there's no row, or only the empty row an
// approval creates on its own (no vacation and no care days).
function hasNoEntitlement(bal) {
  return !bal || (Number(bal.total_days) === 0 && Number(bal.care_days) === 0)
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
  const [editing, setEditing] = useState(null) // { employeeId, vacation, vacationUsed, care, careUsed, branch, startDate }
  const [savingBalance, setSavingBalance] = useState(false)
  const [bulkDays, setBulkDays] = useState('')
  const [bulkCare, setBulkCare] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [startYearOpen, setStartYearOpen] = useState(false)
  // HR's yearly list
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importYear, setImportYear] = useState(getCurrentYear() + 1)
  const [importing, setImporting] = useState(false)
  // Calendar
  const [calBranch, setCalBranch] = useState('')
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
      supabase.from('employees').select('id, full_name, email, branch, hire_date').order('full_name'),
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
    if (newHolidayProvinces.length === 0) { showToast('Choose at least one branch.', 'error'); return }
    setSavingHoliday(true)
    const base = { name: newHolidayName.trim(), date: newHolidayDate, repeats_yearly: newHolidayRepeats, kind: 'company' }
    // One row for every branch, or one per province it applies to.
    const rows = newHolidayProvinces.length === ALL_PROVINCES.length
      ? [{ ...base, province: null }]
      : newHolidayProvinces.map(province => ({ ...base, province }))
    const { error } = await supabase.from('company_holidays').insert(rows)
    if (error) { showToast(handleSupabaseError(error, 'Failed to add holiday.'), 'error'); setSavingHoliday(false); return }
    setNewHolidayName('')
    setNewHolidayDate('')
    setNewHolidayRepeats(false)
    setNewHolidayProvinces(ALL_PROVINCES)
    showToast('Holiday added. Pending requests have been recounted.')
    setSavingHoliday(false)
    await fetchHolidays()
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
    const bucket = balanceBucket(req.type)
    const refund = bucket && req.status === TIME_OFF_STATUS.APPROVED ? `<p>${formatDays(req.business_days)} have gone back into your ${BUCKETS[bucket].short}.</p>` : ''
    const emailed = req.employee?.email
      ? await sendEmail({ to: req.employee.email, subject: 'Your time off has been cancelled', html: decisionEmail(req, 'cancelled by HR', '', refund) })
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

  async function applyBulkEntitlement() {
    const days = bulkDays === '' ? 0 : parseFloat(bulkDays)
    const care = bulkCare === '' ? 0 : parseFloat(bulkCare)
    if ([days, care].some(v => isNaN(v) || v < 0) || days + care === 0) { showToast('Enter a number of days above 0.', 'error'); return }
    const y = String(balYear)
    const targets = employees.filter(e => hasNoEntitlement(balanceIndex[e.id]?.[y]))
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
  const BAL_COLS = 'minmax(0, 1.6fr) 78px 64px 70px 84px 64px 70px 64px'

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
            {a.bucket === 'care' && a.hasBalance && <span style={{ color: T.subtle, fontSize: 'var(--text-xs)' }}> care</span>}
          </span>
        ))}
      </span>
    )
  }

  // What the employee told us, and who decided.
  function detailsLine(req) {
    const bits = []
    const wfw = req.status === TIME_OFF_STATUS.PENDING && workFromWhereverHint(req.type, req.start_date, req.end_date, req.day_portion || 'full')
    if (wfw) bits.push(['Heads up', 'Not one full Monday to Friday week', true])
    if (req.flexibility) bits.push(['Flexibility', `${FLEX_LABELS[req.flexibility] || req.flexibility}${req.flexibility_note ? `: ${req.flexibility_note}` : ''}`])
    if (req.volunteering_with) bits.push(['Volunteering with', req.volunteering_with])
    if (req.notes) bits.push(['Their note', req.notes])
    if (req.status !== TIME_OFF_STATUS.PENDING && req.reviewer?.full_name) bits.push([req.status === TIME_OFF_STATUS.APPROVED ? 'Approved by' : 'Decided by', req.reviewer.full_name])
    if (req.status !== TIME_OFF_STATUS.PENDING && req.review_notes) bits.push(['HR note', req.review_notes])
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
          <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Avatar name={req.employee?.full_name} colorKey={req.employee?.email} size={32} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 'var(--text-md)', fontWeight: 500, color: T.text }}>{req.employee?.full_name || '?'}</div>
              {overlapNames.length > 0 && (
                <div style={{ fontSize: 'var(--text-xs)', color: T.warning, marginTop: '2px' }}>{overlapNames.join(', ')} also off</div>
              )}
            </div>
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
        vac: summarizeYear(bal, empReqs, balYear, { bucket: 'vacation' }),
        care: summarizeYear(bal, empReqs, balYear, { bucket: 'care' }),
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
        subtitle={isMobile ? null : 'Review requests, set yearly allowances and see who’s away.'}
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
                  <div role="columnheader" title="What's left of the vacation or care day allowance if this request is approved">Left after</div>
                  <div role="columnheader"><span className="il-visually-hidden">Actions</span></div>
                </div>
                {displayRequests.map(req => {
                  const overlapNames = getOverlapNames(req)
                  const pending = req.status === TIME_OFF_STATUS.PENDING
                  const details = detailsLine(req)
                  return (
                    <div key={req.id} role="row" style={{ borderBottom: `1px solid ${T.borderSubtle}`, background: pending ? T.surface : 'transparent' }}>
                      <div style={{ ...s.tRow(REQ_COLS), borderBottom: 'none' }}>
                        <div role="cell" style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <Avatar name={req.employee?.full_name} colorKey={req.employee?.email} size={28} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 500 }}>{req.employee?.full_name || '?'}</div>
                            {overlapNames.length > 0 && (
                              <div style={{ fontSize: 'var(--text-xs)', color: T.warning, marginTop: '2px' }}>{overlapNames.join(', ')} also off</div>
                            )}
                          </div>
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
              <div style={{ display: 'flex', gap: '8px', marginLeft: isMobile ? 0 : 'auto', flexWrap: 'wrap' }}>
                {prevYearCount > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => setStartYearOpen(true)}>Copy {balYear - 1} into {balYear}</Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => { setImportYear(balYear); setImportOpen(true) }}>Import HR list</Button>
              </div>
            </div>

            {!loading && missingCount > 0 && (
              <form onSubmit={e => { e.preventDefault(); applyBulkEntitlement() }}
                style={{ ...s.card, padding: '12px 16px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', background: T.surfaceSunken }}>
                <span style={{ fontSize: 'var(--text-sm)', color: T.text }}>
                  <strong>{missingCount}</strong> {missingCount === 1 ? 'person has' : 'people have'} nothing set for {balYear}. Give them all
                </span>
                <input className="il-input il-tabular" type="number" min="0" step="0.5" aria-label={`Personal / vacation days for everyone without a ${balYear} allowance`}
                  style={{ width: '70px', padding: '5px 8px' }} value={bulkDays} onChange={e => setBulkDays(e.target.value)} placeholder="0" />
                <span style={{ fontSize: 'var(--text-sm)', color: T.muted }}>vacation and</span>
                <input className="il-input il-tabular" type="number" min="0" step="0.5" aria-label={`Care days for everyone without a ${balYear} allowance`}
                  style={{ width: '70px', padding: '5px 8px' }} value={bulkCare} onChange={e => setBulkCare(e.target.value)} placeholder="0" />
                <span style={{ fontSize: 'var(--text-sm)', color: T.muted }}>care days</span>
                <Button size="sm" type="submit" busy={bulkSaving} busyLabel="Saving…" disabled={!bulkDays && !bulkCare}>Apply</Button>
              </form>
            )}

            {loading ? skeletonCards : balanceRows.length === 0 ? (
              <div style={s.card}><EmptyState icon={EmptyIcons.people} title={employees.length ? 'Nobody matches' : 'No employees yet'} message={employees.length ? 'Try a different name.' : 'Balances appear once employees are added.'} /></div>
            ) : (
              <div style={{ ...s.card, overflow: 'hidden' }}>
                {!isMobile && (
                  <div style={s.tHead(BAL_COLS)}>
                    <div>Employee</div>
                    <div title="Personal / Vacation days for the year">Vacation</div><div>Used</div><div title="Left once pending requests are approved">Left</div>
                    <div title="Care days for the year" style={{ borderLeft: `1px solid ${T.border}`, paddingLeft: '12px', marginLeft: '-12px' }}>Care days</div><div>Used</div><div>Left</div>
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
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
                      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={{ color: T.subtle, flexShrink: 0, transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
                        <path d="M3 1.5L6.5 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                      <Avatar name={row.employee.full_name} colorKey={row.employee.email} size={28} />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontWeight: 500, color: T.text }}>{row.employee.full_name}</span>
                        <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: T.subtle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</span>
                      </span>
                    </button>
                  )
                  const editButton = (
                    <Button size="xs" variant="secondary"
                      onClick={() => setEditing({
                        employeeId: row.employee.id,
                        vacation: String(vac.entitlement), vacationUsed: String(vac.used),
                        care: String(care.entitlement), careUsed: String(care.used),
                        branch: row.employee.branch || '', startDate: row.employee.hire_date || '',
                      })}
                      aria-label={`Edit ${row.employee.full_name}'s ${balYear} balance`}>{notSet ? 'Set' : 'Edit'}</Button>
                  )
                  const days = (n, opts = {}) => <span className="il-tabular" style={{ color: opts.muted && !n ? T.subtle : T.text }}>{opts.muted && !n ? '–' : formatDays(n)}</span>
                  const left = sum => notSet && !sum.pending ? <span style={{ color: T.subtle }}>–</span> : (
                    <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.25 }}>
                      <span className="il-tabular" style={{ fontWeight: 600, color: sum.remaining < 0 ? T.danger : T.text }}>{formatDays(sum.remaining)}</span>
                      {sum.pending > 0 && <span className="il-tabular" style={{ fontSize: 'var(--text-xs)', color: T.warning }}>{formatDays(sum.pending)} pending</span>}
                    </span>
                  )
                  const allowance = sum => notSet ? <span style={{ color: T.warning, fontSize: 'var(--text-sm)' }}>Not set</span> : days(sum.entitlement)
                  const editForm = isEditing && (
                    <form onSubmit={e => { e.preventDefault(); saveBalance(row) }}
                      style={{ padding: isMobile ? '0 16px 14px' : '4px 16px 14px 42px', display: 'grid', gap: '12px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 130px)', gap: '10px' }}>
                        {[['vacation', 'Personal / vacation'], ['vacationUsed', 'Vacation used'], ['care', 'Care days'], ['careUsed', 'Care days used']].map(([key, label]) => (
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
                        Approvals add to Used automatically. Only change Used to record days taken before this system, or to correct a mistake. Branch and start date apply to every year.
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
                          <div style={{ marginBottom: '10px' }}>{nameButton}</div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', fontSize: 'var(--text-sm)' }}>
                            {[[BUCKETS.vacation.label, vac], [BUCKETS.care.label, care]].map(([label, sum]) => (
                              <div key={label} style={{ background: T.surfaceSunken, borderRadius: T.radiusSm, padding: '8px 10px' }}>
                                <div style={{ color: T.muted, marginBottom: '4px' }}>{label}</div>
                                {notSet ? allowance(sum) : (
                                  <div style={{ color: T.text }}>
                                    <span style={{ fontWeight: 600 }}>{formatDays(sum.remaining)}</span> left of {formatDays(sum.entitlement)}
                                    {sum.pending > 0 && <div style={{ fontSize: 'var(--text-xs)', color: T.warning }}>{formatDays(sum.pending)} pending</div>}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                          {!isEditing && <div style={{ marginTop: '10px' }}>{editButton}</div>}
                        </div>
                      ) : (
                        <div style={{ ...s.tRow(BAL_COLS), borderBottom: 'none' }}>
                          <div style={{ minWidth: 0 }}>{nameButton}</div>
                          <div>{allowance(vac)}</div>
                          <div>{days(vac.used, { muted: true })}</div>
                          <div>{left(vac)}</div>
                          <div style={{ borderLeft: `1px solid ${T.borderSubtle}`, paddingLeft: '12px', marginLeft: '-12px', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>{allowance(care)}</div>
                          <div>{days(care.used, { muted: true })}</div>
                          <div>{left(care)}</div>
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
              Left = allowance − used − pending. Personal / Vacation requests come out of Vacation and Care Day requests out of Care days; other types are tracked but don't change either. Unused days don't carry over.
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
              <select className="il-input" aria-label="Show branch" style={{ width: 'auto', padding: '5px 30px 5px 8px', fontSize: 'var(--text-sm)' }} value={calBranch} onChange={e => setCalBranch(e.target.value)}>
                <option value="">All branches</option>
                {BRANCHES.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
              </select>
              {!isMobile && (
                <div style={{ display: 'flex', gap: '14px', marginLeft: 'auto', alignItems: 'center', fontSize: 'var(--text-sm)', color: T.muted }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span aria-hidden="true" style={{ width: '22px', height: '12px', borderRadius: '3px', ...eventColors(avatarHue('legend'), false) }} />Approved
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span aria-hidden="true" style={{ width: '22px', height: '12px', borderRadius: '3px', ...eventColors(avatarHue('legend'), true) }} />Pending
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span aria-hidden="true" style={{ width: '12px', height: '12px', borderRadius: '3px', background: T.brandLight, border: `1px solid ${T.border}` }} />Holiday
                  </span>
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
                  // People and holidays for the chosen branch. Someone with no
                  // branch set counts as Halifax, as the day counts do.
                  const calProvince = calBranch ? branchProvince(calBranch) : null
                  const calRequests = calBranch ? requests.filter(r => (r.employee?.branch || 'halifax') === calBranch) : requests
                  const calHolidays = calProvince ? holidays.filter(h => !h.province || h.province === calProvince) : holidays
                  const holidaysOn = iso => groupHolidays(calHolidays.filter(h => holidayOn(h, iso)))
                  const holidayLabel = g => g.everywhere || calProvince ? g.name : `${g.name} (${g.provinces.join(', ')})`
                  const weeks = []
                  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

                  return weeks.map((week, wi) => {
                    const weekDates = week.map(day => day ? `${calYear}-${pad(calMonth + 1)}-${pad(day)}` : null)
                    const { assignments, trackCount } = getWeekEventLayout(weekDates, calRequests)
                    const eventsH = trackCount * SLOT_H + (trackCount > 0 ? 8 : 6)
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
                              <div key={di} title={holTitle || undefined} style={{ height: DATE_ROW_H, padding: '5px 8px', display: 'flex', justifyContent: 'space-between', gap: '4px', alignItems: 'flex-start', background: cellBg(day, di), borderRight: di < 6 ? `1px solid ${T.borderSubtle}` : 'none', minWidth: 0 }}>
                                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: T.brandStrong, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, lineHeight: '18px' }}>
                                  {hols.length > 0 && <span aria-hidden="true">{isMobile ? '•' : `${holidayLabel(hols[0])}${hols.length > 1 ? ` +${hols.length - 1}` : ''}`}</span>}
                                  {hols.length > 0 && <span className="il-visually-hidden">{`, holiday: ${hols.map(holidayLabel).join(', ')}`}</span>}
                                </span>
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
                                  ...eventColors(avatarHue(req.employee?.email || req.employee?.full_name), isPending),
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
            <div style={{ display: 'grid', gap: '16px', maxWidth: '860px' }}>
              <form onSubmit={e => { e.preventDefault(); addHoliday() }} style={{ ...s.card, padding: '18px 20px' }}>
                <h2 style={{ ...T.type.h2, fontSize: 'var(--text-md)', margin: '0 0 6px', color: T.text }}>Add a holiday</h2>
                <p style={{ fontSize: 'var(--text-sm)', color: T.muted, margin: '0 0 14px', lineHeight: 1.55 }}>
                  For anything beyond the handbook list, like an extra day the office closes. Holidays are skipped when business days are counted, for the branches they apply to.
                </p>
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: 'var(--text-base)', color: T.muted, cursor: 'pointer' }}>
                    <input type="checkbox" checked={newHolidayRepeats} onChange={e => setNewHolidayRepeats(e.target.checked)} style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: 'var(--brand)' }} />
                    Same date every year
                  </label>
                  <Button type="submit" busy={savingHoliday} busyLabel="Adding…" disabled={!newHolidayName.trim() || !newHolidayDate || newHolidayProvinces.length === 0}>Add holiday</Button>
                </div>
                <p style={{ fontSize: 'var(--text-xs)', color: T.subtle, margin: '12px 0 0', lineHeight: 1.5 }}>
                  Adding or removing a holiday recounts every pending request automatically. Approved requests keep the count they were approved with.
                </p>
              </form>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <Segmented size="sm" label="Holiday year" value={holidayYear} onChange={setHolidayYear}
                  options={years.map(y => ({ value: y, label: String(y) }))} />
                {!holidaysLoading && !hasHandbookYear && (
                  <Button size="sm" variant="secondary" busy={addingYear} busyLabel="Adding…" onClick={() => addYearHolidays(holidayYear)}>
                    Add {holidayYear}'s handbook holidays
                  </Button>
                )}
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
                        : s.tRow(HOL_COLS)}>
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
                NS is Halifax, NB is Moncton and Saint John, NL is St. John's, PE is Charlottetown. Stat is a statutory holiday and Obs an observed one, as in the handbook. A fixed-date holiday that lands on a weekend is given on the Monday after, marked "(observed)". Regatta Day is weather-dependent: if it moves, change it here.
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
