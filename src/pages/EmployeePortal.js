import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import { SkeletonLine, SkeletonTaskRow } from '../components/Skeleton'
import Toast from '../components/Toast'
import ConfirmModal from '../components/ConfirmModal'
import useToast from '../hooks/useToast'
import { handleSupabaseError } from '../utils/handleError'
import { getTechSupportEmail } from '../utils/getHrEmail'
import { logAudit } from '../utils/auditLog'
import { useWindowSize } from '../hooks/useWindowSize'
import { SCHEDULE_BUCKETS, getCurrentYear, getToday, FEATURES, TIME_OFF_START_DATE, ONBOARDING_STATUS, TIME_OFF_STATUS, ROUTES, brandName } from '../config'
import { normalizeTask, groupParentsByBucket, bucketDateHint, isBucketUpcoming } from '../utils/schedule'
import { TYPE_LABELS, StatusPill, TypeIcon, fmtDateRange } from '../utils/timeOffShared'
import { escapeHtml, escapeHtmlMultiline } from '../utils/escapeHtml'
import { notifyTimeOffHrAndManager, sendEmail, appLink } from '../utils/emailNotify'
import { countsAgainstBalance, balanceBucket, balanceUseLabel, BUCKETS, summarizeYear, remainingIfApproved, findOverlap, employeeCanCancel, relevantYears, splitTotal, formatDays, workFromWhereverHint } from '../utils/timeOffMath'
import { TICKET_CATEGORIES, TICKET_URGENCY, TicketStatusPill, categoryLabel, urgencyLabel } from '../utils/ticketShared'
import { computeProgress, isParentComplete } from '../utils/taskProgress'
import { attachResolvedUrls } from '../utils/documentUrls'
import EmptyState, { EmptyIcons } from '../ui/EmptyState'
import { T } from '../ui/theme'
import { formatDate } from '../utils/dates'
import { safeFileName } from '../utils/files'
import CheckCircle from '../ui/CheckCircle'
import Tabs from '../ui/Tabs'
import Button from '../ui/Button'
import Segmented from '../ui/Segmented'
import FileButton from '../ui/FileButton'
import SearchInput from '../ui/SearchInput'
import ThemeToggle from '../ui/ThemeToggle'
import ProgressRing from '../ui/ProgressRing'
import AnimatedNumber from '../ui/AnimatedNumber'
import Avatar from '../ui/Avatar'
import { BrandLockup } from '../ui/Brand'
import TimeOffBalanceCard from '../components/TimeOffBalanceCard'

