import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import useToast from './useToast'
import { handleSupabaseError } from '../utils/handleError'
import { logAudit } from '../utils/auditLog'
import { getHrEmail } from '../utils/getHrEmail'
import { normalizeTask, sortTasks } from '../utils/schedule'
import { attachResolvedUrls } from '../utils/documentUrls'
import { escapeHtml } from '../utils/escapeHtml'
import { formatDate } from '../utils/dates'
import { safeFileName } from '../utils/files'

export function useOnboardingPlan({ instanceId, onBack }) {
  const [instance, setInstance] = useState(null)
  const [tasks, setTasks] = useState([])
  const [completions, setCompletions] = useState({})
  const [notes, setNotes] = useState({})
  const [expanded, setExpanded] = useState(null)
  const [expandedTasks, setExpandedTasks] = useState({})
  const [documents, setDocuments] = useState([])
  const [docCompletions, setDocCompletions] = useState({})
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [modal, setModal] = useState(null)
  const [inviteSent, setInviteSent] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState(false)
  const [showHiddenDocs, setShowHiddenDocs] = useState(false)
  const [fetchError, setFetchError] = useState(null)
  const [noteSaveState, setNoteSaveState] = useState({})
  const { toast, showToast, hideToast } = useToast()
  const noteTimers = useRef({})
  const pendingNoteSaves = useRef({})

  const fetchPlan = useCallback(async () => {
    setFetchError(null)
    const { data, error } = await supabase
      .from('onboarding_instances')
      .select(`
        id, status,
        employees (id, full_name, email, hire_date, role_id, manager_id, brand, roles (name)),
        task_completions (
          id, completed, completed_at, notes, day, sort_order, custom_task_name, custom_owner,
          onboarding_templates (id, task_name, phase, owner, parent_id)
        )
      `)
      .eq('id', instanceId)
      .single()

    if (error) {
      setFetchError(handleSupabaseError(error, 'Failed to load onboarding plan.'))
      setLoading(false)
      return
    }

    setInstance(data)
    const comp = {}
    const nts = {}
    data.task_completions.forEach(tc => {
      comp[tc.id] = tc.completed
      nts[tc.id] = tc.notes || ''
    })
    setTasks(data.task_completions.map(normalizeTask))
    setCompletions(comp)
    setNotes(nts)
    setLoading(false)
  }, [instanceId])

  const fetchDocuments = useCallback(async () => {
    const { data: inst, error: instError } = await supabase
      .from('onboarding_instances')
      .select('employees (id, role_id)')
      .eq('id', instanceId)
      .single()

    if (instError || !inst) return

    const employeeId = inst.employees.id
    const roleId = inst.employees.role_id

    const { data: docs } = await supabase
      .from('documents')
      .select('*')
      .eq('is_company_resource', false)
      .or(`role_id.is.null,role_id.eq.${roleId}`)

    if (docs) setDocuments(docs)

    const { data: dc } = await supabase
      .from('document_completions')
      .select('*')
      .eq('employee_id', employeeId)

    const map = {}
    if (dc) dc.forEach(d => map[d.document_id] = d)
    setDocCompletions(await attachResolvedUrls(map))
  }, [instanceId])

  useEffect(() => {
    fetchPlan()
    fetchDocuments()
  }, [fetchPlan, fetchDocuments])

  useEffect(() => {
    const timers = noteTimers.current
    const pendingSaves = pendingNoteSaves.current
    return () => {
      Object.values(timers).forEach(clearTimeout)
      // Supabase queries are lazy: nothing is sent until the builder is
      // awaited or .then()'d. Without the .then() these saves never left the
      // browser, so a note typed just before navigating away was lost.
      Object.entries(pendingSaves).forEach(([id, value]) => {
        supabase.from('task_completions').update({ notes: value }).eq('id', id)
          .then(({ error }) => { if (error) console.error('Failed to save note on exit:', error) })
      })
    }
  }, [])

  async function toggleTask(completionId, current, e) {
    e.stopPropagation()
    const newVal = !current
    setCompletions(prev => ({ ...prev, [completionId]: newVal }))
    const { error } = await supabase
      .from('task_completions')
      .update({ completed: newVal, completed_at: newVal ? new Date().toISOString() : null })
      .eq('id', completionId)
    if (error) {
      setCompletions(prev => ({ ...prev, [completionId]: current }))
      showToast(handleSupabaseError(error, 'Failed to save task. Please try again.'), 'error')
    }
  }

  // Drag-and-drop: move `draggedId` into `targetBucket`, positioned before
  // `beforeId` (or appended when beforeId is null). Only top-level tasks move
  // between buckets; subtasks stay attached to their parent.
  async function moveTask(draggedId, targetBucket, beforeId) {
    const dragged = tasks.find(t => t.id === draggedId)
    if (!dragged || dragged.parentId) return
    if (beforeId === draggedId) return

    const targetList = tasks
      .filter(t => t.id !== draggedId && !t.parentId && t.bucket === targetBucket)
      .sort(sortTasks)

    let insertAt = beforeId ? targetList.findIndex(t => t.id === beforeId) : targetList.length
    if (insertAt === -1) insertAt = targetList.length

    const ordered = [
      ...targetList.slice(0, insertAt),
      { ...dragged, bucket: targetBucket },
      ...targetList.slice(insertAt),
    ]

    const orderMap = new Map(ordered.map((t, i) => [t.id, i]))
    const noChange = dragged.bucket === targetBucket && dragged.sortOrder === orderMap.get(draggedId)
      && targetList.every(t => t.sortOrder === orderMap.get(t.id))
    if (noChange) return

    setTasks(prev => prev.map(t => {
      if (t.id === draggedId) return { ...t, bucket: targetBucket, sortOrder: orderMap.get(t.id) ?? t.sortOrder }
      if (orderMap.has(t.id)) return { ...t, sortOrder: orderMap.get(t.id) }
      return t
    }))

    const results = await Promise.all(ordered.map((t, i) =>
      supabase.from('task_completions').update({ day: targetBucket, sort_order: i }).eq('id', t.id)
    ))
    const failed = results.find(r => r.error)
    if (failed) {
      showToast(handleSupabaseError(failed.error, 'Failed to move task. Please try again.'), 'error')
      fetchPlan()
    }
  }

  async function addTask(bucket, name, owner) {
    const trimmed = (name || '').trim()
    if (!trimmed) return
    const siblings = tasks.filter(t => !t.parentId && t.bucket === bucket)
    const sortOrder = siblings.length ? Math.max(...siblings.map(s => s.sortOrder)) + 1 : 0

    const { data, error } = await supabase
      .from('task_completions')
      .insert({
        instance_id: instanceId,
        template_task_id: null,
        completed: false,
        day: bucket,
        sort_order: sortOrder,
        custom_task_name: trimmed,
        custom_owner: owner || null,
      })
      .select('id, completed, completed_at, notes, day, sort_order, custom_task_name, custom_owner')
      .single()

    if (error) {
      showToast(handleSupabaseError(error, 'Failed to add task.'), 'error')
      return
    }
    const newTask = normalizeTask({ ...data, onboarding_templates: null })
    setTasks(prev => [...prev, newTask])
    setCompletions(prev => ({ ...prev, [data.id]: false }))
    setNotes(prev => ({ ...prev, [data.id]: '' }))
    if (instance) {
      logAudit('task_added', 'task_completion', data.id, { employee_name: instance.employees.full_name, task_name: trimmed, day: bucket })
    }
    showToast('Task added')
  }

  async function editTask(taskId, name, owner) {
    const trimmed = (name || '').trim()
    if (!trimmed) return
    const { error } = await supabase
      .from('task_completions')
      .update({ custom_task_name: trimmed, custom_owner: owner || null })
      .eq('id', taskId)
    if (error) {
      showToast(handleSupabaseError(error, 'Failed to save task.'), 'error')
      return
    }
    setTasks(prev => prev.map(t => t.id === taskId
      ? { ...t, name: trimmed, owner: owner || null }
      : t))
    showToast('Task updated')
  }

  function removeTask(taskId) {
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    const subIds = tasks.filter(s => s.parentId && s.parentId === task.templateId).map(s => s.id)
    const ids = [taskId, ...subIds]
    setModal({
      title: 'Remove task',
      message: `Remove "${task.name}" from ${instance.employees.full_name}'s plan? This only affects this employee, not the role template.`,
      confirmLabel: 'Remove',
      confirmDanger: true,
      onConfirm: async () => {
        const { error } = await supabase.from('task_completions').delete().in('id', ids)
        if (error) {
          showToast(handleSupabaseError(error, 'Failed to remove task.'), 'error')
          setModal(null)
          return
        }
        setTasks(prev => prev.filter(t => !ids.includes(t.id)))
        if (instance) {
          logAudit('task_removed', 'task_completion', taskId, { employee_name: instance.employees.full_name, task_name: task.name })
        }
        setModal(null)
        showToast('Task removed')
      }
    })
  }

  async function saveNote(completionId, value) {
    setNoteSaveState(prev => ({ ...prev, [completionId]: 'saving' }))
    const { error } = await supabase
      .from('task_completions')
      .update({ notes: value })
      .eq('id', completionId)
    if (error) {
      showToast(handleSupabaseError(error, 'Failed to save note.'), 'error')
      setNoteSaveState(prev => ({ ...prev, [completionId]: null }))
    } else {
      setNoteSaveState(prev => ({ ...prev, [completionId]: 'saved' }))
      setTimeout(() => setNoteSaveState(prev => {
        const next = { ...prev }
        if (next[completionId] === 'saved') delete next[completionId]
        return next
      }), 2000)
    }
  }

  function handleNoteChange(completionId, value) {
    setNotes(prev => ({ ...prev, [completionId]: value }))
    pendingNoteSaves.current[completionId] = value
    clearTimeout(noteTimers.current[completionId])
    noteTimers.current[completionId] = setTimeout(() => {
      saveNote(completionId, value)
      delete pendingNoteSaves.current[completionId]
    }, 1000)
  }

  async function toggleDocument(docId, e) {
    e.stopPropagation()
    const employeeId = instance.employees.id
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
        showToast(handleSupabaseError(error, 'Failed to update document. Please try again.'), 'error')
      }
    } else {
      const { data, error } = await supabase
        .from('document_completions')
        .insert({ employee_id: employeeId, document_id: docId, signed: true, received: true, completed_at: new Date().toISOString() })
        .select().single()
      if (error) showToast(handleSupabaseError(error, 'Failed to update document. Please try again.'), 'error')
      else if (data) setDocCompletions(prev => ({ ...prev, [docId]: data }))
    }
  }

  async function hideDocument(docId) {
    const docName = documents.find(d => d.id === docId)?.name || 'this document'
    setModal({
      title: 'Hide document',
      message: `"${docName}" will be hidden for this employee. You can restore it using "Show hidden."`,
      confirmLabel: 'Hide',
      confirmDanger: false,
      onConfirm: async () => {
        const employeeId = instance.employees.id
        const existing = docCompletions[docId]
        if (existing) {
          const { error } = await supabase.from('document_completions').update({ hidden: true }).eq('id', existing.id)
          if (error) { showToast(handleSupabaseError(error, 'Failed to hide document.'), 'error'); setModal(null); return }
          setDocCompletions(prev => ({ ...prev, [docId]: { ...existing, hidden: true } }))
        } else {
          const { data, error } = await supabase
            .from('document_completions')
            .insert({ employee_id: employeeId, document_id: docId, hidden: true, signed: false, received: false })
            .select().single()
          if (error) { showToast(handleSupabaseError(error, 'Failed to hide document.'), 'error'); setModal(null); return }
          if (data) setDocCompletions(prev => ({ ...prev, [docId]: data }))
        }
        await logAudit('document_hidden', 'document', docId, { employee_name: instance.employees.full_name })
        setModal(null)
        showToast('Document hidden for this employee')
      }
    })
  }

  async function restoreDocument(docId) {
    const existing = docCompletions[docId]
    if (existing) {
      const { error } = await supabase.from('document_completions').update({ hidden: false }).eq('id', existing.id)
      if (error) { showToast(handleSupabaseError(error, 'Failed to restore document.'), 'error'); return }
      setDocCompletions(prev => ({ ...prev, [docId]: { ...existing, hidden: false } }))
      await logAudit('document_restored', 'document', docId, { employee_name: instance.employees.full_name })
      showToast('Document restored')
    }
  }

  async function handleUploadDocument(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    const filePath = `documents/${Date.now()}_${safeFileName(file.name)}`
    const { error: uploadError } = await supabase.storage.from('documents').upload(filePath, file)
    if (uploadError) {
      showToast(handleSupabaseError(uploadError, 'Upload failed. Please try again.'), 'error')
      setUploading(false)
      return
    }
    const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath)
    const { error: insertError } = await supabase.from('documents').insert({ name: file.name, file_url: urlData.publicUrl })
    if (insertError) {
      showToast(handleSupabaseError(insertError, 'Failed to save document.'), 'error')
      await supabase.storage.from('documents').remove([filePath])
    } else {
      showToast('Uploaded and added to every employee\'s documents')
      await fetchDocuments()
    }
    setUploading(false)
    e.target.value = ''
  }

  const parentTasks = tasks.filter(t => !t.parentId)

  function subtasksFor(parent) {
    return tasks.filter(s => s.parentId && s.parentId === parent.templateId)
  }

  function isTaskComplete(parent) {
    const subs = subtasksFor(parent)
    if (subs.length === 0) return !!completions[parent.id]
    return subs.every(s => completions[s.id])
  }

  function totalTasks() {
    return parentTasks.length
  }

  function completedTasksCount() {
    return parentTasks.filter(isTaskComplete).length
  }

  function pct() {
    const t = totalTasks()
    return t > 0 ? Math.round((completedTasksCount() / t) * 100) : 0
  }

  async function handleMarkComplete() {
    setModal({
      title: 'Mark as complete',
      message: `This will mark ${instance.employees.full_name}'s onboarding as complete and remove it from the active list.`,
      confirmLabel: 'Mark complete',
      confirmDanger: false,
      onConfirm: async () => {
        const { error } = await supabase.from('onboarding_instances').update({ status: 'completed' }).eq('id', instanceId)
        if (error) { showToast(handleSupabaseError(error, 'Failed to mark as complete.'), 'error'); setModal(null); return }
        await logAudit('onboarding_completed', 'onboarding_instance', instanceId, { employee_name: instance.employees.full_name })
        const hrEmail = await getHrEmail()
        if (hrEmail) supabase.functions.invoke('send-email', {
          body: {
            to: hrEmail,
            subject: `Onboarding complete: ${instance.employees.full_name}`,
            html: `
              <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #18181b;">
                <h2 style="font-size: 18px; font-weight: 600; margin-bottom: 16px;">Onboarding marked complete</h2>
                <p style="font-size: 14px; color: #444; line-height: 1.6;"><strong>${escapeHtml(instance.employees.full_name)}</strong> has completed their onboarding plan.</p>
                <table style="font-size: 14px; color: #444; margin-top: 16px;">
                  <tr><td style="padding: 4px 16px 4px 0; color: #888;">Role</td><td>${escapeHtml(instance.employees.roles?.name || 'N/A')}</td></tr>
                  <tr><td style="padding: 4px 16px 4px 0; color: #888;">Started</td><td>${formatDate(instance.employees.hire_date)}</td></tr>
                  <tr><td style="padding: 4px 16px 4px 0; color: #888;">Completed</td><td>${formatDate(new Date())}</td></tr>
                  <tr><td style="padding: 4px 16px 4px 0; color: #888;">Tasks completed</td><td>${completedTasksCount()} of ${totalTasks()}</td></tr>
                </table>
                <p style="font-size: 13px; color: #888; margin-top: 32px;">Sent by Integrated Launch</p>
              </div>
            `
          }
        }).then(({ error: emailError }) => { if (emailError) console.error('Completion email failed:', emailError) })
        setModal(null)
        onBack()
      }
    })
  }

  async function handleArchive() {
    setModal({
      title: 'Archive onboarding',
      message: `This will archive ${instance.employees.full_name}'s onboarding and remove it from the active list. You can still view it in History.`,
      confirmLabel: 'Archive',
      confirmDanger: true,
      onConfirm: async () => {
        const { error } = await supabase.from('onboarding_instances').update({ status: 'archived' }).eq('id', instanceId)
        if (error) { showToast(handleSupabaseError(error, 'Failed to archive onboarding.'), 'error'); setModal(null); return }
        await logAudit('onboarding_archived', 'onboarding_instance', instanceId, { employee_name: instance.employees.full_name })
        setModal(null)
        onBack()
      }
    })
  }

  async function handleDeleteEmployee() {
    setModal({
      title: 'Delete employee',
      message: `This will permanently delete ${instance.employees.full_name} and all their onboarding data including their portal access. This cannot be undone.`,
      confirmLabel: 'Delete permanently',
      confirmDanger: true,
      onConfirm: async () => {
        const fail = (error, message) => {
          showToast(handleSupabaseError(error, message), 'error')
          setModal(null)
        }
        // Portal login first: if that can't be removed, stop before deleting
        // the records it points at, rather than leaving an orphaned login.
        const { data: fnData, error: fnError } = await supabase.functions.invoke('delete-user', { body: { employeeId: instance.employees.id } })
        if (fnError || fnData?.error) return fail(fnError || { message: fnData.error }, 'Could not remove their portal access, so nothing was deleted.')
        const { error: instError } = await supabase.from('onboarding_instances').delete().eq('id', instanceId)
        if (instError) return fail(instError, 'Failed to delete the onboarding plan.')
        const { error: empError } = await supabase.from('employees').delete().eq('id', instance.employees.id)
        if (empError) return fail(empError, 'The onboarding plan was deleted, but the employee record could not be.')
        await logAudit('employee_deleted', 'employee', instance.employees.id, { employee_name: instance.employees.full_name })
        setModal(null)
        onBack()
      }
    })
  }

  async function handleInviteEmployee() {
    if (!instance.employees.email) {
      showToast('This employee has no email address on file.', 'error')
      return
    }
    setInviting(true)
    const { data, error } = await supabase.functions.invoke('invite-employee', {
      body: { email: instance.employees.email, employeeId: instance.employees.id, brand: instance.employees.brand || 'ISL' }
    })
    if (error || data?.error) {
      showToast(data?.error || 'Failed to send invite. Please try again.', 'error')
    } else {
      if (data?.alreadyInvited) {
        showToast('This employee already has portal access.', 'success')
      } else {
        setInviteSent(true)
      }
    }
    setInviting(false)
  }

  return {
    instance, setInstance,
    tasks,
    parentTasks,
    subtasksFor,
    isTaskComplete,
    completions,
    notes,
    expanded, setExpanded,
    expandedTasks, setExpandedTasks,
    documents,
    docCompletions,
    loading,
    uploading,
    modal, setModal,
    inviteSent,
    inviting,
    editingEmployee, setEditingEmployee,
    showHiddenDocs, setShowHiddenDocs,
    fetchError,
    noteSaveState,
    toast, hideToast,
    noteTimers,
    fetchPlan,
    toggleTask,
    moveTask,
    addTask,
    editTask,
    removeTask,
    saveNote,
    handleNoteChange,
    toggleDocument,
    hideDocument,
    restoreDocument,
    handleUploadDocument,
    handleMarkComplete,
    handleArchive,
    handleDeleteEmployee,
    handleInviteEmployee,
    totalTasks,
    completedTasksCount,
    pct,
  }
}
