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
import { SCHEDULE_BUCKETS, getCurrentYear, FEATURES, ONBOARDING_STATUS, TIME_OFF_STATUS } from '../config'
import { getInitials } from '../utils/formatUtils'
import { normalizeTask, groupParentsByBucket, bucketDateHint, isBucketUpcoming } from '../utils/schedule'
import { TYPE_LABELS, StatusPill, TypeIcon, fmtDateRange } from '../utils/timeOffShared'
import { escapeHtml, escapeHtmlMultiline } from '../utils/escapeHtml'
import { notifyHrAndManager } from '../utils/emailNotify'
import { computeProgress, isParentComplete } from '../utils/taskProgress'
import { attachResolvedUrls } from '../utils/documentUrls'
import EmptyState, { EmptyIcons } from '../ui/EmptyState'
import { T } from '../ui/theme'
import { formatDate } from '../utils/dates'
import { safeFileName } from '../utils/files'
import ThemeToggle from '../ui/ThemeToggle'
import ProgressRing from '../ui/ProgressRing'
import AnimatedNumber from '../ui/AnimatedNumber'
import { avatarStyle } from '../utils/avatarColor'
import { isSalesRep, openClientPortal } from '../utils/clientPortal'

const BASE_STYLES = {
  app: { minHeight: '100vh', background: 'transparent', fontFamily: 'Inter, -apple-system, sans-serif', color: T.text },
  logo: { fontSize: '14px', fontWeight: 600, color: T.brand, letterSpacing: '-0.2px' },
  signout: { fontSize: '12px', color: T.muted, background: 'none', border: `1px solid ${T.border}`, borderRadius: T.radiusSm, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 },
  sub: { fontSize: '13px', color: T.muted },
  progressRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' },
  progressTrack: { height: '8px', background: T.borderSubtle, borderRadius: '99px', overflow: 'hidden' },
  progressFill: { height: '100%', background: `linear-gradient(90deg, ${T.brand}, ${T.brandMid})`, borderRadius: '99px', boxShadow: '0 0 8px rgba(0,102,204,0.28)', transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)' },
  phaseLabel: { fontSize: '11px', fontWeight: 600, color: T.subtle, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '12px', marginTop: '28px' },
  parentRow: { display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 0', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' },
  subtaskRow: { display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 0 10px 32px', borderBottom: `1px solid ${T.bg}`, cursor: 'pointer', background: 'var(--surface-raised)' },
  checkbox: (checked) => ({ width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0, border: checked ? 'none' : '1.5px solid #d0cfc9', background: checked ? `linear-gradient(135deg, ${T.brand}, ${T.brandMid})` : T.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s', cursor: 'pointer', boxShadow: checked ? '0 0 0 3px rgba(0,102,204,0.12)' : 'none' }),
  subtaskCheckbox: (checked) => ({ width: '15px', height: '15px', borderRadius: '50%', flexShrink: 0, border: checked ? 'none' : '1.5px solid #d0cfc9', background: checked ? `linear-gradient(135deg, ${T.brand}, ${T.brandMid})` : T.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }),
  taskName: (checked) => ({ fontSize: '14px', color: checked ? T.subtle : T.text, textDecoration: checked ? 'line-through' : 'none', flex: 1 }),
  subtaskName: (checked) => ({ fontSize: '13px', color: checked ? T.subtle : T.muted, textDecoration: checked ? 'line-through' : 'none', flex: 1 }),
  chevron: (open) => ({ fontSize: '10px', color: T.subtle, transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }),
  subtaskCount: { fontSize: '11px', color: T.subtle },
  balStat: { textAlign: 'center' },
  balNum: (warn) => ({ fontSize: '26px', fontWeight: 700, color: warn ? T.danger : T.text, letterSpacing: '-0.8px', fontVariantNumeric: 'tabular-nums' }),
  balLabel: { fontSize: '11px', color: T.subtle, marginTop: '4px', fontWeight: 500, letterSpacing: '0.1px' },
  fieldLabel: { fontSize: '12px', color: T.muted, marginBottom: '6px', display: 'block', fontWeight: 500 },
  fieldInput: { width: '100%', minWidth: 0, background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '9px 12px', fontSize: '13px', color: T.text, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none' },
  submitBtn: (disabled) => ({ background: disabled ? T.border : T.btnPrimaryBg, color: '#fff', border: 'none', borderRadius: T.radiusMd, padding: '10px 20px', fontSize: '13px', fontWeight: 500, cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit', letterSpacing: '0.1px' }),
  torRow: { display: 'flex', alignItems: 'center', gap: '12px', padding: '13px 0', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' },
  cancelBtn: { fontSize: '12px', color: T.muted, background: 'none', border: `1px solid ${T.border}`, borderRadius: T.radiusSm, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 },
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

const TICKET_CATEGORIES = [
  { value: 'software', label: 'Software' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'access_login', label: 'Access / Login' },
  { value: 'network', label: 'Network / Connectivity' },
  { value: 'other', label: 'Other' },
]


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
  const [portalOpening, setPortalOpening] = useState(false)
  const celebrationTimer = useRef(null)
  // Recomputed each render so a long-lived tab doesn't stick to last year.
  const CURRENT_YEAR = getCurrentYear()

  // Time off state
  const [timeOffBalance, setTimeOffBalance] = useState(null)
  const [timeOffRequests, setTimeOffRequests] = useState([])
  const [timeOffLoading, setTimeOffLoading] = useState(false)
  const [timeOffFetched, setTimeOffFetched] = useState(false)
  const [torStartDate, setTorStartDate] = useState('')
  const [torEndDate, setTorEndDate] = useState('')
  const [torType, setTorType] = useState('personal_vacation')
  const [torNotes, setTorNotes] = useState('')
  const [torBusinessDays, setTorBusinessDays] = useState(null)
  const [torCalculating, setTorCalculating] = useState(false)
  const [torSubmitting, setTorSubmitting] = useState(false)
  const [torDayPortion, setTorDayPortion] = useState('full')
  const [torVolunteeringWith, setTorVolunteeringWith] = useState('')
  const [torFlexibility, setTorFlexibility] = useState('')
  const [torFlexibilityNote, setTorFlexibilityNote] = useState('')
  const [cancellingId, setCancellingId] = useState(null)
  const [confirmCancelReq, setConfirmCancelReq] = useState(null)

  // Company resources search
  const [resourceSearch, setResourceSearch] = useState('')

  // Tech tickets state
  const [ticketCategory, setTicketCategory] = useState('software')
  const [ticketTitle, setTicketTitle] = useState('')
  const [ticketDescription, setTicketDescription] = useState('')
  const [ticketSubmitting, setTicketSubmitting] = useState(false)
  const [submittedTickets, setSubmittedTickets] = useState([])

  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchMyOnboarding is stable, mount-only fetch
  useEffect(() => { fetchMyOnboarding() }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchTimeOffData is stable, lazy-load on tab change
  useEffect(() => { if (activeTab === 'time-off' && !timeOffFetched) fetchTimeOffData() }, [activeTab])

  useEffect(() => {
    return () => { clearTimeout(celebrationTimer.current) }
  }, [])

  async function fetchMyOnboarding() {
    try {
      // Always fetch the employee record so we have name/role in all cases
      const { data: empData } = await supabase
        .from('employees')
        .select('id, full_name, hire_date, brand, role_id, manager_id, roles(name)')
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
    setTimeOffLoading(true)
    const [{ data: bal }, { data: reqs, error: reqsErr }] = await Promise.all([
      supabase.from('time_off_balances').select('*').eq('employee_id', userProfile.employee_id).eq('year', CURRENT_YEAR).maybeSingle(),
      supabase.from('time_off_requests').select('*').eq('employee_id', userProfile.employee_id).order('created_at', { ascending: false }),
    ])
    setTimeOffBalance(bal || null)
    if (reqsErr) showToast(handleSupabaseError(reqsErr, 'Failed to load requests.'), 'error')
    setTimeOffRequests(reqs || [])
    setTimeOffFetched(true)
    setTimeOffLoading(false)
  }

  async function calculateBusinessDays(start, end) {
    if (!start || !end || end < start) { setTorBusinessDays(null); return }
    setTorCalculating(true)
    const { data, error } = await supabase.rpc('calculate_business_days', { p_start: start, p_end: end })
    if (error) { showToast(handleSupabaseError(error, 'Failed to calculate days.'), 'error'); setTorCalculating(false); return }
    setTorBusinessDays(data)
    setTorCalculating(false)
  }

  function handleDayPortionChange(portion) {
    setTorDayPortion(portion)
    if (portion !== 'full') {
      if (torStartDate) setTorEndDate(torStartDate)
      setTorBusinessDays(0.5)
      setTorCalculating(false)
    } else {
      setTorBusinessDays(null)
      if (torStartDate && torEndDate) calculateBusinessDays(torStartDate, torEndDate)
    }
  }

  async function submitTimeOffRequest() {
    if (!torStartDate || !torEndDate) { showToast('Please select start and end dates.', 'error'); return }
    if (torEndDate < torStartDate) { showToast('End date must be on or after start date.', 'error'); return }

    if (!torFlexibility) { showToast('Please select a flexibility option.', 'error'); return }

    const startDate = torStartDate
    const endDate = torEndDate
    const type = torType
    const notesVal = torNotes.trim()
    const dayPortion = torDayPortion
    const isHalfDay = dayPortion !== 'full'
    const businessDaysVal = isHalfDay ? 0.5 : torBusinessDays
    const volunteeringWith = torType === 'volunteer' ? torVolunteeringWith.trim() : null
    const flexibility = torFlexibility
    const flexibilityNote = torFlexibility === 'other' ? torFlexibilityNote.trim() : null

    if (businessDaysVal === null || torCalculating) { showToast('Calculating business days, please wait.', 'error'); return }

    setTorSubmitting(true)

    // Optimistic add to list
    const tempId = `temp-${Date.now()}`
    setTimeOffRequests(prev => [{
      id: tempId,
      employee_id: userProfile.employee_id,
      start_date: startDate,
      end_date: endDate,
      business_days: businessDaysVal,
      type,
      notes: notesVal || null,
      status: TIME_OFF_STATUS.PENDING,
      is_half_day: isHalfDay,
      day_portion: dayPortion,
      volunteering_with: volunteeringWith,
      flexibility,
      flexibility_note: flexibilityNote,
      created_at: new Date().toISOString(),
    }, ...prev])

    // Reset form fields but keep torSubmitting=true to prevent double-submit
    setTorStartDate('')
    setTorEndDate('')
    setTorType('personal_vacation')
    setTorNotes('')
    setTorBusinessDays(null)
    setTorDayPortion('full')
    setTorVolunteeringWith('')
    setTorFlexibility('')
    setTorFlexibilityNote('')

    const { data: newReq, error } = await supabase
      .from('time_off_requests')
      .insert({
        employee_id: userProfile.employee_id,
        start_date: startDate,
        end_date: endDate,
        business_days: businessDaysVal,
        type,
        notes: notesVal || null,
        status: TIME_OFF_STATUS.PENDING,
        is_half_day: isHalfDay,
        day_portion: dayPortion,
        volunteering_with: volunteeringWith,
        flexibility,
        flexibility_note: flexibilityNote,
      })
      .select()
      .single()

    setTorSubmitting(false)

    if (error) {
      setTimeOffRequests(prev => prev.filter(r => r.id !== tempId))
      showToast(handleSupabaseError(error, 'Failed to submit request.'), 'error')
      return
    }

    // Replace temp with real record
    setTimeOffRequests(prev => prev.map(r => r.id === tempId ? { ...newReq } : r))
    logAudit('time_off_requested', 'time_off_request', newReq.id, { type, days: businessDaysVal, start_date: startDate, end_date: endDate })

    // Send email to HR and manager (fire and forget)
    const employeeName = instance?.employees?.full_name || employee?.full_name || 'Employee'
    const total = timeOffBalance ? Number(timeOffBalance.total_days) : 0
    const used = timeOffBalance ? Number(timeOffBalance.used_days) : 0
    const currentPending = timeOffRequests.filter(r => r.status === TIME_OFF_STATUS.PENDING && r.id !== tempId).reduce((s, r) => s + Number(r.business_days), 0)
    const remainingAfter = total - used - currentPending - businessDaysVal

    const { data: overlapping } = await supabase
      .from('time_off_requests')
      .select('employee_id, start_date, end_date, employees!time_off_requests_employee_id_fkey(full_name)')
      .eq('status', TIME_OFF_STATUS.APPROVED)
      .neq('employee_id', userProfile.employee_id)
      .lte('start_date', endDate)
      .gte('end_date', startDate)

    const overlapList = (overlapping || [])
      .map(r => `${escapeHtml(r.employees?.full_name)}: ${fmtDateRange(r.start_date, r.end_date)}`)
      .join('<br/>')

    const dayPortionLabel = dayPortion === 'am' ? ' (AM)' : dayPortion === 'pm' ? ' (PM)' : ''
    const flexibilityLabel = FLEXIBILITY_OPTIONS.find(f => f.value === flexibility)?.label || flexibility
    const emailBody = `
<p><strong>${escapeHtml(employeeName)}</strong> has submitted a time off request.</p>
<p>
  <strong>Dates:</strong> ${fmtDateRange(startDate, endDate)}<br/>
  <strong>Type:</strong> ${escapeHtml(TYPE_LABELS[type] || type)}<br/>
  <strong>Business days:</strong> ${businessDaysVal}${dayPortionLabel}<br/>
  <strong>Flexibility:</strong> ${escapeHtml(flexibilityLabel)}${flexibilityNote ? ` — ${escapeHtml(flexibilityNote)}` : ''}<br/>
  <strong>Remaining balance if approved:</strong> ${remainingAfter}d${volunteeringWith ? `<br/><strong>Volunteering with:</strong> ${escapeHtml(volunteeringWith)}` : ''}${notesVal ? `<br/><strong>Notes:</strong> ${escapeHtml(notesVal)}` : ''}
</p>
${overlapList ? `<p><strong>Others approved off during this period:</strong><br/>${overlapList}</p>` : ''}
<p>Please review in the admin panel.</p>`

    await notifyHrAndManager({
      subject: `Time off request: ${employeeName}`,
      html: emailBody,
      managerId: instance?.employees?.manager_id || employee?.manager_id,
    })

    showToast('Request submitted.')
  }

  async function cancelTimeOffRequest(req) {
    setCancellingId(req.id)

    // Status change and balance refund happen atomically server-side.
    const { error } = await supabase.rpc('cancel_time_off_request', { p_request_id: req.id })
    if (error) { showToast(handleSupabaseError(error, 'Failed to cancel request.'), 'error'); setCancellingId(null); return }

    logAudit('time_off_cancelled', 'time_off_request', req.id, { type: req.type, days: req.business_days, previous_status: req.status })

    const employeeName = instance?.employees?.full_name || employee?.full_name || 'Employee'
    const cancelBody = `
<p><strong>${escapeHtml(employeeName)}</strong> has cancelled their time off request.</p>
<p>
  <strong>Dates:</strong> ${fmtDateRange(req.start_date, req.end_date)}<br/>
  <strong>Type:</strong> ${escapeHtml(TYPE_LABELS[req.type] || req.type)}<br/>
  <strong>Business days:</strong> ${req.business_days}<br/>
  <strong>Previous status:</strong> ${escapeHtml(req.status)}
</p>`

    await notifyHrAndManager({
      subject: `Time off cancelled: ${employeeName}`,
      html: cancelBody,
      managerId: instance?.employees?.manager_id || employee?.manager_id,
    })

    showToast('Request cancelled.')
    setCancellingId(null)
    setTimeOffFetched(false)
    await fetchTimeOffData()
  }

  async function submitTicket() {
    if (!ticketTitle.trim()) { showToast('Please enter a subject.', 'error'); return }
    if (!ticketDescription.trim()) { showToast('Please describe the issue.', 'error'); return }

    setTicketSubmitting(true)
    const employeeName = instance?.employees?.full_name || employee?.full_name || 'Employee'
    const employeeEmail = session?.user?.email || ''
    const categoryLabel = TICKET_CATEGORIES.find(c => c.value === ticketCategory)?.label || ticketCategory
    const timestamp = new Date().toLocaleString('en-CA', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })

    const techEmail = await getTechSupportEmail()

    const emailHtml = `
<p><strong>${escapeHtml(employeeName)}</strong> has submitted a technical support request.</p>
<p>
  <strong>Category:</strong> ${escapeHtml(categoryLabel)}<br/>
  <strong>Subject:</strong> ${escapeHtml(ticketTitle.trim())}<br/>
  <strong>Employee email:</strong> ${escapeHtml(employeeEmail)}<br/>
  <strong>Submitted:</strong> ${escapeHtml(timestamp)}
</p>
<p><strong>Description:</strong><br/>${escapeHtmlMultiline(ticketDescription.trim())}</p>`

    const [emailResult, dbResult] = await Promise.all([
      techEmail
        ? supabase.functions.invoke('send-email', {
            body: {
              to: techEmail,
              subject: `[Tech Support] ${categoryLabel}: ${ticketTitle.trim()} — ${employeeName}`,
              html: emailHtml,
            },
          })
        : Promise.resolve({ error: null }),
      supabase.from('tech_support_tickets').insert({
        employee_id: userProfile.employee_id,
        category: ticketCategory,
        title: ticketTitle.trim(),
        description: ticketDescription.trim(),
      }).select('id, created_at').single(),
    ])

    setTicketSubmitting(false)

    if (emailResult.error && dbResult.error) {
      showToast('Failed to submit ticket. Please try again.', 'error')
      return
    }

    setSubmittedTickets(prev => [{
      id: dbResult.data?.id || Date.now(),
      category: ticketCategory,
      categoryLabel,
      title: ticketTitle.trim(),
      description: ticketDescription.trim(),
      submittedAt: dbResult.data?.created_at || new Date().toISOString(),
    }, ...prev])

    setTicketTitle('')
    setTicketDescription('')
    setTicketCategory('software')
    showToast('Ticket submitted — we\'ll be in touch soon.')
  }

  const pendingDays = useMemo(
    () => timeOffRequests.filter(r => r.status === TIME_OFF_STATUS.PENDING).reduce((s, r) => s + Number(r.business_days), 0),
    [timeOffRequests]
  )

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

  const checkIcon = (size = 9) => (
    <svg width={size} height={size - 2} viewBox="0 0 10 8" fill="none">
      <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )

  const styles = {
    ...BASE_STYLES,
    topbar: { background: 'var(--surface)', boxShadow: '0 1px 0 var(--border)', padding: isMobile ? '0 16px' : '0 32px', height: isMobile ? '52px' : '60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    hero: { padding: isMobile ? '24px 16px 0' : '44px 40px 0', maxWidth: isMobile ? 'none' : '720px', margin: '0 auto' },
    name: { fontSize: isMobile ? '22px' : '26px', fontWeight: 600, letterSpacing: '-0.8px', marginBottom: '4px' },
    progressWrap: { marginTop: '20px', marginBottom: isMobile ? '20px' : '32px' },
    tabs: { display: 'flex', gap: '0', borderBottom: '1px solid var(--border)', padding: isMobile ? '0 16px' : '0 40px', maxWidth: isMobile ? 'none' : '720px', margin: '0 auto', overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' },
    tab: (active) => ({ fontSize: '13px', fontWeight: active ? 600 : 400, color: active ? 'var(--brand)' : 'var(--muted)', padding: '12px 0', marginRight: isMobile ? '18px' : '24px', background: 'none', border: 'none', borderBottom: active ? '2px solid var(--brand)' : '2px solid transparent', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0, transition: 'color 0.12s ease, border-color 0.12s ease' }),
    tabDisabled: { fontSize: '13px', fontWeight: 400, color: '#c4c3bf', padding: '12px 0', marginRight: isMobile ? '18px' : '24px', background: 'none', border: 'none', borderBottom: '2px solid transparent', cursor: 'default', fontFamily: 'inherit', pointerEvents: 'none', whiteSpace: 'nowrap', flexShrink: 0 },
    content: { padding: isMobile ? '20px 16px' : '28px 40px', maxWidth: isMobile ? 'none' : '720px', margin: '0 auto' },
    balCard: { background: 'var(--glass)', backdropFilter: 'var(--glass-filter)', WebkitBackdropFilter: 'var(--glass-filter)', border: '1px solid var(--glass-border)', borderRadius: T.radiusLg, padding: isMobile ? '16px' : '22px', marginBottom: '24px', boxShadow: 'var(--glass-highlight), var(--glass-shadow)' },
    balGrid: { display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: isMobile ? '12px' : '16px' },
    formCard: { background: 'var(--glass)', backdropFilter: 'var(--glass-filter)', WebkitBackdropFilter: 'var(--glass-filter)', border: '1px solid var(--glass-border)', borderRadius: T.radiusLg, padding: isMobile ? '16px' : '22px', marginBottom: '24px', boxShadow: 'var(--glass-highlight), var(--glass-shadow)' },
  }

  if (loading) return (
    <div style={styles.app}>
      <div className="il-header" data-topbar="true" style={styles.topbar}>
        <div style={styles.logo}>Integrated Launch</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {onSwitchToAdmin && (
            <button onClick={onSwitchToAdmin} style={{ fontSize: '12px', color: 'var(--brand)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
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

  const torTotal = timeOffBalance ? Number(timeOffBalance.total_days) : 0
  const torUsed = timeOffBalance ? Number(timeOffBalance.used_days) : 0
  const torPending = pendingDays
  const torRemaining = torTotal - torUsed - torPending
  const businessDaysPreview = torDayPortion !== 'full' ? 0.5 : torBusinessDays
  const torExceedsBalance = businessDaysPreview !== null && torRemaining - businessDaysPreview < 0
  const submitDisabled = torSubmitting || !torStartDate || !torEndDate || !torFlexibility || (torDayPortion === 'full' && (torBusinessDays === null || torCalculating))

  return (
    <div style={styles.app}>
      <div className="il-header" data-topbar="true" style={styles.topbar}>
        <div style={styles.logo}>Integrated Launch</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {onSwitchToAdmin && (
            <button onClick={onSwitchToAdmin} style={{ fontSize: '12px', color: 'var(--brand)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
              ← Admin view
            </button>
          )}
          <ThemeToggle compact />
          <button style={styles.signout} onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>

      <div style={styles.hero}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '4px' }}>
          <div style={{ width: '46px', height: '46px', borderRadius: '50%', ...avatarStyle(displayName), fontSize: '15px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, letterSpacing: '-0.2px', boxShadow: T.shadowSm }}>
            {getInitials(displayName)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={styles.name}>Welcome, {displayName.split(' ')[0]}</div>
            <div style={styles.sub}>
              {displayRole && `${displayRole} · `}
              {instance && displayHireDate
                ? `Started ${formatDate(displayHireDate)}`
                : (employee?.brand || userProfile?.brand || 'Integrated Staffing')}
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
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                <AnimatedNumber value={completedTasksCount} duration={500} /> of {totalTasks} tasks complete
              </span>
              <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--brand)' }}>
                {completedTasksCount === totalTasks && totalTasks > 0 ? 'All done 🎉' : `${totalTasks - completedTasksCount} left`}
              </span>
            </div>
            <div style={styles.progressTrack}>
              <div style={{ ...styles.progressFill, width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>

      <div style={styles.tabs}>
        {instance && <button style={styles.tab(activeTab === 'checklist')} onClick={() => setActiveTab('checklist')}>My checklist</button>}
        {instance && (
          <button style={styles.tab(activeTab === 'documents')} onClick={() => setActiveTab('documents')}>
            My Documents
            {unsignedDocCount > 0 && (
              <span className="il-tab-badge" style={{ background: activeTab === 'documents' ? 'var(--border)' : 'var(--hover-bg)', color: activeTab === 'documents' ? 'var(--text)' : 'var(--muted)' }}>
                {unsignedDocCount}
              </span>
            )}
          </button>
        )}
        <button style={styles.tab(activeTab === 'company-resources')} onClick={() => setActiveTab('company-resources')}>Company Resources</button>
        {FEATURES.employeeTimeOff
          ? <button style={styles.tab(activeTab === 'time-off')} onClick={() => setActiveTab('time-off')}>Time Off</button>
          : <button style={styles.tabDisabled} title="Coming soon">Time Off</button>}
        {FEATURES.techSupport
          ? <button style={styles.tab(activeTab === 'technical-tickets')} onClick={() => setActiveTab('technical-tickets')}>Tech Support</button>
          : <button style={styles.tabDisabled} title="Coming soon">Tech Support</button>}
        {isSalesRep(userProfile) && (
          <button style={styles.tab(activeTab === 'client-packages')} onClick={() => setActiveTab('client-packages')}>Client Packages</button>
        )}
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
                      {dateHint && <span style={{ fontSize: '11px', color: 'var(--subtle)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{dateHint}</span>}
                      {upcoming && <span style={{ fontSize: '10px', color: 'var(--subtle)', fontWeight: 500, background: 'var(--bg)', padding: '1px 6px', borderRadius: '3px', textTransform: 'none', letterSpacing: 0 }}>Upcoming</span>}
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
                              <span className="il-checkbox" style={styles.checkbox(isChecked)} aria-hidden="true">
                                {isChecked && checkIcon()}
                              </span>
                              <span style={styles.taskName(isChecked)}>{task.name}</span>
                              <span style={styles.subtaskCount}>{completedSubs}/{subtasks.length}</span>
                              <span style={styles.chevron(isExpanded)}>▶</span>
                            </button>
                          ) : (
                            <button type="button" className="il-row" aria-pressed={!!completions[task.id]}
                              aria-label={`Mark "${task.name}" ${completions[task.id] ? 'incomplete' : 'complete'}`}
                              style={{ ...styles.parentRow, width: '100%', background: 'none', border: 'none', borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', font: 'inherit' }}
                              onClick={(e) => toggleTask(task.id, completions[task.id], e)}>
                              <span className="il-checkbox" style={styles.checkbox(isChecked)} aria-hidden="true">
                                {isChecked && checkIcon()}
                              </span>
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
                                  <span className="il-checkbox" style={styles.subtaskCheckbox(completions[s.id])} aria-hidden="true">
                                    {completions[s.id] && checkIcon(7)}
                                  </span>
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
                    <div style={{ flex: 1, fontSize: '14px', color: 'var(--text)', fontWeight: 500 }}>{doc.name}</div>
                    <a href={doc.file_url} target="_blank" rel="noreferrer" style={{ fontSize: '12px', color: 'var(--muted)', textDecoration: 'underline', flexShrink: 0 }}>View</a>
                    {signed ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <span style={{ fontSize: '12px', color: 'var(--success)', fontWeight: 500 }}>✓ Received</span>
                        <button onClick={() => toggleDocument(doc.id)} style={{ fontSize: '11px', color: 'var(--subtle)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Undo</button>
                      </div>
                    ) : (
                      <button onClick={() => toggleDocument(doc.id)} style={{ fontSize: '12px', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: '5px', padding: '4px 10px', background: 'var(--surface)', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                        Mark as received
                      </button>
                    )}
                  </div>
                  <div style={{ marginTop: '10px' }}>
                    {completedFileUrl ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--success)' }}>✓ Uploaded</span>
                        <a href={completedFileUrl} target="_blank" rel="noreferrer" style={{ fontSize: '12px', color: 'var(--brand)', textDecoration: 'none' }}>View file</a>
                        <label style={{ fontSize: '12px', color: isUploading ? 'var(--subtle)' : 'var(--muted)', cursor: isUploading ? 'default' : 'pointer' }}>
                          {isUploading ? 'Uploading...' : 'Replace'}
                          <input type="file" style={{ display: 'none' }} accept=".pdf,.doc,.docx" onChange={e => handleEmployeeDocumentUpload(e, doc.id)} disabled={!!uploadingDocId} />
                        </label>
                      </div>
                    ) : (
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: isUploading ? 'var(--subtle)' : 'var(--brand)', cursor: isUploading ? 'default' : 'pointer', border: '1px solid ' + (isUploading ? 'var(--border)' : 'var(--brand-light)'), borderRadius: '6px', padding: '6px 12px', background: isUploading ? 'var(--surface-raised)' : 'var(--brand-light)' }}>
                        {!isUploading && <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 10V4M4 7l3-3 3 3"/><path d="M2 12h10"/></svg>}
                        {isUploading ? 'Uploading...' : 'Upload completed document'}
                        <input type="file" style={{ display: 'none' }} accept=".pdf,.doc,.docx" onChange={e => handleEmployeeDocumentUpload(e, doc.id)} disabled={!!uploadingDocId} />
                      </label>
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
                  <div style={{ position: 'relative', marginBottom: '16px' }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#a4a39f" strokeWidth="1.5" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                      <circle cx="6" cy="6" r="4"/><path d="M10 10l2.5 2.5"/>
                    </svg>
                    <input
                      type="text"
                      placeholder="Search resources…"
                      value={resourceSearch}
                      onChange={e => setResourceSearch(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--border)', borderRadius: '7px', padding: '8px 32px 8px 32px', fontSize: '13px', fontFamily: 'inherit', color: 'var(--text)', background: 'var(--surface)', outline: 'none' }}
                    />
                    {resourceSearch && (
                      <button onClick={() => setResourceSearch('')} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--subtle)', fontSize: '16px', lineHeight: 1, padding: 0 }}>×</button>
                    )}
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
                        const iconBg = ext === 'pdf' ? '#fff1f0' : ext === 'docx' || ext === 'doc' ? '#f0f7ff' : ext === 'xlsx' || ext === 'xls' ? '#f0faf4' : ext === 'pptx' || ext === 'ppt' ? '#fff8f0' : '#f4f3ef'
                        const iconStroke = ext === 'pdf' ? '#c04040' : ext === 'docx' || ext === 'doc' ? '#0066cc' : ext === 'xlsx' || ext === 'xls' ? '#1a7a4a' : ext === 'pptx' || ext === 'ppt' ? '#c27a30' : '#6b6b67'
                        return (
                          <a key={doc.id} href={doc.file_url} target="_blank" rel="noreferrer" className="il-resource-tile"
                            style={{ display: 'flex', flexDirection: 'column', background: 'var(--glass)', backdropFilter: 'var(--glass-filter)', WebkitBackdropFilter: 'var(--glass-filter)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--glass-highlight)', padding: '14px', textDecoration: 'none', color: 'var(--text)' }}>
                            <div style={{ width: '34px', height: '34px', borderRadius: '7px', background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px', flexShrink: 0 }}>
                              <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke={iconStroke} strokeWidth="1.5">
                                <path d="M3 2h6l3 3v7H3z"/><path d="M9 2v3h3"/>
                              </svg>
                            </div>
                            <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)', lineHeight: '1.4', flex: 1, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                              {doc.name}
                            </div>
                            <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                              <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--muted)', background: 'var(--hover-bg)', borderRadius: '3px', padding: '1px 5px' }}>{typeLabel}</span>
                              <span style={{ fontSize: '11px', color: 'var(--subtle)' }}>Open ↗</span>
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
                <SkeletonLine width="100%" height="100px" style={{ marginBottom: '20px', borderRadius: '10px' }} />
                <SkeletonLine width="100%" height="160px" style={{ marginBottom: '20px', borderRadius: '10px' }} />
                <SkeletonTaskRow /><SkeletonTaskRow />
              </>
            ) : (
              <>
                {/* Balance card or empty state */}
                {!timeOffBalance && timeOffRequests.length === 0 ? (
                  <div style={{ ...styles.balCard, textAlign: 'center', padding: '28px 20px' }}>
                    <div style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: 1.6 }}>
                      Your entitlement hasn't been set yet — contact HR.
                    </div>
                  </div>
                ) : (
                  <div style={styles.balCard}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--subtle)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '16px' }}>
                      {CURRENT_YEAR} Balance
                    </div>
                    <div style={styles.balGrid}>
                      <div style={styles.balStat}>
                        <div style={styles.balNum(false)}>{torTotal}</div>
                        <div style={styles.balLabel}>Total days</div>
                      </div>
                      <div style={styles.balStat}>
                        <div style={styles.balNum(false)}>{torUsed}</div>
                        <div style={styles.balLabel}>Used</div>
                      </div>
                      <div style={styles.balStat}>
                        <div style={{ ...styles.balNum(false), color: torPending > 0 ? '#b8740a' : '#18181b' }}>{torPending}</div>
                        <div style={styles.balLabel}>Pending</div>
                      </div>
                      <div style={styles.balStat}>
                        <div style={{ ...styles.balNum(torRemaining < 0), fontSize: '28px', color: torRemaining < 0 ? '#c04040' : '#0066cc' }}>{torRemaining}</div>
                        <div style={{ ...styles.balLabel, color: torRemaining < 0 ? '#c04040' : '#0066cc' }}>Remaining</div>
                        {torRemaining < 0 && <div style={{ fontSize: '10px', color: '#c04040', marginTop: '2px' }}>Over limit</div>}
                      </div>
                    </div>
                    {torTotal > 0 && (
                      <div style={{ marginTop: '14px', borderTop: '1px solid var(--border-subtle)', paddingTop: '14px' }}>
                        <div style={{ height: '5px', borderRadius: '3px', background: 'var(--border-subtle)', overflow: 'hidden', display: 'flex' }}>
                          {torUsed > 0 && <div style={{ width: `${Math.min(100, (torUsed / torTotal) * 100)}%`, background: 'var(--text)', transition: 'width 0.3s ease' }} />}
                          {torPending > 0 && <div style={{ width: `${Math.min(100 - (torUsed / torTotal) * 100, (torPending / torTotal) * 100)}%`, background: '#d4901a', transition: 'width 0.3s ease' }} />}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Request form */}
                <div style={styles.formCard}>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text)', marginBottom: '20px' }}>Request time off</div>

                  {/* Leave dates */}
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                    <div style={{ minWidth: 0 }}>
                      <label style={styles.fieldLabel}>Start date</label>
                      <input
                        type="date"
                        style={styles.fieldInput}
                        value={torStartDate}
                        onChange={e => {
                          setTorStartDate(e.target.value)
                          if (torDayPortion !== 'full') {
                            setTorEndDate(e.target.value)
                          } else if (torEndDate) {
                            calculateBusinessDays(e.target.value, torEndDate)
                          }
                        }}
                      />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <label style={styles.fieldLabel}>End date</label>
                      <input
                        type="date"
                        style={{ ...styles.fieldInput, ...(torDayPortion !== 'full' ? { background: 'var(--surface-raised)', color: 'var(--subtle)' } : {}) }}
                        value={torEndDate}
                        min={torStartDate || undefined}
                        disabled={torDayPortion !== 'full'}
                        onChange={e => {
                          setTorEndDate(e.target.value)
                          if (torStartDate) calculateBusinessDays(torStartDate, e.target.value)
                        }}
                      />
                    </div>
                  </div>

                  {/* AM / PM / Full day */}
                  <div style={{ marginBottom: '20px' }}>
                    <label style={styles.fieldLabel}>Duration</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {[{ value: 'full', label: 'Full day(s)' }, { value: 'am', label: 'AM' }, { value: 'pm', label: 'PM' }].map(opt => {
                        const active = torDayPortion === opt.value
                        return (
                          <button key={opt.value} onClick={() => handleDayPortionChange(opt.value)}
                            style={{ padding: '6px 14px', border: `1.5px solid ${active ? '#18181b' : '#e2e1dd'}`, borderRadius: '6px', background: active ? '#18181b' : '#fff', color: active ? '#fff' : '#70706b', fontSize: '13px', fontWeight: active ? 500 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                            {opt.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Type of leave */}
                  <div style={{ marginBottom: '20px' }}>
                    <label style={styles.fieldLabel}>Type of leave</label>
                    <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
                      {TYPE_OPTIONS.map((o, i) => {
                        const active = torType === o.value
                        return (
                          <label key={o.value} onClick={() => setTorType(o.value)}
                            style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 14px', cursor: 'pointer', background: active ? '#fafaf9' : '#fff', borderTop: i > 0 ? '1px solid var(--border-subtle)' : 'none' }}>
                            <div style={{ width: '16px', height: '16px', borderRadius: '50%', flexShrink: 0, border: `1.5px solid ${active ? '#18181b' : '#e2e1dd'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'border-color 0.12s' }}>
                              {active && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#18181b' }} />}
                            </div>
                            <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: active ? 500 : 400 }}>{o.label}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  {/* Volunteering with (conditional) */}
                  {torType === 'volunteer' && (
                    <div style={{ marginBottom: '20px' }}>
                      <label style={styles.fieldLabel}>Who will you be volunteering with?</label>
                      <input
                        type="text"
                        style={styles.fieldInput}
                        placeholder="Organization name"
                        value={torVolunteeringWith}
                        onChange={e => setTorVolunteeringWith(e.target.value)}
                        autoFocus
                      />
                    </div>
                  )}

                  {/* Notes */}
                  <div style={{ marginBottom: '20px' }}>
                    <label style={styles.fieldLabel}>Notes (optional)</label>
                    <textarea
                      style={{ ...styles.fieldInput, resize: 'vertical', minHeight: '64px' }}
                      placeholder="Any additional context..."
                      value={torNotes}
                      onChange={e => setTorNotes(e.target.value)}
                    />
                  </div>

                  {/* Flexibility */}
                  <div style={{ marginBottom: '20px' }}>
                    <label style={styles.fieldLabel}>Flexibility <span style={{ color: '#c04040' }}>*</span></label>
                    <div style={{ fontSize: '11px', color: 'var(--subtle)', marginBottom: '8px' }}>In case of conflicting business issues or overlapping leave requests</div>
                    <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
                      {FLEXIBILITY_OPTIONS.map((o, i) => {
                        const active = torFlexibility === o.value
                        return (
                          <label key={o.value} onClick={() => setTorFlexibility(o.value)}
                            style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 14px', cursor: 'pointer', background: active ? '#fafaf9' : '#fff', borderTop: i > 0 ? '1px solid var(--border-subtle)' : 'none' }}>
                            <div style={{ width: '16px', height: '16px', borderRadius: '50%', flexShrink: 0, border: `1.5px solid ${active ? '#18181b' : '#e2e1dd'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'border-color 0.12s' }}>
                              {active && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#18181b' }} />}
                            </div>
                            <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: active ? 500 : 400 }}>{o.label}</span>
                          </label>
                        )
                      })}
                    </div>
                    {torFlexibility === 'other' && (
                      <input
                        type="text"
                        style={{ ...styles.fieldInput, marginTop: '8px' }}
                        placeholder="Please describe..."
                        value={torFlexibilityNote}
                        onChange={e => setTorFlexibilityNote(e.target.value)}
                        autoFocus
                      />
                    )}
                  </div>

                  {/* Business days display */}
                  {torStartDate && torEndDate && (
                    <div style={{ marginBottom: '16px', fontSize: '13px', color: 'var(--muted)' }}>
                      {torDayPortion !== 'full' ? (
                        <span style={{ fontWeight: 500 }}>½ day ({torDayPortion.toUpperCase()})</span>
                      ) : torCalculating ? (
                        <span style={{ color: 'var(--subtle)' }}>Calculating...</span>
                      ) : torBusinessDays !== null ? (
                        <span><strong>{torBusinessDays}</strong> business day{torBusinessDays !== 1 ? 's' : ''}</span>
                      ) : null}
                    </div>
                  )}

                  {torExceedsBalance && (
                    <div style={{ fontSize: '12px', color: '#d4901a', background: '#fffbf0', border: '1px solid #f5e4b0', borderRadius: '6px', padding: '10px 12px', marginBottom: '16px' }}>
                      This request exceeds your remaining balance by {Math.abs(torRemaining - businessDaysPreview)}d. It can still be submitted.
                    </div>
                  )}

                  {torStartDate && torEndDate && torEndDate < torStartDate && (
                    <div className="il-field-hint" data-tone="error" style={{ marginBottom: '12px' }}>
                      End date must be on or after the start date.
                    </div>
                  )}

                  <button style={styles.submitBtn(submitDisabled)} disabled={submitDisabled} onClick={submitTimeOffRequest}>
                    {torSubmitting ? 'Submitting...' : 'Submit request'}
                  </button>
                  {submitDisabled && !torSubmitting && (
                    <div className="il-field-hint" data-tone="muted" style={{ marginTop: '8px' }}>
                      {!torStartDate || !torEndDate
                        ? 'Choose your start and end dates to continue.'
                        : !torFlexibility
                          ? 'Select a flexibility option to continue.'
                          : torCalculating
                            ? 'Calculating business days…'
                            : ''}
                    </div>
                  )}
                </div>

                {/* Request history */}
                <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text)', marginBottom: '12px' }}>History</div>
                {timeOffRequests.length === 0 ? (
                  <EmptyState compact icon={EmptyIcons.calendar} title="No requests yet"
                    message="Time off you request will appear here so you can track its status." />
                ) : (
                  timeOffRequests.map(req => (
                    <div key={req.id} style={{ ...styles.torRow, opacity: req.id?.toString().startsWith('temp-') ? 0.6 : 1 }}>
                      <div style={{ flex: 1, minWidth: '140px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <TypeIcon type={req.type} size={12} />
                          <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>
                            {fmtDateRange(req.start_date, req.end_date)}
                          </span>
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                          {TYPE_LABELS[req.type] || req.type} · {req.business_days}d{req.day_portion && req.day_portion !== 'full' ? ` (${req.day_portion.toUpperCase()})` : req.is_half_day ? ' (half day)' : ''}
                        </div>
                      </div>
                      <StatusPill status={req.status} />
                      {req.review_notes && (
                        <div style={{ fontSize: '11px', color: 'var(--muted)', fontStyle: 'italic', flex: 1 }}>
                          {req.review_notes}
                        </div>
                      )}
                      {(req.status === TIME_OFF_STATUS.PENDING || req.status === TIME_OFF_STATUS.APPROVED) && !req.id?.toString().startsWith('temp-') && (
                        <button
                          style={styles.cancelBtn}
                          disabled={cancellingId === req.id}
                          onClick={() => req.status === TIME_OFF_STATUS.APPROVED ? setConfirmCancelReq(req) : cancelTimeOffRequest(req)}
                        >
                          {cancellingId === req.id ? '...' : 'Cancel'}
                        </button>
                      )}
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'technical-tickets' && (
          <div className="il-tab-content">
            <div style={styles.formCard}>
              <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text)', marginBottom: '20px' }}>Submit a tech issue</div>

              <div style={{ marginBottom: '16px' }}>
                <label style={styles.fieldLabel}>Category</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {TICKET_CATEGORIES.map(opt => {
                    const active = ticketCategory === opt.value
                    return (
                      <button key={opt.value} onClick={() => setTicketCategory(opt.value)}
                        style={{ padding: '6px 12px', border: `1.5px solid ${active ? '#18181b' : '#e2e1dd'}`, borderRadius: '6px', background: active ? '#18181b' : '#fff', color: active ? '#fff' : '#70706b', fontSize: '12px', fontWeight: active ? 500 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={styles.fieldLabel}>Subject <span style={{ color: '#c04040' }}>*</span></label>
                <input
                  type="text"
                  style={styles.fieldInput}
                  placeholder="Brief description of the issue"
                  value={ticketTitle}
                  onChange={e => setTicketTitle(e.target.value)}
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={styles.fieldLabel}>Details <span style={{ color: '#c04040' }}>*</span></label>
                <textarea
                  style={{ ...styles.fieldInput, resize: 'vertical', minHeight: '100px' }}
                  placeholder="What happened? What were you trying to do? Any error messages?"
                  value={ticketDescription}
                  onChange={e => setTicketDescription(e.target.value)}
                />
              </div>

              <button
                style={styles.submitBtn(!ticketTitle.trim() || !ticketDescription.trim() || ticketSubmitting)}
                disabled={!ticketTitle.trim() || !ticketDescription.trim() || ticketSubmitting}
                onClick={submitTicket}
              >
                {ticketSubmitting ? 'Submitting…' : 'Submit ticket'}
              </button>
            </div>

            {submittedTickets.length > 0 && (
              <>
                <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text)', marginBottom: '12px' }}>Submitted this session</div>
                {submittedTickets.map(ticket => (
                  <div key={ticket.id} style={{ padding: '14px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 500, background: 'var(--bg)', color: 'var(--muted)', borderRadius: '4px', padding: '2px 7px' }}>{ticket.categoryLabel}</span>
                      <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>{ticket.title}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                      {new Date(ticket.submittedAt).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      <span style={{ marginLeft: '8px', color: '#1a7a4a', fontWeight: 500 }}>✓ Sent</span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {activeTab === 'client-packages' && (
          <div className="il-tab-content">
            <div style={{ border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '24px', background: T.surface, maxWidth: '520px' }}>
              <div style={{ ...T.type.h2, marginBottom: '8px' }}>Client onboarding packages</div>
              <p style={{ ...T.type.body, color: T.muted, margin: '0 0 20px' }}>
                Send a new client company their contract, health &amp; safety questionnaire, and
                staffing request form — then track what they've filled in and signed. This opens
                the client portal in a new tab; you'll be signed in automatically.
              </p>
              <button
                style={{
                  fontSize: '13px', fontWeight: 500, color: '#fff', background: T.brand,
                  border: 'none', borderRadius: T.radiusSm, padding: '9px 16px',
                  cursor: portalOpening ? 'default' : 'pointer', fontFamily: 'inherit',
                  opacity: portalOpening ? 0.6 : 1
                }}
                disabled={portalOpening}
                onClick={async () => {
                  if (portalOpening) return
                  setPortalOpening(true)
                  try {
                    await openClientPortal()
                    logAudit('client_portal_opened', 'client_portal', null, null)
                  } catch (err) {
                    showToast(err.message || 'Could not open the client portal.', 'error')
                  } finally {
                    setPortalOpening(false)
                  }
                }}
              >
                {portalOpening ? 'Opening…' : 'Open client portal'}
              </button>
            </div>
          </div>
        )}
      </div>

      {celebration && (
        <div style={{
          position: 'fixed', bottom: isMobile ? '80px' : '32px', left: '50%', transform: 'translateX(-50%)',
          background: '#18181b', color: '#fff', borderRadius: '12px',
          padding: '16px 24px', fontSize: '14px', fontWeight: 500,
          display: 'flex', alignItems: 'center', gap: '10px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.15)', zIndex: 1000,
          fontFamily: 'Inter, -apple-system, sans-serif',
          animation: 'slideUp 0.2s ease forwards',
          whiteSpace: 'nowrap',
        }}>
          <span style={{ fontSize: '20px' }}>{celebration === 'all' ? '🎉' : '✓'}</span>
          <span>{celebration === 'all' ? 'Onboarding complete! Great work.' : `${celebration} complete!`}</span>
        </div>
      )}

      {confirmCancelReq && (
        <ConfirmModal
          title="Cancel approved time off?"
          message={`This will remove ${confirmCancelReq.business_days} day(s) from your used balance. This can't be undone.`}
          confirmLabel="Yes, cancel it"
          confirmDanger
          onConfirm={async () => {
            await cancelTimeOffRequest(confirmCancelReq)
            setConfirmCancelReq(null)
          }}
          onCancel={() => setConfirmCancelReq(null)}
        />
      )}

      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onClose={hideToast} />}
    </div>
  )
}