const BASE_STYLES = {
  app: { minHeight: '100vh', background: 'transparent', fontFamily: T.font, color: T.text },
  logo: { fontSize: 'var(--text-md)', fontWeight: 600, color: T.brand, letterSpacing: '-0.2px' },
  signout: { fontSize: 'var(--text-sm)', color: T.muted, background: 'none', border: `1px solid ${T.border}`, borderRadius: T.radiusSm, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 },
  sub: { fontSize: 'var(--text-base)', color: T.muted },
  progressRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' },
  progressTrack: { height: '6px', background: T.border, borderRadius: '999px', overflow: 'hidden' },
  progressFill: { height: '100%', background: T.brand, borderRadius: '999px', transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)' },
  phaseLabel: { fontSize: 'var(--text-xs)', fontWeight: 600, color: T.subtle, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '12px', marginTop: '28px' },
  parentRow: { display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 0', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' },
  subtaskRow: { display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 0 10px 32px', borderBottom: `1px solid ${T.bg}`, cursor: 'pointer', background: 'var(--surface-raised)' },
  taskName: (checked) => ({ fontSize: 'var(--text-md)', color: checked ? T.subtle : T.text, textDecoration: checked ? 'line-through' : 'none', flex: 1 }),
  subtaskName: (checked) => ({ fontSize: 'var(--text-base)', color: checked ? T.subtle : T.muted, textDecoration: checked ? 'line-through' : 'none', flex: 1 }),
  chevron: (open) => ({ fontSize: 'var(--text-xs)', color: T.subtle, transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }),
  subtaskCount: { fontSize: 'var(--text-xs)', color: T.subtle },
  fieldLabel: { fontSize: 'var(--text-sm)', color: T.muted, marginBottom: '6px', display: 'block', fontWeight: 500 },
  fieldInput: { width: '100%', minWidth: 0, background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '9px 12px', fontSize: 'var(--text-base)', color: T.text, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none' },
  torRow: { display: 'flex', alignItems: 'center', gap: '12px', padding: '13px 0', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' },
  cancelBtn: { fontSize: 'var(--text-sm)', color: T.muted, background: 'none', border: `1px solid ${T.border}`, borderRadius: T.radiusSm, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 },
}

const LEGACY_TYPES = new Set(['vacation', 'sick', 'personal'])
const TYPE_OPTIONS = Object.entries(TYPE_LABELS)
  .filter(([k]) => !LEGACY_TYPES.has(k))
  .map(([value, label]) => ({ value, label }))

const FLEXIBILITY_OPTIONS = [
  { value: 'firm', label: 'Firm' },
  { value: 'moderately_adjustable', label: 'Moderately Adjustable' },
  { value: 'flexible', label: 'Flexible' },
  { value: 'other', label: 'Other' },
]

const TICKET_COLUMNS = 'id, category, urgency, title, description, status, admin_notes, created_at, updated_at, resolved_at'


export default function EmployeePortal({ session, userProfile, onSwitchToAdmin }) {
  const [instance, setInstance] = useState(null)
  const [tasks, setTasks] = useState([])
  const [completions, setCompletions] = useState({})
  const [expandedTasks, setExpandedTasks] = useState({})
  const [documents, setDocuments] = useState([])
  const [companyResources, setCompanyResources] = useState([])
  const [docCompletions, setDocCompletions] = useState({})
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('checklist')
  const [employee, setEmployee] = useState(null)
  const [celebration, setCelebration] = useState(null)
  const { toast, showToast, hideToast } = useToast()
  const { isMobile } = useWindowSize()
  const [uploadingDocId, setUploadingDocId] = useState(null)
  const celebrationTimer = useRef(null)
  // Recomputed each render so a long-lived tab doesn't stick to last year.
  const CURRENT_YEAR = getCurrentYear()
  const TIME_OFF_YEAR = Math.max(CURRENT_YEAR, Number(TIME_OFF_START_DATE.slice(0, 4)))

  // Time off state
  const [timeOffBalances, setTimeOffBalances] = useState([])
  const [timeOffRequests, setTimeOffRequests] = useState([])
  const [timeOffLoading, setTimeOffLoading] = useState(false)
  const [timeOffFetched, setTimeOffFetched] = useState(false)
  const [balanceYear, setBalanceYear] = useState(TIME_OFF_YEAR)
  const [torManagers, setTorManagers] = useState([])
  const [torManagersLoading, setTorManagersLoading] = useState(true)
  const [torManagersError, setTorManagersError] = useState(false)
  const [torManagerId, setTorManagerId] = useState('')
  const [torStartDate, setTorStartDate] = useState('')
  const [torEndDate, setTorEndDate] = useState('')
  const [torType, setTorType] = useState('personal_vacation')
  const [torNotes, setTorNotes] = useState('')
  // Business days per year for the dates being entered, e.g. { 2026: 3 }.
  // null until the database has counted them.
  const [torSplit, setTorSplit] = useState(null)
  const [torCalculating, setTorCalculating] = useState(false)
  const [torSubmitting, setTorSubmitting] = useState(false)
  const [torDayPortion, setTorDayPortion] = useState('full')
  const [torVolunteeringWith, setTorVolunteeringWith] = useState('')
  const [torFlexibility, setTorFlexibility] = useState('')
  const [torFlexibilityNote, setTorFlexibilityNote] = useState('')
  const [cancellingId, setCancellingId] = useState(null)
  const [confirmCancelReq, setConfirmCancelReq] = useState(null)
  const [confirmWfw, setConfirmWfw] = useState(false)
  // Each recount gets a number; a slow answer for old dates is ignored.
  const calcSeq = useRef(0)

  // Company resources search
  const [resourceSearch, setResourceSearch] = useState('')

  // Tech support state
  const [ticketCategory, setTicketCategory] = useState('software')
  const [ticketUrgency, setTicketUrgency] = useState('normal')
  const [ticketTitle, setTicketTitle] = useState('')
  const [ticketDescription, setTicketDescription] = useState('')
  const [ticketSubmitting, setTicketSubmitting] = useState(false)
  const [tickets, setTickets] = useState([])
  const [ticketsLoading, setTicketsLoading] = useState(false)
  const [ticketsFetched, setTicketsFetched] = useState(false)
  const [techEmail, setTechEmail] = useState(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchMyOnboarding is stable, mount-only fetch
  useEffect(() => { fetchMyOnboarding() }, [])

  // Reloaded every time the tab is opened, so a decision HR made or a reply
  // on a ticket shows up without reloading the whole app. Only the first
  // load shows a skeleton; later ones update in place.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchTimeOffData is stable, refresh on tab change
  useEffect(() => { if (activeTab === 'time-off') fetchTimeOffData() }, [activeTab])

  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchTickets is stable, refresh on tab change
  useEffect(() => { if (activeTab === 'technical-tickets') fetchTickets() }, [activeTab])

  useEffect(() => {
    return () => { clearTimeout(celebrationTimer.current) }
  }, [])

  async function fetchMyOnboarding() {
    try {
      // Always fetch the employee record so we have name/role in all cases
      const { data: empData } = await supabase
        .from('employees')
        .select('id, full_name, hire_date, brand, role_id, manager_id, takes_time_off, roles(name)')
        .eq('id', userProfile.employee_id)
        .single()
      if (empData) setEmployee(empData)

      const { data: instanceData, error: instanceError } = await supabase
        .from('onboarding_instances')
        .select(`
          id, status,
          employees (id, full_name, hire_date, role_id, manager_id, roles (name)),
          task_completions (
            id, completed, completed_at, day, sort_order, custom_task_name, custom_owner,
            onboarding_templates (id, task_name, phase, owner, parent_id)
          )
        `)
        .eq('employee_id', userProfile.employee_id)
        .eq('status', ONBOARDING_STATUS.ACTIVE)
        .single()

      if (instanceError && instanceError.code !== 'PGRST116') {
        showToast(handleSupabaseError(instanceError, 'Failed to load your onboarding.'), 'error')
      }

      if (instanceData) {
        setInstance(instanceData)
        const comp = {}
        instanceData.task_completions.forEach(tc => { comp[tc.id] = tc.completed })
        setTasks(instanceData.task_completions.map(normalizeTask))
        setCompletions(comp)

        const roleId = instanceData.employees?.role_id
        if (roleId) {
          const { data: docs } = await supabase.from('documents').select('*').eq('is_company_resource', false).or(`role_id.is.null,role_id.eq.${roleId}`)
          if (docs) setDocuments(docs)
        } else {
          const { data: docs } = await supabase.from('documents').select('*').eq('is_company_resource', false).is('role_id', null)
          if (docs) setDocuments(docs)
        }

        const { data: dc } = await supabase.from('document_completions').select('*').eq('employee_id', userProfile.employee_id)
        const map = {}
        if (dc) dc.forEach(d => map[d.document_id] = d)
        setDocCompletions(await attachResolvedUrls(map))
      }

      const { data: resources } = await supabase.from('documents').select('*').eq('is_company_resource', true).order('uploaded_at', { ascending: false })
      if (resources) setCompanyResources(resources)

      // Default tab: onboarding checklist if active, otherwise company resources
      setActiveTab(instanceData ? 'checklist' : 'company-resources')
    } catch (err) {
      showToast('Failed to load your portal. Please refresh.', 'error')
      console.error('Failed to load portal:', err)
    } finally {
      setLoading(false)
    }
  }

  async function fetchTimeOffData() {
    if (!timeOffFetched) setTimeOffLoading(true)
    setTorManagersLoading(true)
    const [{ data: bals, error: balErr }, { data: reqs, error: reqsErr }, managerResult] = await Promise.all([
      supabase.from('time_off_balances').select('*').eq('employee_id', userProfile.employee_id),
      supabase.from('time_off_requests').select('*').eq('employee_id', userProfile.employee_id).order('start_date', { ascending: false }),
      supabase.rpc('get_time_off_managers').then(r => r, () => ({ data: null, error: true })),
    ])
    if (balErr || reqsErr) showToast(handleSupabaseError(balErr || reqsErr, 'Failed to load your time off.'), 'error')
    setTimeOffBalances(bals || [])
    setTimeOffRequests(reqs || [])
    const managers = managerResult.data || []
    setTorManagers(managers)
    setTorManagersError(Boolean(managerResult.error))
    setTorManagersLoading(false)
    setTorManagerId(current => managers.some(m => m.manager_id === current)
      ? current : managers.find(m => m.is_default)?.manager_id || '')
    setTimeOffFetched(true)
    setTimeOffLoading(false)
  }

  // The database counts the business days (skipping weekends and company
  // holidays) and splits them by year, so the number shown here is the same
  // number HR approves.
  async function recalcDays(start, end, portion) {
    const seq = ++calcSeq.current
    const half = portion !== 'full'
    const last = half ? start : end
    if (!start || !last || last < start) { setTorSplit(null); setTorCalculating(false); return }
    setTorCalculating(true)
    const { data, error } = await supabase.rpc('time_off_year_split', { p_start: start, p_end: last, p_half_day: half })
    if (seq !== calcSeq.current) return
    setTorCalculating(false)
    if (error) { setTorSplit(null); showToast(handleSupabaseError(error, 'Failed to count business days.'), 'error'); return }
    setTorSplit(data || {})
  }

  function handleStartChange(value) {
    setTorStartDate(value)
    if (torDayPortion !== 'full') setTorEndDate(value)
    recalcDays(value, torDayPortion !== 'full' ? value : torEndDate, torDayPortion)
  }

  function handleEndChange(value) {
    setTorEndDate(value)
    recalcDays(torStartDate, value, torDayPortion)
  }

  function handleDayPortionChange(portion) {
    setTorDayPortion(portion)
    if (portion !== 'full' && torStartDate) setTorEndDate(torStartDate)
    recalcDays(torStartDate, portion !== 'full' ? torStartDate : torEndDate, portion)
  }

  function resetTimeOffForm() {
    calcSeq.current++
    setTorStartDate('')
    setTorEndDate('')
    setTorType('personal_vacation')
    setTorNotes('')
    setTorSplit(null)
    setTorCalculating(false)
    setTorDayPortion('full')
    setTorVolunteeringWith('')
    setTorFlexibility('')
    setTorFlexibilityNote('')
  }

  const balancesByYear = useMemo(
    () => Object.fromEntries(timeOffBalances.map(b => [String(b.year), b])),
    [timeOffBalances]
  )

  async function submitTimeOffRequest({ confirmed = false } = {}) {
    if (torSubmitting) return
    const isHalfDay = torDayPortion !== 'full'
    const endDate = isHalfDay ? torStartDate : torEndDate
    if (!torStartDate || !endDate) { showToast('Please choose your dates.', 'error'); return }
    if (endDate < torStartDate) { showToast('End date must be on or after start date.', 'error'); return }
    if (torStartDate < TIME_OFF_START_DATE) { showToast('Please choose time off on or after January 1, 2027.', 'error'); return }
    if (torManagersLoading || torManagersError || !torManagers.some(m => m.manager_id === torManagerId)) {
      showToast('Please select your direct manager.', 'error'); return
    }
    if (!torFlexibility) { showToast('Please select a flexibility option.', 'error'); return }
    if (torFlexibility === 'other' && !torFlexibilityNote.trim()) { showToast('Please describe how flexible these dates are.', 'error'); return }
    if (torType === 'volunteer' && !torVolunteeringWith.trim()) { showToast('Please say who you will be volunteering with.', 'error'); return }
    if (torSplit === null || torCalculating) { showToast('Still counting business days, please wait a moment.', 'error'); return }
    if (splitTotal(torSplit) === 0) { showToast('Those dates are all weekends or company holidays, so there is nothing to request.', 'error'); return }
    const overlap = findOverlap(timeOffRequests, torStartDate, endDate, { portion: torDayPortion })
    if (overlap) { showToast(`You already have a ${overlap.status} request for ${fmtDateRange(overlap.start_date, overlap.end_date)}. Cancel it first, or choose other dates.`, 'error'); return }
    // A guideline, not a rule: ask once, then send it if they want to.
    if (!confirmed && workFromWhereverHint(torType, torStartDate, endDate, torDayPortion)) { setConfirmWfw(true); return }

    const notesVal = torNotes.trim()
    const volunteeringWith = torType === 'volunteer' ? torVolunteeringWith.trim() : null
    const flexibilityNote = torFlexibility === 'other' ? torFlexibilityNote.trim() : null

    setTorSubmitting(true)
    const { data: newReq, error } = await supabase
      .from('time_off_requests')
      .insert({
        employee_id: userProfile.employee_id,
        direct_manager_id: torManagerId,
        start_date: torStartDate,
        end_date: endDate,
        // The database recounts this on insert; sent so the row is never empty.
        business_days: splitTotal(torSplit),
        type: torType,
        notes: notesVal || null,
        status: TIME_OFF_STATUS.PENDING,
        is_half_day: isHalfDay,
        day_portion: torDayPortion,
        volunteering_with: volunteeringWith,
        flexibility: torFlexibility,
        flexibility_note: flexibilityNote,
      })
      .select()
      .single()

    if (error) {
      // Nothing is cleared, so they can fix it and try again.
      setTorSubmitting(false)
      showToast(handleSupabaseError(error, 'Failed to submit request.'), 'error')
      return
    }

    const nextRequests = [newReq, ...timeOffRequests]
    setTimeOffRequests(nextRequests)
    resetTimeOffForm()
    setTorSubmitting(false)
    logAudit('time_off_requested', 'time_off_request', newReq.id, { type: newReq.type, days: newReq.business_days, start_date: newReq.start_date, end_date: newReq.end_date, direct_manager_id: newReq.direct_manager_id })

    const employeeName = instance?.employees?.full_name || employee?.full_name || 'Employee'
    const bucket = balanceBucket(newReq.type)
    const after = remainingIfApproved(newReq, balancesByYear, nextRequests)
    const balanceLine = !bucket
      ? "Doesn't use a balance"
      : after.map(a => a.hasBalance ? `${formatDays(a.remaining)} ${BUCKETS[bucket].short} left in ${a.year}` : `no ${a.year} allowance set up yet`).join(', ')
    const wfwNote = workFromWhereverHint(newReq.type, newReq.start_date, newReq.end_date, newReq.day_portion)
    const dayPortionLabel = newReq.day_portion === 'am' ? ' (morning)' : newReq.day_portion === 'pm' ? ' (afternoon)' : ''
    const flexibilityLabel = FLEXIBILITY_OPTIONS.find(f => f.value === newReq.flexibility)?.label || newReq.flexibility
    const html = `
<p><strong>${escapeHtml(employeeName)}</strong> has requested time off.</p>
<p>
  <strong>Dates:</strong> ${fmtDateRange(newReq.start_date, newReq.end_date)}<br/>
  <strong>Type:</strong> ${escapeHtml(TYPE_LABELS[newReq.type] || newReq.type)}<br/>
  <strong>Direct manager:</strong> ${escapeHtml(newReq.direct_manager_name || '')}<br/>
  <strong>Business days:</strong> ${formatDays(newReq.business_days)}${dayPortionLabel}<br/>
  <strong>Flexibility:</strong> ${escapeHtml(flexibilityLabel)}${flexibilityNote ? `: ${escapeHtml(flexibilityNote)}` : ''}<br/>
  <strong>Balance if approved:</strong> ${escapeHtml(balanceLine)}${wfwNote ? '<br/><strong>Heads up:</strong> not one full Monday to Friday week' : ''}${volunteeringWith ? `<br/><strong>Volunteering with:</strong> ${escapeHtml(volunteeringWith)}` : ''}${notesVal ? `<br/><strong>Notes:</strong> ${escapeHtmlMultiline(notesVal)}` : ''}
</p>
${appLink(ROUTES.TIME_OFF, 'Review it in Integrated Launch')}`

    const sent = await notifyTimeOffHrAndManager({ requestId: newReq.id, subject: `Time off request: ${employeeName}`, html })
    if (sent.hr === false) showToast('Request submitted, but the email to HR failed. Please let HR know directly.', 'warning')
    else if (sent.manager === false) showToast('Request submitted, but the email to your manager failed. Please let HR know directly.', 'warning')
    else showToast(sent.hr ? 'Request submitted. HR has been notified.' : 'Request submitted.')
  }

  async function cancelTimeOffRequest(req) {
    setCancellingId(req.id)

    // Status change and any balance refund happen together in the database.
    const { error } = await supabase.rpc('cancel_time_off_request', { p_request_id: req.id })
    if (error) { showToast(handleSupabaseError(error, 'Failed to cancel request.'), 'error'); setCancellingId(null); return }

    logAudit('time_off_cancelled', 'time_off_request', req.id, { type: req.type, days: req.business_days, previous_status: req.status })

    const employeeName = instance?.employees?.full_name || employee?.full_name || 'Employee'
    const html = `
<p><strong>${escapeHtml(employeeName)}</strong> has cancelled a time off request.</p>
<p>
  <strong>Dates:</strong> ${fmtDateRange(req.start_date, req.end_date)}<br/>
  <strong>Type:</strong> ${escapeHtml(TYPE_LABELS[req.type] || req.type)}<br/>
  <strong>Business days:</strong> ${formatDays(req.business_days)}<br/>
  <strong>Was:</strong> ${escapeHtml(req.status)}
</p>
${appLink(ROUTES.TIME_OFF, 'Open time off in Integrated Launch')}`
    await notifyTimeOffHrAndManager({ requestId: req.id, subject: `Time off cancelled: ${employeeName}`, html })

    showToast('Request cancelled.')
    setCancellingId(null)
    await fetchTimeOffData()
  }

  async function fetchTickets() {
    if (!ticketsFetched) setTicketsLoading(true)
    const [{ data, error }, email] = await Promise.all([
      supabase.from('tech_support_tickets').select(TICKET_COLUMNS).eq('employee_id', userProfile.employee_id).order('created_at', { ascending: false }),
      getTechSupportEmail(),
    ])
    if (error) showToast(handleSupabaseError(error, 'Failed to load your tickets.'), 'error')
    setTickets(data || [])
    setTechEmail(email || null)
    setTicketsFetched(true)
    setTicketsLoading(false)
  }

  async function submitTicket() {
    const title = ticketTitle.trim()
    const description = ticketDescription.trim()
    if (!title) { showToast('Please enter a subject.', 'error'); return }
    if (!description) { showToast('Please describe the issue.', 'error'); return }

    setTicketSubmitting(true)
    // Saved first: the ticket queue is the record, the email is the nudge.
    const { data: ticket, error } = await supabase
      .from('tech_support_tickets')
      .insert({ employee_id: userProfile.employee_id, category: ticketCategory, urgency: ticketUrgency, title, description })
      .select(TICKET_COLUMNS)
      .single()

    if (error) {
      setTicketSubmitting(false)
      showToast(handleSupabaseError(error, 'Failed to submit ticket. Please try again.'), 'error')
      return
    }

    setTickets(prev => [ticket, ...prev])
    setTicketTitle('')
    setTicketDescription('')
    setTicketCategory('software')
    setTicketUrgency('normal')
    setTicketSubmitting(false)
    logAudit('ticket_submitted', 'tech_support_ticket', ticket.id, { category: ticket.category, urgency: ticket.urgency })

    const employeeName = instance?.employees?.full_name || employee?.full_name || 'Employee'
    const employeeEmail = session?.user?.email || ''
    const to = techEmail || await getTechSupportEmail()
    const urgent = ticket.urgency === 'blocking'
    const html = `
<p><strong>${escapeHtml(employeeName)}</strong> has submitted a tech support ticket.</p>
<p>
  <strong>How much it's affecting their work:</strong> ${escapeHtml(urgencyLabel(ticket.urgency))}<br/>
  <strong>Category:</strong> ${escapeHtml(categoryLabel(ticket.category))}<br/>
  <strong>Subject:</strong> ${escapeHtml(title)}<br/>
  <strong>Reply to:</strong> <a href="mailto:${escapeHtml(employeeEmail)}">${escapeHtml(employeeEmail)}</a>
</p>
<p><strong>Details:</strong><br/>${escapeHtmlMultiline(description)}</p>
${appLink(ROUTES.TECH_SUPPORT, 'Open the ticket queue')}`
    const sent = to ? await sendEmail({
      to,
      subject: `[Tech support]${urgent ? ' URGENT:' : ''} ${categoryLabel(ticket.category)}: ${title} (${employeeName})`,
      html,
    }) : false

    if (sent) showToast("Ticket sent. You'll see updates on it here.")
    else showToast("Ticket saved, but the support inbox couldn't be emailed. It's still in the queue and will be seen there.", 'warning')
  }

  const TODAY = getToday()


  const subtasksFor = (parent) => tasks.filter(s => s.parentId && s.parentId === parent.templateId)
  const isTaskDone = (parent, comp) => isParentComplete(parent, tasks, comp)

  const progress = useMemo(() => computeProgress(tasks, completions), [tasks, completions])
  const totalTasks = progress.total
  const completedTasksCount = progress.done
  const pct = progress.pct

  const unsignedDocCount = useMemo(
    () => instance ? documents.filter(doc => !docCompletions[doc.id]?.hidden && !docCompletions[doc.id]?.signed).length : 0,
    [instance, documents, docCompletions]
  )

  async function toggleTask(completionId, current, e) {
    if (e && e.stopPropagation) e.stopPropagation()
    const newVal = !current
    const newCompletions = { ...completions, [completionId]: newVal }
    setCompletions(newCompletions)

    const { error } = await supabase
      .from('task_completions')
      .update({ completed: newVal, completed_at: newVal ? new Date().toISOString() : null })
      .eq('id', completionId)

    if (error) {
      setCompletions(prev => ({ ...prev, [completionId]: current }))
      showToast(handleSupabaseError(error, 'Failed to save. Please try again.'), 'error')
      return
    }

    if (newVal) {
      const parentTasks = tasks.filter(t => !t.parentId)
      const completedCount = parentTasks.filter(p => isTaskDone(p, newCompletions)).length

      if (completedCount === parentTasks.length) {
        setCelebration('all')
      } else {
        SCHEDULE_BUCKETS.forEach(bucket => {
          const bucketTasks = parentTasks.filter(p => p.bucket === bucket)
          if (bucketTasks.length === 0) return
          const nowComplete = bucketTasks.every(p => isTaskDone(p, newCompletions))
          const wasComplete = bucketTasks.every(p => isTaskDone(p, completions))
          if (nowComplete && !wasComplete) setCelebration(bucket)
        })
      }
      clearTimeout(celebrationTimer.current)
      celebrationTimer.current = setTimeout(() => setCelebration(null), 3000)
    }
  }

  async function toggleDocument(docId) {
    const existing = docCompletions[docId]
    if (existing) {
      const newVal = !existing.signed
      setDocCompletions(prev => ({ ...prev, [docId]: { ...existing, signed: newVal } }))
      const { error } = await supabase
        .from('document_completions')
        .update({ signed: newVal, completed_at: newVal ? new Date().toISOString() : null })
        .eq('id', existing.id)
      if (error) {
        setDocCompletions(prev => ({ ...prev, [docId]: existing }))
        showToast(handleSupabaseError(error, 'Failed to save. Please try again.'), 'error')
      }
    } else {
      const { data, error } = await supabase
        .from('document_completions')
        .insert({ employee_id: userProfile.employee_id, document_id: docId, signed: true, received: true, completed_at: new Date().toISOString() })
        .select().single()
      if (error) {
        showToast(handleSupabaseError(error, 'Failed to save. Please try again.'), 'error')
      } else if (data) {
        setDocCompletions(prev => ({ ...prev, [docId]: data }))
      }
    }
  }

  async function handleEmployeeDocumentUpload(e, docId) {
    const file = e.target.files[0]
    if (!file) return
    setUploadingDocId(docId)

    const employeeId = userProfile.employee_id
    const filePath = `${employeeId}/${docId}_${Date.now()}_${safeFileName(file.name)}`

    const { error: uploadError } = await supabase.storage
      .from('employee-documents')
      .upload(filePath, file, { upsert: true })

    if (uploadError) {
      showToast('Upload failed. Please try again.', 'error')
      setUploadingDocId(null)
      return
    }

    // Persist the storage path; a short-lived signed URL is minted on demand
    // for viewing (see documentUrls.js) so links never silently expire.
    const { data: urlData } = await supabase.storage
      .from('employee-documents')
      .createSignedUrl(filePath, 60 * 60)
    const resolvedUrl = urlData?.signedUrl || null
    const existing = docCompletions[docId]

    if (existing) {
      const { error } = await supabase
        .from('document_completions')
        .update({ completed_file_path: filePath, signed: true, completed_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (error) { showToast('Failed to save upload.', 'error'); setUploadingDocId(null); return }
      setDocCompletions(prev => ({ ...prev, [docId]: { ...existing, completed_file_path: filePath, signed: true, resolvedUrl } }))
    } else {
      const { data, error } = await supabase
        .from('document_completions')
        .insert({ employee_id: employeeId, document_id: docId, signed: true, received: true, completed_at: new Date().toISOString(), completed_file_path: filePath })
        .select().single()
      if (error) { showToast('Failed to save upload.', 'error'); setUploadingDocId(null); return }
      if (data) setDocCompletions(prev => ({ ...prev, [docId]: { ...data, resolvedUrl } }))
    }

    showToast('Document uploaded successfully')
    setUploadingDocId(null)
    e.target.value = ''
  }


  const styles = {
    ...BASE_STYLES,
    topbar: { background: 'var(--surface)', boxShadow: '0 1px 0 var(--border)', padding: isMobile ? '0 16px' : '0 32px', height: isMobile ? '52px' : '60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    hero: { padding: isMobile ? '24px 16px 0' : '44px 40px 0', maxWidth: isMobile ? 'none' : '720px', margin: '0 auto' },
    name: { fontFamily: T.fontHeading, fontSize: isMobile ? 'var(--text-xl)' : 'var(--text-2xl)', fontWeight: 600, letterSpacing: '-0.01em', marginBottom: '4px' },
    progressWrap: { marginTop: '20px', marginBottom: isMobile ? '20px' : '32px' },
    content: { padding: isMobile ? '20px 16px' : '28px 40px', maxWidth: isMobile ? 'none' : '720px', margin: '0 auto' },
    formCard: { background: T.surface, border: '1px solid var(--border-card)', borderRadius: T.radiusLg, padding: isMobile ? '16px' : '22px', marginBottom: '24px' },
  }

  if (loading) return (
    <div style={styles.app}>
      <div className="il-header" data-topbar="true" style={styles.topbar}>
        <BrandLockup size={isMobile ? 22 : 26} sub="Integrated Launch" />
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {onSwitchToAdmin && (
            <button onClick={onSwitchToAdmin} style={{ fontSize: 'var(--text-sm)', color: 'var(--brand)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
              ← Admin view
            </button>
          )}
          <ThemeToggle compact />
          <button style={styles.signout} onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
      <div style={{ padding: '40px', maxWidth: '720px', margin: '0 auto' }}>
        <SkeletonLine width="200px" height="24px" style={{ marginBottom: '8px' }} />
        <SkeletonLine width="280px" height="13px" style={{ marginBottom: '24px' }} />
        <SkeletonLine width="100%" height="6px" style={{ marginBottom: '32px' }} />
        <SkeletonTaskRow /><SkeletonTaskRow /><SkeletonTaskRow />
      </div>
    </div>
  )

  // Derive display values regardless of whether there is an active instance
  const displayName = instance?.employees?.full_name || employee?.full_name || ''
  const displayRole = instance?.employees?.roles?.name || employee?.roles?.name || ''
  const displayHireDate = instance?.employees?.hire_date || employee?.hire_date

  // ── Time off: what to show ──
  // Employees see this year, plus next year once anything is booked into it.
  const liveRequests = timeOffRequests.filter(r => r.status === TIME_OFF_STATUS.PENDING || r.status === TIME_OFF_STATUS.APPROVED)
  const yearOptions = relevantYears(TIME_OFF_YEAR, { balances: timeOffBalances, requests: liveRequests }).filter(y => y >= TIME_OFF_YEAR)
  const shownYear = yearOptions.includes(balanceYear) ? balanceYear : TIME_OFF_YEAR
  const shownBalance = balancesByYear[String(shownYear)]
  const summaries = ['vacation', 'care'].map(bucket => summarizeYear(shownBalance, timeOffRequests, shownYear, { bucket }))
  const hasShownBalance = Boolean(shownBalance)
  const torWfwHint = workFromWhereverHint(torType, torStartDate, torDayPortion !== 'full' ? torStartDate : torEndDate, torDayPortion)
  const torIsHalf = torDayPortion !== 'full'
  const torEnd = torIsHalf ? torStartDate : torEndDate
  const torDays = torSplit ? splitTotal(torSplit) : null
  const torSplitYears = torSplit ? Object.entries(torSplit).filter(([, d]) => Number(d) > 0) : []
  const torAfter = torSplit ? remainingIfApproved({ id: '__draft', type: torType, year_split: torSplit }, balancesByYear, timeOffRequests) : []
  const torOverlap = findOverlap(timeOffRequests, torStartDate, torEnd, { portion: torDayPortion })
  const torDatesBackwards = torStartDate && torEnd && torEnd < torStartDate
  const submitBlocker =
    !torStartDate || !torEnd ? 'Choose your dates to continue.'
    : torDatesBackwards ? 'End date must be on or after the start date.'
    : torStartDate < TIME_OFF_START_DATE ? 'Choose time off on or after January 1, 2027.'
    : torManagersLoading ? 'Loading direct managers…'
    : torManagersError ? 'Reload the direct managers to continue.'
    : !torManagers.some(m => m.manager_id === torManagerId) ? 'Select your direct manager to continue.'
    : torCalculating || torSplit === null ? 'Counting business days…'
    : torDays === 0 ? 'Those dates are all weekends or company holidays.'
    : torOverlap ? `You already have a ${torOverlap.status} request that overlaps these dates.`
    : !torFlexibility ? 'Select a flexibility option to continue.'
    : null
  const upcomingRequests = timeOffRequests
    .filter(r => (r.status === TIME_OFF_STATUS.PENDING || r.status === TIME_OFF_STATUS.APPROVED) && r.end_date >= TODAY)
    .sort((a, b) => (a.start_date < b.start_date ? -1 : 1))
  const pastRequests = timeOffRequests.filter(r => !upcomingRequests.includes(r))

  return (
    <div style={styles.app}>
      <div className="il-header" data-topbar="true" style={styles.topbar}>
        <BrandLockup size={isMobile ? 22 : 26} sub="Integrated Launch" />
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {onSwitchToAdmin && (
            <button onClick={onSwitchToAdmin} style={{ fontSize: 'var(--text-sm)', color: 'var(--brand)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
              ← Admin view
            </button>
          )}
          <ThemeToggle compact />
          <button style={styles.signout} onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>

      <div style={styles.hero}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '4px' }}>
          <Avatar name={displayName} colorKey={session?.user?.email} size={46} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={styles.name}>Welcome, {displayName.split(' ')[0]}</div>
            <div style={styles.sub}>
              {displayRole && `${displayRole} · `}
              {instance && displayHireDate
                ? `Started ${formatDate(displayHireDate)}`
                : (brandName(employee?.brand || userProfile?.brand) || 'Integrated Staffing')}
            </div>
          </div>
          {instance && !isMobile && (
            <ProgressRing value={pct} size={64} stroke={6} />
          )}
        </div>
        {instance && (
          <div style={styles.progressWrap}>
            {isMobile && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
                <ProgressRing value={pct} size={72} stroke={7} />
              </div>
            )}
            <div style={styles.progressRow}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>
                <AnimatedNumber value={completedTasksCount} duration={500} /> of {totalTasks} tasks complete
              </span>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--brand)' }}>
                {completedTasksCount === totalTasks && totalTasks > 0 ? 'All done 🎉' : `${totalTasks - completedTasksCount} left`}
              </span>
            </div>
            <div style={styles.progressTrack}>
              <div style={{ ...styles.progressFill, width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>

      <div style={{ maxWidth: isMobile ? 'none' : '720px', margin: '0 auto', padding: isMobile ? '0 16px' : '0 40px' }}>
        <div style={{ borderBottom: `1px solid ${T.border}` }}>
        <Tabs
          label="Your portal"
          value={activeTab}
          onChange={setActiveTab}
          gap={isMobile ? 18 : 24}
          items={[
            instance && { id: 'checklist', label: 'My checklist' },
            instance && { id: 'documents', label: 'My documents', badge: unsignedDocCount || null },
            { id: 'company-resources', label: 'Company resources' },
            // Unreleased features are labelled rather than silently greyed out.
            // Partners, casual staff without vacation and former staff don't get the tab.
            employee?.takes_time_off !== false && { id: 'time-off', label: 'Time off', disabled: !FEATURES.employeeTimeOff, badge: FEATURES.employeeTimeOff ? null : 'Soon' },
            { id: 'technical-tickets', label: 'Tech support', disabled: !FEATURES.techSupport, badge: FEATURES.techSupport ? null : 'Soon' },
          ].filter(Boolean)}
        />
        </div>
      </div>

      <div style={styles.content}>
        {activeTab === 'checklist' && (
          <div className="il-tab-content">
            <div className="il-card" style={{ padding: isMobile ? '4px 16px 12px' : '6px 24px 16px' }}>
            {(() => {
              const parentsByBucket = groupParentsByBucket(tasks)
              return SCHEDULE_BUCKETS.map(bucket => {
                const parentTasks = parentsByBucket[bucket] || []
                if (parentTasks.length === 0) return null
                const upcoming = isBucketUpcoming(displayHireDate, bucket)
                const dateHint = bucketDateHint(displayHireDate, bucket)
                return (
                  <div key={bucket}>
                    <div style={{ ...styles.phaseLabel, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>{bucket}</span>
                      {dateHint && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--subtle)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{dateHint}</span>}
                      {upcoming && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--subtle)', fontWeight: 500, background: 'var(--bg)', padding: '1px 6px', borderRadius: '3px', textTransform: 'none', letterSpacing: 0 }}>Upcoming</span>}
                    </div>
                    {parentTasks.map(task => {
                      const subtasks = subtasksFor(task)
                      const hasSubtasks = subtasks.length > 0
                      const isExpanded = expandedTasks[task.id]
                      const subtasksComplete = hasSubtasks ? subtasks.every(s => completions[s.id]) : false
                      const isChecked = hasSubtasks ? subtasksComplete : completions[task.id]
                      const completedSubs = subtasks.filter(s => completions[s.id]).length
                      return (
                        <div key={task.id}>
                          {hasSubtasks ? (
                            <button type="button" className="il-row" aria-expanded={!!isExpanded}
                              style={{ ...styles.parentRow, width: '100%', background: 'none', border: 'none', borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', font: 'inherit' }}
                              onClick={() => setExpandedTasks(prev => ({ ...prev, [task.id]: !prev[task.id] }))}>
                              <CheckCircle checked={!!isChecked} size={20} />
                              <span style={styles.taskName(isChecked)}>{task.name}</span>
                              <span style={styles.subtaskCount}>{completedSubs}/{subtasks.length}</span>
                              <span style={styles.chevron(isExpanded)}>▶</span>
                            </button>
                          ) : (
                            <button type="button" className="il-row" aria-pressed={!!completions[task.id]}
                              aria-label={`Mark "${task.name}" ${completions[task.id] ? 'incomplete' : 'complete'}`}
                              style={{ ...styles.parentRow, width: '100%', background: 'none', border: 'none', borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', font: 'inherit' }}
                              onClick={(e) => toggleTask(task.id, completions[task.id], e)}>
                              <CheckCircle checked={!!isChecked} size={20} />
                              <span style={styles.taskName(isChecked)}>{task.name}</span>
                            </button>
                          )}
                          {hasSubtasks && isExpanded && (
                            <div>
                              {subtasks.map(s => (
                                <button key={s.id} type="button" className="il-row" aria-pressed={!!completions[s.id]}
                                  aria-label={`Mark "${s.name}" ${completions[s.id] ? 'incomplete' : 'complete'}`}
                                  style={{ ...styles.subtaskRow, width: '100%', border: 'none', borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', font: 'inherit' }}
                                  onClick={(e) => toggleTask(s.id, completions[s.id], e)}>
                                  <CheckCircle checked={!!completions[s.id]} size={15} />
                                  <span style={styles.subtaskName(completions[s.id])}>{s.name}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })
            })()}
            </div>
          </div>
        )}

        {activeTab === 'documents' && (
          <div className="il-tab-content">
            <div className="il-card" style={{ padding: isMobile ? '4px 16px 8px' : '6px 24px 10px' }}>
            {documents.filter(doc => !docCompletions[doc.id]?.hidden).length === 0 && (
              <EmptyState icon={EmptyIcons.doc} title="No documents yet"
                message="When HR assigns documents for you to review or sign, they'll appear here." />
            )}
            {documents.filter(doc => !docCompletions[doc.id]?.hidden).map(doc => {
              const dc = docCompletions[doc.id]
              const signed = dc?.signed || false
              const completedFileUrl = dc?.resolvedUrl || dc?.completed_file_url || null
              const isUploading = uploadingDocId === doc.id
              return (
                <div key={doc.id} style={{ padding: '16px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ flex: 1, fontSize: 'var(--text-md)', color: 'var(--text)', fontWeight: 500 }}>{doc.name}</div>
                    <a href={doc.file_url} target="_blank" rel="noreferrer" className="il-btn-link" style={{ fontSize: 'var(--text-sm)', color: T.brand, textDecoration: 'none', flexShrink: 0 }}>View</a>
                    {signed ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--success)', fontWeight: 500 }}>✓ Received</span>
                        <Button variant="link" size="xs" style={{ color: T.subtle }} onClick={() => toggleDocument(doc.id)} aria-label={`Undo: mark ${doc.name} as not received`}>Undo</Button>
                      </div>
                    ) : (
                      <Button size="xs" variant="secondary" onClick={() => toggleDocument(doc.id)}>Mark as received</Button>
                    )}
                  </div>
                  <div style={{ marginTop: '10px' }}>
                    {completedFileUrl ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--success)' }}>✓ Uploaded</span>
                        <a href={completedFileUrl} target="_blank" rel="noreferrer" style={{ fontSize: 'var(--text-sm)', color: 'var(--brand)', textDecoration: 'none' }}>View file</a>
                        <FileButton variant="link" icon={false} busy={isUploading} accept=".pdf,.doc,.docx" onFile={e => handleEmployeeDocumentUpload(e, doc.id)}>Replace</FileButton>
                      </div>
                    ) : (
                      <FileButton variant="soft" busy={isUploading} accept=".pdf,.doc,.docx" onFile={e => handleEmployeeDocumentUpload(e, doc.id)}>Upload completed document</FileButton>
                    )}
                  </div>
                </div>
              )
            })}
            </div>
          </div>
        )}

        {activeTab === 'company-resources' && (
          <div className="il-tab-content">
            {companyResources.length === 0 ? (
              <EmptyState icon={EmptyIcons.folder} title="No company resources yet"
                message="Shared handbooks, policies, and guides will show up here once they're added." />
            ) : (
              <>
                {companyResources.length > 3 && (
                  <div style={{ marginBottom: '16px' }}>
                    <SearchInput value={resourceSearch} onChange={setResourceSearch} placeholder="Search resources…" label="Search company resources" />
                  </div>
                )}
                {(() => {
                  const filtered = resourceSearch
                    ? companyResources.filter(d => d.name.toLowerCase().includes(resourceSearch.toLowerCase()))
                    : companyResources
                  if (filtered.length === 0) return (
                    <EmptyState compact icon={EmptyIcons.search} title="No matches"
                      message={`Nothing matches "${resourceSearch}". Try a different search.`} />
                  )
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
                      {filtered.map(doc => {
                        const rawExt = (doc.file_url || '').split('?')[0].split('.').pop().toLowerCase()
                        const ext = rawExt.length <= 5 ? rawExt : ''
                        const typeLabel = ext === 'pdf' ? 'PDF' : ext === 'docx' || ext === 'doc' ? 'DOC' : ext === 'xlsx' || ext === 'xls' ? 'XLS' : ext === 'pptx' || ext === 'ppt' ? 'PPT' : ext ? ext.toUpperCase() : 'FILE'
                        const hue = ext === 'pdf' ? 'var(--danger)' : ext === 'docx' || ext === 'doc' ? 'var(--brand)' : ext === 'xlsx' || ext === 'xls' ? 'var(--success)' : ext === 'pptx' || ext === 'ppt' ? 'var(--warning)' : 'var(--muted)'
                        const iconBg = `color-mix(in srgb, ${hue} 14%, var(--surface))`
                        const iconStroke = hue
                        return (
                          <a key={doc.id} href={doc.file_url} target="_blank" rel="noreferrer" className="il-resource-tile"
                            style={{ display: 'flex', flexDirection: 'column', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 'var(--radius-md)', boxShadow: T.shadowSm, padding: '14px', textDecoration: 'none', color: 'var(--text)' }}>
                            <div style={{ width: '34px', height: '34px', borderRadius: 'var(--radius-md)', background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px', flexShrink: 0 }}>
                              <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke={iconStroke} strokeWidth="1.5">
                                <path d="M3 2h6l3 3v7H3z"/><path d="M9 2v3h3"/>
                              </svg>
                            </div>
                            <div style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--text)', lineHeight: '1.4', flex: 1, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                              {doc.name}
                            </div>
                            <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--muted)', background: 'var(--hover-bg)', borderRadius: '3px', padding: '1px 5px' }}>{typeLabel}</span>
                              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--subtle)' }}>Open ↗</span>
                            </div>
                          </a>
                        )
                      })}
                    </div>
                  )
                })()}
              </>
            )}
          </div>
        )}

        {activeTab === 'time-off' && (
          <div className="il-tab-content">
            {timeOffLoading ? (
              <>
                <SkeletonLine width="100%" height="100px" style={{ marginBottom: '20px', borderRadius: 'var(--radius-md)' }} />
                <SkeletonLine width="100%" height="160px" style={{ marginBottom: '20px', borderRadius: 'var(--radius-md)' }} />
                <SkeletonTaskRow /><SkeletonTaskRow />
              </>
            ) : (
              <>
                {/* Balances. Hidden until HR sets one up, unless there's
                    another year to switch to. */}
                {(hasShownBalance || yearOptions.length > 1) && (
                <TimeOffBalanceCard summaries={summaries} year={shownYear} years={yearOptions}
                  onYearChange={setBalanceYear} hasBalance={hasShownBalance} isMobile={isMobile} />
                )}

                {/* Request form */}
                <section style={styles.formCard} aria-labelledby="il-tor-title">
                  <h2 id="il-tor-title" className="il-section-title" style={{ marginBottom: '20px' }}>Request time off</h2>

                  <p style={{ margin: '-12px 0 20px', fontSize: 'var(--text-sm)', color: T.muted }}>For time off from January 1, 2027.</p>

                  <div style={{ marginBottom: '20px' }}>
                    <label htmlFor="il-tor-manager" style={styles.fieldLabel}>Direct manager <span aria-hidden="true" style={{ color: T.danger }}>*</span></label>
                    <select id="il-tor-manager" className="il-input" required
                      aria-describedby={torManagersError || (!torManagersLoading && torManagers.length === 0) ? 'il-tor-manager-hint' : undefined}
                      value={torManagerId} disabled={torManagersLoading || torManagersError || torManagers.length === 0}
                      onChange={e => setTorManagerId(e.target.value)}>
                      <option value="">{torManagersLoading ? 'Loading managers…' : 'Select your direct manager'}</option>
                      {torManagers.map(m => <option key={m.manager_id} value={m.manager_id}>{m.full_name}</option>)}
                    </select>
                    {(torManagersError || (!torManagersLoading && torManagers.length === 0)) && (
                      <div id="il-tor-manager-hint" className="il-field-hint" data-tone={torManagersError ? 'error' : 'muted'} role={torManagersError ? 'alert' : undefined}>
                        {torManagersError ? <>Couldn’t load the manager list. <button type="button" className="il-link-subtle" onClick={fetchTimeOffData}>Try again</button></>
                          : 'No direct managers are available. Please contact HR.'}
                      </div>
                    )}
                  </div>

                  <div style={{ marginBottom: '20px' }}>
                    <span style={styles.fieldLabel}>Duration</span>
                    <Segmented label="Duration" value={torDayPortion} onChange={handleDayPortionChange}
                      options={[{ value: 'full', label: 'Full day(s)' }, { value: 'am', label: 'Morning' }, { value: 'pm', label: 'Afternoon' }]} />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: isMobile || torIsHalf ? '1fr' : '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                    <div style={{ minWidth: 0 }}>
                      <label htmlFor="il-tor-start" style={styles.fieldLabel}>{torIsHalf ? 'Date' : 'First day off'}</label>
                      <input id="il-tor-start" type="date" min={TIME_OFF_START_DATE} style={styles.fieldInput} value={torStartDate} onChange={e => handleStartChange(e.target.value)} />
                    </div>
                    {!torIsHalf && (
                      <div style={{ minWidth: 0 }}>
                        <label htmlFor="il-tor-end" style={styles.fieldLabel}>Last day off</label>
                        <input id="il-tor-end" type="date" style={styles.fieldInput} value={torEndDate} min={torStartDate && torStartDate > TIME_OFF_START_DATE ? torStartDate : TIME_OFF_START_DATE} onChange={e => handleEndChange(e.target.value)} />
                      </div>
                    )}
                  </div>

                  {/* Business days, counted by the database */}
                  {torStartDate && torEnd && !torDatesBackwards && (
                    <div aria-live="polite" style={{ marginTop: '-8px', marginBottom: '20px', fontSize: 'var(--text-base)', color: 'var(--muted)' }}>
                      {torCalculating || torDays === null ? (
                        <span style={{ color: 'var(--subtle)' }}>Counting business days…</span>
                      ) : (
                        <span>
                          <strong style={{ color: 'var(--text)' }}>{formatDays(torDays).slice(0, -1)}</strong> business day{torDays !== 1 ? 's' : ''}
                          {torSplitYears.length > 1 && ` (${torSplitYears.map(([y, d]) => `${formatDays(d)} in ${y}`).join(', ')})`}
                          {torDays === 0 && ': these dates are all weekends or company holidays'}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Type of leave */}
                  <div style={{ marginBottom: '20px' }}>
                    <span id="il-tor-type" style={styles.fieldLabel}>Type of leave</span>
                    <div role="radiogroup" aria-labelledby="il-tor-type" style={{ display: 'grid', gap: '2px' }}>
                      {TYPE_OPTIONS.map((o, i) => {
                        const active = torType === o.value
                        return (
                          <label key={o.value} className="il-row"
                            style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', cursor: 'pointer', borderRadius: T.radiusMd, background: active ? T.brandLight : 'transparent', boxShadow: active ? `inset 0 0 0 1px ${T.brand}` : 'none' }}>
                            <input type="radio" name="Type of leave" value={o.value} checked={active} onChange={() => setTorType(o.value)}
                              style={{ width: '16px', height: '16px', margin: 0, accentColor: 'var(--brand)', cursor: 'pointer' }} />
                            <span style={{ flex: 1, fontSize: 'var(--text-base)', color: T.text, fontWeight: active ? 500 : 400 }}>{o.label}</span>
                            <span style={{ fontSize: 'var(--text-xs)', color: T.subtle, textAlign: 'right' }}>
                              {balanceUseLabel(o.value)}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  {torType === 'volunteer' && (
                    <div style={{ marginBottom: '20px' }}>
                      <label htmlFor="il-tor-vol" style={styles.fieldLabel}>Who will you be volunteering with? <span aria-hidden="true" style={{ color: T.danger }}>*</span></label>
                      <input id="il-tor-vol" type="text" style={styles.fieldInput} placeholder="Organization name"
                        value={torVolunteeringWith} onChange={e => setTorVolunteeringWith(e.target.value)} />
                    </div>
                  )}

                  <div style={{ marginBottom: '20px' }}>
                    <label htmlFor="il-tor-notes" style={styles.fieldLabel}>Notes (optional)</label>
                    <textarea id="il-tor-notes" style={{ ...styles.fieldInput, resize: 'vertical', minHeight: '64px' }}
                      placeholder="Anything HR should know, like coverage you've arranged"
                      value={torNotes} onChange={e => setTorNotes(e.target.value)} />
                  </div>

                  {/* Flexibility */}
                  <div style={{ marginBottom: '20px' }}>
                    <span id="il-tor-flex" style={styles.fieldLabel}>How flexible are these dates? <span aria-hidden="true" style={{ color: T.danger }}>*</span></span>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--subtle)', marginBottom: '8px' }}>Helps HR if a busy period or someone else's leave clashes with yours.</div>
                    <div role="radiogroup" aria-labelledby="il-tor-flex" style={{ display: 'grid', gap: '2px' }}>
                      {FLEXIBILITY_OPTIONS.map((o, i) => {
                        const active = torFlexibility === o.value
                        return (
                          <label key={o.value} className="il-row"
                            style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', cursor: 'pointer', borderRadius: T.radiusMd, background: active ? T.brandLight : 'transparent', boxShadow: active ? `inset 0 0 0 1px ${T.brand}` : 'none' }}>
                            <input type="radio" name="Flexibility" value={o.value} checked={active} onChange={() => setTorFlexibility(o.value)}
                              style={{ width: '16px', height: '16px', margin: 0, accentColor: 'var(--brand)', cursor: 'pointer' }} />
                            <span style={{ fontSize: 'var(--text-base)', color: T.text, fontWeight: active ? 500 : 400 }}>{o.label}</span>
                          </label>
                        )
                      })}
                    </div>
                    {torFlexibility === 'other' && (
                      <input type="text" aria-label="Describe your flexibility" style={{ ...styles.fieldInput, marginTop: '8px' }}
                        placeholder="Please describe..." value={torFlexibilityNote} onChange={e => setTorFlexibilityNote(e.target.value)} />
                    )}
                  </div>

                  {torAfter.filter(a => a.hasBalance && a.remaining < 0).map(a => (
                    <div key={a.year} role="status" style={{ fontSize: 'var(--text-sm)', color: T.warning, background: T.warningBg, border: `1px solid ${T.warningBorder}`, borderRadius: T.radiusSm, padding: '10px 12px', marginBottom: '12px' }}>
                      This would put you {formatDays(Math.abs(a.remaining))} over your {a.year} {BUCKETS[a.bucket].short}. You can still send it; HR will decide.
                    </div>
                  ))}
                  {torAfter.some(a => !a.hasBalance) && (
                    <div role="status" style={{ fontSize: 'var(--text-sm)', color: T.muted, background: T.surfaceSunken, border: `1px solid ${T.border}`, borderRadius: T.radiusSm, padding: '10px 12px', marginBottom: '12px' }}>
                      Your {torAfter.filter(a => !a.hasBalance).map(a => a.year).join(' and ')} allowance isn't set up yet, so HR will check your balance when they review this.
                    </div>
                  )}
                  {torWfwHint && (
                    <div role="status" style={{ fontSize: 'var(--text-sm)', color: T.warning, background: T.warningBg, border: `1px solid ${T.warningBorder}`, borderRadius: T.radiusSm, padding: '10px 12px', marginBottom: '12px', lineHeight: 1.5 }}>
                      {torWfwHint}
                    </div>
                  )}
                  {torOverlap && (
                    <div className="il-field-hint" data-tone="error" role="alert" style={{ marginBottom: '12px' }}>
                      You already have a {torOverlap.status} request for {fmtDateRange(torOverlap.start_date, torOverlap.end_date)}. Cancel it first, or choose other dates.
                    </div>
                  )}

                  <Button disabled={Boolean(submitBlocker) && !torSubmitting} busy={torSubmitting} busyLabel="Submitting…" onClick={() => submitTimeOffRequest()}>Submit request</Button>
                  {submitBlocker && !torSubmitting && !torOverlap && (
                    <div className="il-field-hint" data-tone="muted" style={{ marginTop: '8px' }}>{submitBlocker}</div>
                  )}
                </section>

                {/* Request history */}
                {timeOffRequests.length === 0 ? (
                  <EmptyState compact icon={EmptyIcons.calendar} title="No requests yet"
                    message="Time off you request will appear here so you can track its status." />
                ) : (
                  [['Upcoming and pending', upcomingRequests], ['Past', pastRequests]].map(([heading, list]) => list.length > 0 && (
                    <section key={heading} style={{ marginBottom: '24px' }}>
                      <h2 className="il-section-title" style={{ marginBottom: '4px' }}>{heading}</h2>
                      {list.map(req => {
                        const canCancel = employeeCanCancel(req, TODAY)
                        const startedApproved = req.status === TIME_OFF_STATUS.APPROVED && !canCancel && req.end_date >= TODAY
                        return (
                          <div key={req.id} style={styles.torRow}>
                            <div style={{ flex: 1, minWidth: '160px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <TypeIcon type={req.type} size={12} />
                                <span style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--text)' }}>{fmtDateRange(req.start_date, req.end_date)}</span>
                              </div>
                              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginTop: '2px' }}>
                                {TYPE_LABELS[req.type] || req.type} · {formatDays(req.business_days)}
                                {req.day_portion === 'am' ? ' (morning)' : req.day_portion === 'pm' ? ' (afternoon)' : ''}
                                {!countsAgainstBalance(req.type) && ' · not from your balance'}
                              </div>
                              {req.direct_manager_name && <div style={{ fontSize: 'var(--text-xs)', color: T.muted, marginTop: '4px' }}>Direct manager: {req.direct_manager_name}</div>}
                              {req.review_notes && (
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginTop: '4px' }}>
                                  <span style={{ fontWeight: 500 }}>HR note:</span> <span style={{ fontStyle: 'italic' }}>{req.review_notes}</span>
                                </div>
                              )}
                              {startedApproved && (
                                <div style={{ fontSize: 'var(--text-xs)', color: T.subtle, marginTop: '4px' }}>Already started. Contact HR to change it.</div>
                              )}
                            </div>
                            <StatusPill status={req.status} />
                            {canCancel && (
                              <button style={styles.cancelBtn} disabled={cancellingId === req.id}
                                aria-label={`Cancel request for ${fmtDateRange(req.start_date, req.end_date)}`}
                                onClick={() => req.status === TIME_OFF_STATUS.APPROVED ? setConfirmCancelReq(req) : cancelTimeOffRequest(req)}>
                                {cancellingId === req.id ? '...' : 'Cancel'}
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </section>
                  ))
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'technical-tickets' && (
          <div className="il-tab-content">
            <section style={styles.formCard} aria-labelledby="il-ticket-title">
              <h2 id="il-ticket-title" className="il-section-title" style={{ marginBottom: '6px' }}>Get tech help</h2>
              <p style={{ margin: '0 0 20px', fontSize: 'var(--text-sm)', color: T.muted, lineHeight: 1.55 }}>
                Tell us what's wrong and it goes straight to whoever handles tech support. You'll see their updates on your tickets below.
                {techEmail && <> If it can't wait, you can also email <a href={`mailto:${techEmail}`} style={{ color: T.brand }}>{techEmail}</a>.</>}
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div style={{ minWidth: 0 }}>
                  <label htmlFor="il-ticket-cat" style={styles.fieldLabel}>Category</label>
                  <select id="il-ticket-cat" className="il-input" value={ticketCategory} onChange={e => setTicketCategory(e.target.value)}>
                    {TICKET_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div style={{ minWidth: 0 }}>
                  <span style={styles.fieldLabel}>How much is it affecting your work?</span>
                  <Segmented size="sm" label="How much is it affecting your work?" value={ticketUrgency} onChange={setTicketUrgency} options={TICKET_URGENCY} />
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label htmlFor="il-ticket-subject" style={styles.fieldLabel}>Subject <span aria-hidden="true" style={{ color: T.danger }}>*</span></label>
                <input id="il-ticket-subject" type="text" style={styles.fieldInput} placeholder="e.g. Outlook keeps asking for my password"
                  value={ticketTitle} onChange={e => setTicketTitle(e.target.value)} />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label htmlFor="il-ticket-details" style={styles.fieldLabel}>Details <span aria-hidden="true" style={{ color: T.danger }}>*</span></label>
                <textarea id="il-ticket-details" style={{ ...styles.fieldInput, resize: 'vertical', minHeight: '100px' }}
                  placeholder="What happened? What were you trying to do? Any error messages?"
                  value={ticketDescription} onChange={e => setTicketDescription(e.target.value)} />
              </div>

              <Button disabled={!ticketTitle.trim() || !ticketDescription.trim()} busy={ticketSubmitting} busyLabel="Sending…" onClick={submitTicket}>Send ticket</Button>
            </section>

            <h2 className="il-section-title" style={{ marginBottom: '4px' }}>Your tickets</h2>
            {ticketsLoading ? (
              <><SkeletonTaskRow /><SkeletonTaskRow /></>
            ) : tickets.length === 0 ? (
              <EmptyState compact icon={EmptyIcons.doc} title="No tickets yet" message="Tickets you send will show here with their status." />
            ) : tickets.map(ticket => (
              <div key={ticket.id} style={{ padding: '14px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                  <span style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--text)', flex: 1, minWidth: '160px' }}>{ticket.title}</span>
                  <TicketStatusPill status={ticket.status} />
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
                  {categoryLabel(ticket.category)} · {urgencyLabel(ticket.urgency)} · sent {new Date(ticket.created_at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  {ticket.resolved_at && ` · resolved ${new Date(ticket.resolved_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`}
                </div>
                {ticket.admin_notes && (
                  <div style={{ marginTop: '8px', fontSize: 'var(--text-sm)', color: T.text, background: T.surfaceSunken, border: `1px solid ${T.borderSubtle}`, borderRadius: T.radiusSm, padding: '8px 10px', whiteSpace: 'pre-wrap' }}>
                    <span style={{ fontWeight: 500 }}>Response:</span> {ticket.admin_notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {celebration && (
        <div role="status" style={{
          position: 'fixed', bottom: isMobile ? '80px' : '32px', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--text)', color: 'var(--bg)', borderRadius: 'var(--radius-md)',
          padding: '16px 24px', fontSize: 'var(--text-md)', fontWeight: 500,
          display: 'flex', alignItems: 'center', gap: '10px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.15)', zIndex: 1000,
          fontFamily: T.font,
          animation: 'slideUp 0.2s ease forwards',
          whiteSpace: 'nowrap',
        }}>
          <span style={{ fontSize: 'var(--text-xl)' }}>{celebration === 'all' ? '🎉' : '✓'}</span>
          <span>{celebration === 'all' ? 'Onboarding complete! Great work.' : `${celebration} complete!`}</span>
        </div>
      )}

      {confirmCancelReq && (
        <ConfirmModal
          title="Cancel approved time off?"
          message={`Your ${fmtDateRange(confirmCancelReq.start_date, confirmCancelReq.end_date)} time off will be cancelled${countsAgainstBalance(confirmCancelReq.type) ? ` and ${formatDays(confirmCancelReq.business_days)} go back into your ${BUCKETS[balanceBucket(confirmCancelReq.type)].short}` : ''}. HR will be told. To take it after all, you'd send a new request.`}
          confirmLabel="Yes, cancel it"
          confirmDanger
          onConfirm={async () => {
            await cancelTimeOffRequest(confirmCancelReq)
            setConfirmCancelReq(null)
          }}
          onCancel={() => setConfirmCancelReq(null)}
        />
      )}

      {confirmWfw && (
        <ConfirmModal
          title="Split Work from Wherever week?"
          message="Work from Wherever is usually taken as one full week, Monday to Friday, rather than split into parts. You can still send this request, and HR will review it."
          confirmLabel="Send anyway"
          cancelLabel="Change dates"
          onConfirm={async () => {
            setConfirmWfw(false)
            await submitTimeOffRequest({ confirmed: true })
          }}
          onCancel={() => setConfirmWfw(false)}
        />
      )}

      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onClose={hideToast} />}
    </div>
  )
}
