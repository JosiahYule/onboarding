import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabaseClient'
import Layout from '../components/Layout'
import ConfirmModal from '../components/ConfirmModal'
import Toast from '../components/Toast'
import useToast from '../hooks/useToast'
import { handleSupabaseError } from '../utils/handleError'
import { logAudit } from '../utils/auditLog'
import { useWindowSize } from '../hooks/useWindowSize'
import { PHASES, BUCKET_SECTIONS, ONBOARDING_STATUS, BRANDS, BRAND_CODES, brandName } from '../config'
import { T } from '../ui/theme'
import PageHeader from '../ui/PageHeader'
import Button from '../ui/Button'
import Segmented from '../ui/Segmented'
import FileButton from '../ui/FileButton'
import EmptyState, { EmptyIcons } from '../ui/EmptyState'
import { SkeletonLine } from '../components/Skeleton'
import { humanize } from '../utils/formatUtils'
import { formatDate } from '../utils/dates'
import { safeFileName } from '../utils/files'

const OWNERS = ['HR', 'Manager', 'IT']

// Order tasks within a phase by their saved sort_order, falling back to name so
// unranked (sort_order 0) tasks stay stable until an admin drags them.
function sortTemplates(a, b) {
  const ao = a.sort_order ?? 0
  const bo = b.sort_order ?? 0
  if (ao !== bo) return ao - bo
  return a.task_name.localeCompare(b.task_name)
}

const BASE_STYLES = {
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' },
  rowName: { fontSize: '13px', color: T.text },
  rowMuted: { fontSize: '12px', color: T.subtle },
  phaseLabel: { fontSize: '11px', fontWeight: 600, color: T.subtle, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px', marginTop: '24px' },
  pill: { fontSize: '11px', padding: '2px 8px', borderRadius: '5px', background: 'var(--hover-bg)', color: T.muted, fontWeight: 500 },
  dragHandle: { color: T.subtle, fontSize: '13px', lineHeight: 1, flexShrink: 0, userSelect: 'none', padding: '4px', margin: '-4px 2px -4px -4px' },
}


export default function Admin({ session, userProfile, initialTab, onBack, onNavigate, onStartOnboarding, onViewOnboarding }) {
  const [roles, setRoles] = useState([])
  const [selectedRole, setSelectedRole] = useState(null)
  const [templates, setTemplates] = useState([])
  const [documents, setDocuments] = useState([])
  const [companyResources, setCompanyResources] = useState([])
  const [uploadingResource, setUploadingResource] = useState(false)
  const [history, setHistory] = useState([])
  const [modal, setModal] = useState(null)

  const [newRoleName, setNewRoleName] = useState('')
  const [newRoleBrand, setNewRoleBrand] = useState('ISL')
  const [newTaskName, setNewTaskName] = useState('')
  const [newTaskOwner, setNewTaskOwner] = useState('HR')
  const [newSubtaskName, setNewSubtaskName] = useState('')
  const [addingSubtaskTo, setAddingSubtaskTo] = useState(null)
  const [editingTask, setEditingTask] = useState(null)
  const [editingTaskName, setEditingTaskName] = useState('')
  const [pickedBrand, setPickedBrand] = useState('')
  const [pickedRoleId, setPickedRoleId] = useState('')
  const { toast, showToast, hideToast } = useToast()
  const { isMobile } = useWindowSize()
  const [taskLibrary, setTaskLibrary] = useState([])
  const [uploadDocRole, setUploadDocRole] = useState('')
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [historyFilter, setHistoryFilter] = useState('all')
  const [renamingDocId, setRenamingDocId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [addingTaskToPhase, setAddingTaskToPhase] = useState(null)
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkPhase, setBulkPhase] = useState('Day 1')
  const [bulkOwner, setBulkOwner] = useState('HR')
  const [templateCounts, setTemplateCounts] = useState({})
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [draggingTaskId, setDraggingTaskId] = useState(null)
  const [tplDropTarget, setTplDropTarget] = useState(null)
  const [draggingSubtaskId, setDraggingSubtaskId] = useState(null)
  const [subDropTarget, setSubDropTarget] = useState(null)
  const [flashTemplateId, setFlashTemplateId] = useState(null)
  const flashTemplateTimer = useRef(null)
  // Which lists have finished their first load, so an empty state isn't
  // flashed ("No documents yet") while the request is still in flight.
  const [loaded, setLoaded] = useState({})
  const markLoaded = key => setLoaded(prev => (prev[key] ? prev : { ...prev, [key]: true }))

  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchRoles is stable, mount-only fetch
  useEffect(() => { fetchRoles() }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchTemplates is stable, re-fetch on role change
  useEffect(() => { if (selectedRole) fetchTemplates(selectedRole.id) }, [selectedRole])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch functions are stable, re-fetch on tab change
  useEffect(() => {
    if (initialTab === 'documents') fetchDocuments()
    else if (initialTab === 'company-resources') fetchCompanyResources()
    else if (initialTab === 'history') fetchHistory()
    else if (initialTab === 'templates') { fetchTaskLibrary(); fetchTemplateCounts() }
  }, [initialTab])

  useEffect(() => {
    if (!libraryOpen) return
    const onKey = e => { if (e.key === 'Escape') setLibraryOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [libraryOpen])

  useEffect(() => () => clearTimeout(flashTemplateTimer.current), [])

  // Open the templates page on the first role rather than an empty panel.
  useEffect(() => {
    if (initialTab !== 'templates' || selectedRole || roles.length === 0) return
    const first = BRAND_CODES.flatMap(b => roles.filter(r => r.brand === b))[0] || roles[0]
    setSelectedRole(first)
  }, [initialTab, roles, selectedRole])

  // Native HTML5 drag doesn't auto-scroll the window in every browser, and a
  // role's task list can be long — nudge the viewport when the drag pointer
  // nears the top or bottom edge.
  useEffect(() => {
    if (!draggingTaskId && !draggingSubtaskId) return
    const EDGE = 90
    const onDragOver = (e) => {
      const y = e.clientY
      const h = window.innerHeight
      if (y < EDGE) window.scrollBy(0, -Math.ceil((EDGE - y) / 4))
      else if (y > h - EDGE) window.scrollBy(0, Math.ceil((y - (h - EDGE)) / 4))
    }
    window.addEventListener('dragover', onDragOver)
    return () => window.removeEventListener('dragover', onDragOver)
  }, [draggingTaskId, draggingSubtaskId])

  async function fetchRoles() {
    const { data, error } = await supabase.from('roles').select('*').order('name')
    if (error) showToast(handleSupabaseError(error, 'Failed to load roles.'), 'error')
    if (data) setRoles(data)
    markLoaded('roles')
  }

  async function fetchTemplates(roleId) {
    const { data, error } = await supabase
      .from('onboarding_templates')
      .select('*')
      .eq('role_id', roleId)
      .order('phase')
      .order('sort_order')
      .order('task_name')
    if (error) showToast(handleSupabaseError(error, 'Failed to load tasks.'), 'error')
    if (data) setTemplates(data)
  }

  async function fetchDocuments() {
    const { data, error } = await supabase.from('documents').select('*').eq('is_company_resource', false).order('uploaded_at', { ascending: false })
    if (error) showToast(handleSupabaseError(error, 'Failed to load documents.'), 'error')
    if (data) setDocuments(data)
    markLoaded('documents')
  }

  async function fetchCompanyResources() {
    const { data, error } = await supabase.from('documents').select('*').eq('is_company_resource', true).order('uploaded_at', { ascending: false })
    if (error) showToast(handleSupabaseError(error, 'Failed to load company resources.'), 'error')
    if (data) setCompanyResources(data)
    markLoaded('resources')
  }

  async function fetchHistory() {
    const { data, error } = await supabase
      .from('onboarding_instances')
      .select('id, status, started_at, employees (full_name, email, hire_date, roles (name))')
      .in('status', [ONBOARDING_STATUS.COMPLETED, ONBOARDING_STATUS.ARCHIVED])
      .order('started_at', { ascending: false })
    if (error) showToast(handleSupabaseError(error, 'Failed to load history.'), 'error')
    if (data) setHistory(data.filter(h => h.employees))
    markLoaded('history')
  }

  async function fetchTaskLibrary() {
  const { data } = await supabase.from('task_library').select('*').order('task_name')
  if (data) setTaskLibrary(data)
}

async function fetchTemplateCounts() {
  const { data } = await supabase.from('onboarding_templates').select('role_id, parent_id')
  if (!data) return
  const counts = {}
  data.filter(t => !t.parent_id).forEach(t => { counts[t.role_id] = (counts[t.role_id] || 0) + 1 })
  setTemplateCounts(counts)
}

async function addRole() {
  if (!newRoleName.trim()) return
  const { error } = await supabase.from('roles').insert({ name: newRoleName.trim(), brand: newRoleBrand })
  if (error) {
    showToast(handleSupabaseError(error, 'Failed to add role.'), 'error')
  } else {
    showToast('Role added')
    setNewRoleName('')
    fetchRoles()
  }
}

  async function deleteRole(id, name) {
    setModal({
      title: 'Delete role',
      message: `This will permanently delete the "${name}" role and all its task templates. This cannot be undone.`,
      confirmLabel: 'Delete role',
      confirmDanger: true,
      onConfirm: async () => {
        // Deleting the templates first and the role second used to leave a
        // role with no template behind whenever the second step failed (most
        // often because employees still hold the role). Check that up front,
        // and stop at the first error.
        const { count, error: countError } = await supabase
          .from('employees').select('id', { count: 'exact', head: true }).eq('role_id', id)
        if (countError) { showToast(handleSupabaseError(countError, 'Failed to delete role.'), 'error'); setModal(null); return }
        if (count > 0) {
          showToast(`${count} employee${count === 1 ? ' is' : 's are'} assigned "${name}". Move them to another role first.`, 'error')
          setModal(null)
          return
        }
        const { error: tplError } = await supabase.from('onboarding_templates').delete().eq('role_id', id)
        if (tplError) { showToast(handleSupabaseError(tplError, 'Failed to delete the role\'s tasks.'), 'error'); setModal(null); return }
        const { error: roleError } = await supabase.from('roles').delete().eq('id', id)
        if (roleError) { showToast(handleSupabaseError(roleError, 'Failed to delete role.'), 'error'); setModal(null); fetchTemplateCounts(); return }
        logAudit('role_deleted', 'role', id, { role_name: name })
        if (selectedRole?.id === id) setSelectedRole(null)
        setModal(null)
        showToast('Role deleted')
        fetchRoles()
      }
    })
  }

  async function addTask(phase) {
    if (!newTaskName.trim() || !selectedRole) return

    const siblings = templates.filter(t => t.phase === phase && !t.parent_id)
    const sortOrder = siblings.length ? Math.max(...siblings.map(s => s.sort_order ?? 0)) + 1 : 0

    const { data: newTask, error: insertError } = await supabase
      .from('onboarding_templates')
      .insert({ role_id: selectedRole.id, task_name: newTaskName.trim(), phase, owner: newTaskOwner, sort_order: sortOrder })
      .select().single()
    if (insertError) { showToast(handleSupabaseError(insertError, 'Failed to add task.'), 'error'); return }

    const addedName = newTaskName.trim()
    setNewTaskName('')
    setAddingTaskToPhase(null)
    fetchTemplates(selectedRole.id)
    fetchTemplateCounts()
    if (!newTask) return

    if (!taskLibrary.some(t => t.task_name.toLowerCase() === addedName.toLowerCase())) {
      await supabase.from('task_library').insert({ task_name: addedName })
      fetchTaskLibrary()
    }

    const { data: roleEmployees } = await supabase.from('employees').select('id').eq('role_id', selectedRole.id)
    if (!roleEmployees || roleEmployees.length === 0) return

    const { data: activeInstances } = await supabase
      .from('onboarding_instances')
      .select('id, employees (full_name)')
      .eq('status', ONBOARDING_STATUS.ACTIVE)
      .in('employee_id', roleEmployees.map(e => e.id))

    if (activeInstances && activeInstances.length > 0) {
      setModal({
        title: 'Sync to active onboardings?',
        message: `${activeInstances.length} active onboarding${activeInstances.length > 1 ? 's' : ''} for ${selectedRole.name} will not have this task unless you sync. Add "${newTask.task_name}" to all active ${selectedRole.name} onboardings?`,
        confirmLabel: 'Yes, add to all',
        confirmDanger: false,
        onConfirm: async () => {
          const { error } = await supabase.from('task_completions').insert(
            activeInstances.map(inst => ({ instance_id: inst.id, template_task_id: newTask.id, completed: false, day: newTask.phase, sort_order: 0 }))
          )
          setModal(null)
          if (error) showToast(handleSupabaseError(error, 'Failed to add the task to active onboardings.'), 'error')
          else showToast(`Added to ${activeInstances.length} active onboarding${activeInstances.length > 1 ? 's' : ''}`)
        }
      })
    }
  }

  // Briefly highlight a task row after it lands in a new spot.
  function flashTemplate(id) {
    clearTimeout(flashTemplateTimer.current)
    setFlashTemplateId(id)
    flashTemplateTimer.current = setTimeout(() => setFlashTemplateId(null), 1200)
  }

  // Drag-and-drop reordering of a role's task template. Moves `draggedId` into
  // `targetPhase`, positioned before `beforeId` (appended when beforeId is
  // null), and persists the new positions as sort_order so the arrangement
  // becomes the default for that role. Only top-level tasks move between days;
  // subtasks stay attached to their parent.
  async function moveTemplate(draggedId, targetPhase, beforeId) {
    const dragged = templates.find(t => t.id === draggedId)
    if (!dragged || dragged.parent_id) return
    if (beforeId === draggedId) return

    const targetList = templates
      .filter(t => t.id !== draggedId && !t.parent_id && t.phase === targetPhase)
      .sort(sortTemplates)

    let insertAt = beforeId ? targetList.findIndex(t => t.id === beforeId) : targetList.length
    if (insertAt === -1) insertAt = targetList.length

    const ordered = [
      ...targetList.slice(0, insertAt),
      { ...dragged, phase: targetPhase },
      ...targetList.slice(insertAt),
    ]

    const orderMap = new Map(ordered.map((t, i) => [t.id, i]))
    const noChange = dragged.phase === targetPhase && (dragged.sort_order ?? 0) === orderMap.get(draggedId)
      && targetList.every(t => (t.sort_order ?? 0) === orderMap.get(t.id))
    if (noChange) return

    // Optimistic reorder so the list responds instantly.
    setTemplates(prev => prev.map(t => {
      if (t.id === draggedId) return { ...t, phase: targetPhase, sort_order: orderMap.get(t.id) }
      if (orderMap.has(t.id)) return { ...t, sort_order: orderMap.get(t.id) }
      return t
    }))

    const results = await Promise.all(ordered.map((t, i) =>
      supabase.from('onboarding_templates').update({ phase: targetPhase, sort_order: i }).eq('id', t.id)
    ))
    const failed = results.find(r => r.error)
    if (failed) {
      showToast(handleSupabaseError(failed.error, 'Failed to reorder tasks. Please try again.'), 'error')
      fetchTemplates(selectedRole.id)
    }
  }

  function handleTaskDragStart(e, task) {
    setDraggingTaskId(task.id)
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', task.id) } catch (_) { /* some browsers require this call */ }
  }
  function handleTaskDragEnd() { setDraggingTaskId(null); setTplDropTarget(null) }
  function handleTaskRowDragOver(e, task, index, phaseTasks) {
    if (!draggingTaskId) return
    e.preventDefault(); e.stopPropagation()
    // Top half of the row inserts before it, bottom half inserts after
    // (i.e. before the next row, or appended when it's the last row).
    const rect = e.currentTarget.getBoundingClientRect()
    const after = e.clientY > rect.top + rect.height / 2
    const beforeId = after ? (phaseTasks[index + 1]?.id ?? null) : task.id
    setTplDropTarget({ phase: task.phase, beforeId })
  }
  function handlePhaseDragOver(e, phase) {
    if (!draggingTaskId) return
    e.preventDefault()
    setTplDropTarget({ phase, beforeId: null })
  }
  function handlePhaseDrop(e, phase) {
    if (!draggingTaskId) return
    e.preventDefault()
    const before = tplDropTarget && tplDropTarget.phase === phase ? tplDropTarget.beforeId : null
    const id = draggingTaskId
    setDraggingTaskId(null); setTplDropTarget(null)
    moveTemplate(id, phase, before)
    flashTemplate(id)
  }

  // Drag-and-drop reordering of a task's subtasks. A subtask stays attached to
  // its parent; only its position among its siblings changes, persisted as
  // sort_order so it becomes the default order for that role.
  async function moveSubtask(draggedId, parentId, beforeId) {
    const dragged = templates.find(t => t.id === draggedId)
    if (!dragged || dragged.parent_id !== parentId) return
    if (beforeId === draggedId) return

    const targetList = templates
      .filter(t => t.id !== draggedId && t.parent_id === parentId)
      .sort(sortTemplates)

    let insertAt = beforeId ? targetList.findIndex(t => t.id === beforeId) : targetList.length
    if (insertAt === -1) insertAt = targetList.length

    const ordered = [
      ...targetList.slice(0, insertAt),
      dragged,
      ...targetList.slice(insertAt),
    ]

    const orderMap = new Map(ordered.map((t, i) => [t.id, i]))
    const noChange = (dragged.sort_order ?? 0) === orderMap.get(draggedId)
      && targetList.every(t => (t.sort_order ?? 0) === orderMap.get(t.id))
    if (noChange) return

    // Optimistic reorder so the list responds instantly.
    setTemplates(prev => prev.map(t => orderMap.has(t.id) ? { ...t, sort_order: orderMap.get(t.id) } : t))

    const results = await Promise.all(ordered.map((t, i) =>
      supabase.from('onboarding_templates').update({ sort_order: i }).eq('id', t.id)
    ))
    const failed = results.find(r => r.error)
    if (failed) {
      showToast(handleSupabaseError(failed.error, 'Failed to reorder subtasks. Please try again.'), 'error')
      fetchTemplates(selectedRole.id)
    }
  }

  function handleSubtaskDragStart(e, sub) {
    e.stopPropagation()
    setDraggingSubtaskId(sub.id)
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', sub.id) } catch (_) { /* some browsers require this call */ }
  }
  function handleSubtaskDragEnd() { setDraggingSubtaskId(null); setSubDropTarget(null) }
  function handleSubtaskRowDragOver(e, sub, index, siblingSubs) {
    if (!draggingSubtaskId) return
    e.preventDefault(); e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const after = e.clientY > rect.top + rect.height / 2
    const beforeId = after ? (siblingSubs[index + 1]?.id ?? null) : sub.id
    setSubDropTarget({ parentId: sub.parent_id, beforeId })
  }
  function handleSubtaskDrop(e, parentId) {
    if (!draggingSubtaskId) return
    e.preventDefault(); e.stopPropagation()
    const before = subDropTarget && subDropTarget.parentId === parentId ? subDropTarget.beforeId : null
    const id = draggingSubtaskId
    setDraggingSubtaskId(null); setSubDropTarget(null)
    moveSubtask(id, parentId, before)
    flashTemplate(id)
  }

  async function addBulkTasks() {
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean)
    if (!lines.length || !selectedRole) return
    const siblings = templates.filter(t => t.phase === bulkPhase && !t.parent_id)
    const base = siblings.length ? Math.max(...siblings.map(s => s.sort_order ?? 0)) + 1 : 0
    const { error } = await supabase.from('onboarding_templates').insert(
      lines.map((name, i) => ({ role_id: selectedRole.id, task_name: name, phase: bulkPhase, owner: bulkOwner, sort_order: base + i }))
    )
    if (error) { showToast(handleSupabaseError(error, 'Failed to add tasks.'), 'error'); return }
    const newNames = lines.filter(name => !taskLibrary.some(t => t.task_name.toLowerCase() === name.toLowerCase()))
    if (newNames.length > 0) {
      await supabase.from('task_library').insert(newNames.map(name => ({ task_name: name })))
      fetchTaskLibrary()
    }
    setBulkText('')
    setBulkMode(false)
    fetchTemplates(selectedRole.id)
    fetchTemplateCounts()
    showToast(`${lines.length} task${lines.length !== 1 ? 's' : ''} added`)
  }

  async function deleteLibraryTask(id) {
    const { error } = await supabase.from('task_library').delete().eq('id', id)
    if (error) { showToast(handleSupabaseError(error, 'Failed to remove.'), 'error'); return }
    fetchTaskLibrary()
  }

  async function deleteTask(id, name) {
    setModal({
      title: 'Remove task',
      message: `Remove "${name}" from this role's template? This won't affect onboardings already in progress.`,
      confirmLabel: 'Remove task',
      confirmDanger: true,
      onConfirm: async () => {
        const { error } = await supabase.from('onboarding_templates').delete().eq('id', id)
        setModal(null)
        if (error) { showToast(handleSupabaseError(error, 'Failed to remove task.'), 'error'); return }
        showToast('Task removed')
        fetchTemplates(selectedRole.id)
        fetchTemplateCounts()
      }
    })
  }

async function saveTaskEdit(id) {
  if (!editingTaskName.trim()) return
  const { error } = await supabase
    .from('onboarding_templates')
    .update({ task_name: editingTaskName.trim() })
    .eq('id', id)
  if (error) {
    showToast(handleSupabaseError(error, 'Failed to save task.'), 'error')
  } else {
    showToast('Task updated')
    setEditingTask(null)
    setEditingTaskName('')
    fetchTemplates(selectedRole.id)
  }
}

async function addSubtask(parentId) {
  if (!newSubtaskName.trim()) return
  const parent = templates.find(t => t.id === parentId)
  const siblings = templates.filter(t => t.parent_id === parentId)
  const sortOrder = siblings.length ? Math.max(...siblings.map(s => s.sort_order ?? 0)) + 1 : 0
  const { error } = await supabase.from('onboarding_templates').insert({
    role_id: selectedRole.id,
    task_name: newSubtaskName.trim(),
    phase: parent?.phase || 'Day 1',
    owner: parent?.owner,
    parent_id: parentId,
    sort_order: sortOrder
  })
  if (error) {
    showToast(handleSupabaseError(error, 'Failed to add subtask.'), 'error')
  } else {
    showToast('Subtask added')
    setNewSubtaskName('')
    setAddingSubtaskTo(null)
    fetchTemplates(selectedRole.id)
  }
}

function deleteDoc(doc, isResource) {
  setModal({
    title: isResource ? 'Remove resource' : 'Remove document',
    message: isResource
      ? `Remove "${doc.name}" from company resources? Employees will no longer see it.`
      : `Remove "${doc.name}"? It will disappear from every onboarding plan and employee portal it appears in.`,
    confirmLabel: 'Remove',
    confirmDanger: true,
    onConfirm: async () => {
      const { error } = await supabase.from('documents').delete().eq('id', doc.id)
      setModal(null)
      if (error) {
        showToast(handleSupabaseError(error, `Failed to remove ${isResource ? 'resource' : 'document'}.`), 'error')
        return
      }
      logAudit(isResource ? 'resource_removed' : 'document_removed', 'document', doc.id, { document_name: doc.name })
      showToast(isResource ? 'Resource removed' : 'Document removed')
      if (isResource) fetchCompanyResources(); else fetchDocuments()
    }
  })
}

async function renameResource(id) {
  const trimmed = renameValue.trim()
  if (!trimmed) return
  const { error } = await supabase.from('documents').update({ name: trimmed }).eq('id', id)
  if (error) {
    showToast(handleSupabaseError(error, 'Failed to rename resource.'), 'error')
  } else {
    setRenamingDocId(null)
    fetchCompanyResources()
  }
}

async function handleCompanyResourceUpload(e) {
  const file = e.target.files[0]
  if (!file) return
  setUploadingResource(true)

  const filePath = `documents/${Date.now()}_${safeFileName(file.name)}`
  const { error: uploadError } = await supabase.storage.from('documents').upload(filePath, file)

  if (uploadError) {
    showToast(handleSupabaseError(uploadError, 'Upload failed.'), 'error')
    setUploadingResource(false)
    return
  }

  const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath)

  const { error: insertError } = await supabase.from('documents').insert({
    name: file.name,
    file_url: urlData.publicUrl,
    role_id: null,
    is_company_resource: true,
  })

  if (insertError) {
    showToast(handleSupabaseError(insertError, 'Failed to save resource.'), 'error')
    await supabase.storage.from('documents').remove([filePath])
  } else {
    showToast('Resource uploaded')
    fetchCompanyResources()
  }
  setUploadingResource(false)
  e.target.value = ''
}

async function handleAdminDocumentUpload(e) {
  const file = e.target.files[0]
  if (!file) return
  setUploadingDoc(true)

  const filePath = `documents/${Date.now()}_${safeFileName(file.name)}`
  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(filePath, file)

  if (uploadError) {
    showToast(handleSupabaseError(uploadError, 'Upload failed.'), 'error')
    setUploadingDoc(false)
    return
  }

  const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath)

  const { error: insertError } = await supabase.from('documents').insert({
    name: file.name,
    file_url: urlData.publicUrl,
    role_id: uploadDocRole || null
  })

  if (insertError) {
    showToast(handleSupabaseError(insertError, 'Failed to save document.'), 'error')
    await supabase.storage.from('documents').remove([filePath])
  } else {
    showToast('Document uploaded')
    fetchDocuments()
  }
  setUploadingDoc(false)
  e.target.value = ''
}

  function handleStartSelected() {
    if (!pickedRoleId) return
    const role = roles.find(r => r.id === pickedRoleId)
    if (role) onStartOnboarding(role)
  }

  const px = isMobile ? '16px' : '40px'
  const contentStyle = { padding: isMobile ? '20px 16px 40px' : '28px 40px 48px', maxWidth: '820px' }
  const card = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, boxShadow: T.shadowSm }
  const groupLabel = { ...BASE_STYLES.phaseLabel, marginTop: '28px' }
  const listSkeleton = (
    <div aria-busy="true" aria-label="Loading">
      {[1, 2, 3, 4].map(i => (
        <div key={i} style={{ ...BASE_STYLES.row, padding: '16px 0' }}>
          <SkeletonLine width={`${40 + i * 8}%`} />
        </div>
      ))}
    </div>
  )

  const ADMIN_TABS = [
    { id: 'history', label: 'History' },
    { id: 'templates', label: 'Task templates' },
    { id: 'documents', label: 'Documents' },
    { id: 'company-resources', label: 'Company resources' },
    { id: 'roles', label: 'Roles' },
  ]

  function renderAdminHeader(title, subtitle, actions) {
    return (
      <PageHeader
        title={title}
        subtitle={isMobile ? null : subtitle}
        actions={actions}
        tabs={{ mode: 'nav', label: 'Admin sections', items: ADMIN_TABS, value: initialTab, onChange: onNavigate }}
      />
    )
  }

  function renderModal() {
    return (
      <>
        {modal && (
          <ConfirmModal
            title={modal.title}
            message={modal.message}
            confirmLabel={modal.confirmLabel}
            confirmDanger={modal.confirmDanger}
            onConfirm={modal.onConfirm}
            onCancel={() => setModal(null)}
          />
        )}
        {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onClose={hideToast} />}
      </>
    )
  }

  // ── START A NEW ONBOARDING: pick agency, then role ──
  if (initialTab === 'new-onboarding-select') {
    const brandRoles = pickedBrand ? roles.filter(r => r.brand === pickedBrand) : []
    return (
      <Layout session={session} userProfile={userProfile} currentPage="active" onNavigate={onNavigate}>
        <PageHeader title="Start a new onboarding" subtitle="Choose the agency and role. Their plan is built from that role’s task template." />
        <div style={{ ...contentStyle, maxWidth: '720px' }}>
          <div id="agency-label" style={{ fontSize: '13px', fontWeight: 600, color: T.text, marginBottom: '10px' }}>1. Agency</div>
          <div role="radiogroup" aria-labelledby="agency-label" style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '10px', marginBottom: '28px' }}>
            {BRANDS.map(b => {
              const active = pickedBrand === b.code
              const count = roles.filter(r => r.brand === b.code).length
              return (
                <button key={b.code} type="button" role="radio" aria-checked={active}
                  onClick={() => { setPickedBrand(b.code); setPickedRoleId('') }}
                  className="il-lift"
                  style={{
                    textAlign: 'left', padding: '14px 16px', borderRadius: T.radiusMd, cursor: 'pointer', fontFamily: 'inherit',
                    background: active ? T.brandLight : T.surface,
                    border: `1.5px solid ${active ? T.brand : T.border}`,
                    boxShadow: active ? 'none' : T.shadowSm,
                  }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: active ? T.brand : T.text }}>{b.name}</div>
                  <div style={{ fontSize: '12px', color: T.muted, marginTop: '3px' }}>
                    {loaded.roles ? `${count} role${count === 1 ? '' : 's'}` : 'Loading…'}
                  </div>
                </button>
              )
            })}
          </div>

          {pickedBrand && (
            <div className="il-tab-content">
              <div style={{ fontSize: '13px', fontWeight: 600, color: T.text, marginBottom: '10px' }}>2. Role</div>
              {brandRoles.length === 0 ? (
                <div style={{ ...card, padding: '16px 18px', fontSize: '13px', color: T.muted, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                  No roles exist for {brandName(pickedBrand)} yet.
                  <Button size="sm" variant="secondary" onClick={() => onNavigate('roles')}>Add a role</Button>
                </div>
              ) : (
                <form onSubmit={e => { e.preventDefault(); handleStartSelected() }} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <select className="il-input" aria-label="Role" style={{ flex: '1 1 260px', width: 'auto' }} value={pickedRoleId} onChange={e => setPickedRoleId(e.target.value)} autoFocus>
                    <option value="">Select a role…</option>
                    {brandRoles.map(r => <option key={r.id} value={r.id}>{r.name}{templateCounts[r.id] != null ? ` · ${templateCounts[r.id]} tasks` : ''}</option>)}
                  </select>
                  <Button type="submit" disabled={!pickedRoleId}>Continue</Button>
                </form>
              )}
            </div>
          )}
        </div>
        {renderModal()}
      </Layout>
    )
  }

  // ── HISTORY ──
  if (initialTab === 'history') {
    const filteredHistory = history.filter(h => historyFilter === 'all' || h.status === historyFilter)
    const counts = { all: history.length, completed: history.filter(h => h.status === 'completed').length, archived: history.filter(h => h.status === 'archived').length }
    return (
      <Layout session={session} userProfile={userProfile} currentPage="history" onNavigate={onNavigate}>
        {renderAdminHeader('History', 'Completed and archived onboardings.')}
        <div style={contentStyle}>
          <div style={{ marginBottom: '16px' }}>
            <Segmented size="sm" label="Filter history" value={historyFilter} onChange={setHistoryFilter} options={[
              { value: 'all', label: `All${loaded.history ? ` (${counts.all})` : ''}` },
              { value: ONBOARDING_STATUS.COMPLETED, label: `Completed${loaded.history ? ` (${counts.completed})` : ''}` },
              { value: ONBOARDING_STATUS.ARCHIVED, label: `Archived${loaded.history ? ` (${counts.archived})` : ''}` },
            ]} />
          </div>
          {!loaded.history ? listSkeleton : filteredHistory.length === 0 ? (
            <EmptyState icon={EmptyIcons.check} title={historyFilter === 'all' ? 'Nothing here yet' : `No ${historyFilter} onboardings`}
              message="When an onboarding is marked complete or archived, it moves here." />
          ) : filteredHistory.map(h => (
            <div key={h.id} className="il-task-row" style={{ ...BASE_STYLES.row, gap: '12px' }}>
              <button type="button" onClick={() => onViewOnboarding(h.id)} className="il-link-subtle"
                style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                <div style={BASE_STYLES.rowName}>{h.employees.full_name}</div>
                <div style={BASE_STYLES.rowMuted}>{h.employees.roles?.name || 'Role removed'} · Started {formatDate(h.employees.hire_date, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
              </button>
              <span style={{ ...BASE_STYLES.pill, background: h.status === 'completed' ? T.successBg : T.hoverBg, color: h.status === 'completed' ? T.success : T.muted }}>{humanize(h.status)}</span>
              <span className="il-row-actions"><Button variant="ghost" size="xs"
                onClick={() => setModal({
                  title: 'Reactivate onboarding',
                  message: `This moves ${h.employees.full_name}'s onboarding back to active. Tasks already checked off stay checked.`,
                  confirmLabel: 'Reactivate',
                  confirmDanger: false,
                  onConfirm: async () => {
                    const { error } = await supabase.from('onboarding_instances').update({ status: ONBOARDING_STATUS.ACTIVE }).eq('id', h.id)
                    if (error) { showToast(handleSupabaseError(error, 'Failed to reactivate.'), 'error'); setModal(null); return }
                    showToast('Onboarding reactivated')
                    await logAudit('onboarding_reactivated', 'onboarding_instance', h.id, { employee_name: h.employees.full_name })
                    setModal(null)
                    fetchHistory()
                  }
                })}>
                Reactivate
              </Button></span>
            </div>
          ))}
        </div>
        {renderModal()}
      </Layout>
    )
  }

  // ── ROLES ──
  if (initialTab === 'roles') {
    return (
      <Layout session={session} userProfile={userProfile} currentPage="roles" onNavigate={onNavigate}>
        {renderAdminHeader('Roles', 'The job roles each agency hires for. Each role has its own task template.')}
        <div style={contentStyle}>
          <form onSubmit={e => { e.preventDefault(); addRole() }} style={{ ...card, padding: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
            <input className="il-input" style={{ flex: '1 1 200px', width: 'auto' }} placeholder="New role name, e.g. Payroll Specialist" aria-label="New role name"
              value={newRoleName} onChange={e => setNewRoleName(e.target.value)} />
            <select className="il-input" style={{ width: 'auto' }} aria-label="Agency" value={newRoleBrand} onChange={e => setNewRoleBrand(e.target.value)}>
              {BRANDS.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
            </select>
            <Button type="submit" disabled={!newRoleName.trim()}>Add role</Button>
          </form>
          {!loaded.roles ? listSkeleton : roles.length === 0 ? (
            <EmptyState icon={EmptyIcons.people} title="No roles yet" message="Add the first role above, then give it a task template." />
          ) : BRANDS.map(brand => {
            const brandRoles = roles.filter(r => r.brand === brand.code)
            if (brandRoles.length === 0) return null
            return (
              <section key={brand.code} aria-label={brand.name}>
                <h2 style={groupLabel}>{brand.name}</h2>
                {brandRoles.map(r => (
                  <div key={r.id} className="il-task-row" style={BASE_STYLES.row}>
                    <span style={BASE_STYLES.rowName}>{r.name}</span>
                    <span className="il-row-actions" style={{ display: 'flex', gap: '4px' }}>
                      <Button variant="ghost" size="xs" onClick={() => { setSelectedRole(r); onNavigate('templates') }}>Edit tasks</Button>
                      <Button variant="ghost" size="xs" style={{ color: T.danger }} onClick={() => deleteRole(r.id, r.name)} aria-label={`Delete ${r.name}`}>Delete</Button>
                    </span>
                  </div>
                ))}
              </section>
            )
          })}
        </div>
        {renderModal()}
      </Layout>
    )
  }

  // ── TASK TEMPLATES ──
  if (initialTab === 'templates') {
    const dropOutline = (active) => active ? `2px dashed ${T.brand}` : (draggingTaskId ? `1px dashed ${T.border}` : 'none')
    return (
      <Layout session={session} userProfile={userProfile} currentPage="templates" onNavigate={onNavigate}>
        {renderAdminHeader('Task templates', 'The default plan every new hire in a role starts with.',
          <Button size="sm" variant="secondary" onClick={() => setLibraryOpen(true)}>
            Task library <span style={{ color: T.subtle }}>({taskLibrary.length})</span>
          </Button>
        )}

        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', minHeight: isMobile ? undefined : 'calc(100vh - 150px)' }}>

          {/* Role list */}
          <nav aria-label="Roles" style={isMobile
            ? { padding: '12px 16px', borderBottom: `1px solid ${T.border}` }
            : { width: '220px', flexShrink: 0, borderRight: `1px solid ${T.border}`, overflowY: 'auto', padding: '12px 0' }}>
            {isMobile ? (
              <select className="il-input" aria-label="Role" value={selectedRole?.id || ''} onChange={e => { const r = roles.find(x => x.id === e.target.value); if (r) { setSelectedRole(r); setAddingTaskToPhase(null); setBulkMode(false) } }}>
                {BRANDS.map(b => {
                  const brandRoles = roles.filter(r => r.brand === b.code)
                  return brandRoles.length ? <optgroup key={b.code} label={b.name}>{brandRoles.map(r => <option key={r.id} value={r.id}>{r.name} ({templateCounts[r.id] || 0} tasks)</option>)}</optgroup> : null
                })}
              </select>
            ) : BRANDS.map(brand => {
              const brandRoles = roles.filter(r => r.brand === brand.code)
              if (brandRoles.length === 0) return null
              return (
                <div key={brand.code}>
                  <div style={{ fontSize: '10px', fontWeight: 600, color: T.subtle, textTransform: 'uppercase', letterSpacing: '0.4px', padding: '12px 16px 4px' }}>{brand.name}</div>
                  {brandRoles.map(r => {
                    const active = selectedRole?.id === r.id
                    return (
                      <button key={r.id} type="button" aria-current={active ? 'true' : undefined}
                        className={`il-role-item${active ? ' il-active' : ''}`}
                        onClick={() => { setSelectedRole(r); setAddingTaskToPhase(null); setBulkMode(false) }}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 16px', border: 'none', borderLeft: `2px solid ${active ? T.brand : 'transparent'}`, background: active ? T.hoverBg : 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}>
                        <div style={{ fontSize: '13px', fontWeight: active ? 600 : 400, color: T.text, letterSpacing: '-0.1px' }}>{r.name}</div>
                        <div style={{ fontSize: '11px', color: T.subtle, marginTop: '1px' }}>{templateCounts[r.id] || 0} tasks</div>
                      </button>
                    )
                  })}
                </div>
              )
            })}
            {loaded.roles && roles.length === 0 && (
              <div style={{ padding: '16px', fontSize: '12px', color: T.subtle }}>
                No roles yet. <Button variant="link" size="sm" onClick={() => onNavigate('roles')}>Add roles</Button>
              </div>
            )}
          </nav>

          {/* Task editor */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {!selectedRole ? (
              loaded.roles ? <EmptyState icon={EmptyIcons.list} title="Pick a role" message="Choose a role to see and edit its task template." /> : <div style={{ padding: '24px 32px' }}>{listSkeleton}</div>
            ) : (
              <>
                <div style={{ padding: isMobile ? '14px 16px' : '18px 32px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', borderBottom: `1px solid ${T.borderSubtle}`, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <h2 style={{ ...T.type.h2, fontSize: '15px', margin: 0, color: T.text }}>{selectedRole.name}</h2>
                    <div style={{ fontSize: '12px', color: T.subtle, marginTop: '2px' }}>{brandName(selectedRole.brand)} · {templateCounts[selectedRole.id] || 0} tasks</div>
                  </div>
                  <Button size="sm" variant={bulkMode ? 'ghost' : 'secondary'} onClick={() => { setBulkMode(v => !v); setAddingTaskToPhase(null) }}>
                    {bulkMode ? 'Cancel bulk add' : 'Bulk add'}
                  </Button>
                </div>

                <div style={{ padding: isMobile ? '16px' : '20px 32px 48px', maxWidth: '680px' }}>

                  {/* Shared suggestion list for the task/subtask add fields. */}
                  <datalist id="tpl-task-library">
                    {taskLibrary.map(tl => <option key={tl.id} value={tl.task_name} />)}
                  </datalist>

                  {!bulkMode && !isMobile && templates.some(t => !t.parent_id) && (
                    <div style={{ fontSize: '12px', color: T.muted, marginBottom: '8px', lineHeight: 1.5 }}>
                      Drag <span aria-hidden="true">⠿</span> to reorder tasks, move them to another day, or reorder subtasks. This order is the default for every new {selectedRole.name}.
                    </div>
                  )}

                  {bulkMode && (
                    <form onSubmit={e => { e.preventDefault(); addBulkTasks() }} className="il-tab-content" style={{ ...card, padding: '16px', marginBottom: '24px' }}>
                      <label htmlFor="bulk-tasks" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: T.text }}>Bulk add tasks</label>
                      <div style={{ fontSize: '12px', color: T.muted, margin: '2px 0 10px' }}>One task per line. They’re added to the day and owner you pick below.</div>
                      <textarea id="bulk-tasks" className="il-input" autoFocus style={{ height: '120px' }}
                        placeholder={'Complete tax forms\nSet up laptop\nMeet with manager'}
                        value={bulkText} onChange={e => setBulkText(e.target.value)} />
                      <div style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <select className="il-input" style={{ width: 'auto' }} aria-label="Day" value={bulkPhase} onChange={e => setBulkPhase(e.target.value)}>
                          {PHASES.map(ph => <option key={ph}>{ph}</option>)}
                        </select>
                        <select className="il-input" style={{ width: 'auto' }} aria-label="Owner" value={bulkOwner} onChange={e => setBulkOwner(e.target.value)}>
                          {OWNERS.map(o => <option key={o}>{o}</option>)}
                        </select>
                        <Button type="submit" disabled={!bulkText.trim()}>
                          Add {bulkText.split('\n').filter(l => l.trim()).length || ''} tasks
                        </Button>
                      </div>
                    </form>
                  )}

                  {BUCKET_SECTIONS.map(section => {
                    const showHeading = section.buckets.length > 1 || section.label !== section.buckets[0]
                    return (
                      <div key={section.label}>
                        {showHeading && <h3 style={{ fontSize: '11px', fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.6px', margin: '22px 0 6px' }}>{section.label}</h3>}
                        {section.buckets.map(phase => {
                          const phaseTasks = templates.filter(t => t.phase === phase && !t.parent_id).sort(sortTemplates)
                          const isAddingToThis = addingTaskToPhase === phase
                          const isPhaseDropTarget = draggingTaskId && tplDropTarget && tplDropTarget.phase === phase
                          return (
                            <section key={phase} aria-label={phase}
                              onDragOver={e => handlePhaseDragOver(e, phase)}
                              onDrop={e => handlePhaseDrop(e, phase)}
                              style={{
                                marginBottom: '14px', borderRadius: T.radiusMd,
                                // While a drag is in flight, faintly outline every day so all
                                // valid drop zones are visible; the hovered one gets the bold cue.
                                outline: dropOutline(isPhaseDropTarget), outlineOffset: '2px',
                                background: isPhaseDropTarget ? T.brandLight : 'transparent',
                                transition: 'background 0.12s',
                              }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '32px', borderBottom: `1px solid ${T.borderSubtle}` }}>
                                <span style={{ fontSize: '12px', fontWeight: 600, color: T.text }}>{phase}</span>
                                {phaseTasks.length > 0
                                  ? <span className="il-tabular" style={{ fontSize: '11px', color: T.subtle }}>{phaseTasks.length}</span>
                                  : !isAddingToThis && <span style={{ fontSize: '11px', color: T.subtle, fontStyle: 'italic' }}>{draggingTaskId ? 'Drop here' : 'No tasks'}</span>}
                                {!bulkMode && !isAddingToThis && (
                                  <Button variant="link" size="sm" style={{ marginLeft: 'auto' }} aria-label={`Add a task to ${phase}`}
                                    onClick={() => { setAddingTaskToPhase(phase); setNewTaskName(''); setNewTaskOwner('HR') }}>
                                    + Add
                                  </Button>
                                )}
                              </div>

                              {phaseTasks.map((t, idx) => {
                                const subtasks = templates.filter(s => s.parent_id === t.id).sort(sortTemplates)
                                const isDragging = draggingTaskId === t.id
                                const isEditingThis = editingTask === t.id
                                const showInsertLine = draggingTaskId && draggingTaskId !== t.id && tplDropTarget && tplDropTarget.phase === phase && tplDropTarget.beforeId === t.id
                                return (
                                  <div key={t.id}>
                                    {showInsertLine && <div style={{ height: '2px', background: T.brand, borderRadius: '2px', margin: '0 6px' }} />}
                                    <div
                                      className={`il-row il-task-row${flashTemplateId === t.id ? ' il-row-flash' : ''}`}
                                      draggable={!isEditingThis && !isMobile}
                                      onDragStart={e => handleTaskDragStart(e, t)}
                                      onDragEnd={handleTaskDragEnd}
                                      onDragOver={e => handleTaskRowDragOver(e, t, idx, phaseTasks)}
                                      style={{ ...BASE_STYLES.row, gap: '8px', padding: '10px 4px', opacity: isDragging ? 0.45 : 1, background: isDragging ? T.brandLight : undefined }}>
                                      {isEditingThis ? (
                                        <form onSubmit={e => { e.preventDefault(); saveTaskEdit(t.id) }} style={{ display: 'flex', gap: '8px', flex: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                                          <input className="il-input" style={{ flex: '1 1 180px', width: 'auto' }} aria-label="Task name" value={editingTaskName}
                                            onChange={e => setEditingTaskName(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Escape') setEditingTask(null) }}
                                            autoFocus />
                                          <Button type="submit" size="sm">Save</Button>
                                          <Button size="sm" variant="ghost" onClick={() => setEditingTask(null)}>Cancel</Button>
                                        </form>
                                      ) : (
                                        <>
                                          {!isMobile && <span className="il-drag-handle" style={BASE_STYLES.dragHandle} title="Drag to reorder or move to another day" aria-hidden="true">⠿</span>}
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
                                            <span style={BASE_STYLES.rowName}>{t.task_name}</span>
                                            <span style={BASE_STYLES.pill}>{t.owner}</span>
                                          </div>
                                          <div className="il-row-actions" style={{ display: 'flex', gap: '2px', alignItems: 'center', flexShrink: 0 }}>
                                            <Button variant="ghost" size="xs" onClick={() => { setEditingTask(t.id); setEditingTaskName(t.task_name) }} aria-label={`Rename ${t.task_name}`}>Edit</Button>
                                            <Button variant="ghost" size="xs" onClick={() => { setAddingSubtaskTo(addingSubtaskTo === t.id ? null : t.id); setNewSubtaskName('') }} aria-label={`Add a subtask to ${t.task_name}`}>+ Subtask</Button>
                                            <Button variant="ghost" size="xs" style={{ color: T.danger }} onClick={() => deleteTask(t.id, t.task_name)} aria-label={`Remove ${t.task_name}`}>Remove</Button>
                                          </div>
                                        </>
                                      )}
                                    </div>

                                    {subtasks.map((s, sIdx) => {
                                      const isSubDragging = draggingSubtaskId === s.id
                                      const isEditingSub = editingTask === s.id
                                      const showSubInsert = draggingSubtaskId && draggingSubtaskId !== s.id && subDropTarget && subDropTarget.parentId === t.id && subDropTarget.beforeId === s.id
                                      return (
                                        <div key={s.id}>
                                          {showSubInsert && <div style={{ height: '2px', background: T.brand, borderRadius: '2px', margin: '0 6px 0 26px' }} />}
                                          <div
                                            className={`il-row il-task-row${flashTemplateId === s.id ? ' il-row-flash' : ''}`}
                                            draggable={!isEditingSub && !isMobile}
                                            onDragStart={e => handleSubtaskDragStart(e, s)}
                                            onDragEnd={handleSubtaskDragEnd}
                                            onDragOver={e => handleSubtaskRowDragOver(e, s, sIdx, subtasks)}
                                            onDrop={e => handleSubtaskDrop(e, t.id)}
                                            style={{ ...BASE_STYLES.row, gap: '8px', padding: '8px 4px 8px 22px', background: isSubDragging ? T.brandLight : T.surfaceSunken, opacity: isSubDragging ? 0.45 : 1 }}>
                                            {isEditingSub ? (
                                              <form onSubmit={e => { e.preventDefault(); saveTaskEdit(s.id) }} style={{ display: 'flex', gap: '8px', flex: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                                                <input className="il-input" style={{ flex: '1 1 180px', width: 'auto' }} aria-label="Subtask name" value={editingTaskName}
                                                  onChange={e => setEditingTaskName(e.target.value)}
                                                  onKeyDown={e => { if (e.key === 'Escape') setEditingTask(null) }}
                                                  autoFocus />
                                                <Button type="submit" size="sm">Save</Button>
                                                <Button size="sm" variant="ghost" onClick={() => setEditingTask(null)}>Cancel</Button>
                                              </form>
                                            ) : (
                                              <>
                                                {!isMobile && <span className="il-drag-handle" style={BASE_STYLES.dragHandle} title="Drag to reorder" aria-hidden="true">⠿</span>}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                                                  <span aria-hidden="true" style={{ color: T.subtle, fontSize: '12px' }}>↳</span>
                                                  <span style={{ ...BASE_STYLES.rowName, color: T.muted }}>{s.task_name}</span>
                                                </div>
                                                <div className="il-row-actions" style={{ display: 'flex', gap: '2px', alignItems: 'center', flexShrink: 0 }}>
                                                  <Button variant="ghost" size="xs" onClick={() => { setEditingTask(s.id); setEditingTaskName(s.task_name) }} aria-label={`Rename ${s.task_name}`}>Edit</Button>
                                                  <Button variant="ghost" size="xs" style={{ color: T.danger }} onClick={() => deleteTask(s.id, s.task_name)} aria-label={`Remove ${s.task_name}`}>Remove</Button>
                                                </div>
                                              </>
                                            )}
                                          </div>
                                          {/* trailing insert line when appending to the end of this task's subtasks */}
                                          {sIdx === subtasks.length - 1 && draggingSubtaskId && draggingSubtaskId !== s.id && subDropTarget && subDropTarget.parentId === t.id && subDropTarget.beforeId === null && (
                                            <div style={{ height: '2px', background: T.brand, borderRadius: '2px', margin: '0 6px 0 26px' }} />
                                          )}
                                        </div>
                                      )
                                    })}

                                    {addingSubtaskTo === t.id && (
                                      <form onSubmit={e => { e.preventDefault(); addSubtask(t.id) }}
                                        style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', padding: '8px 4px 12px 22px', background: T.surfaceSunken, borderBottom: `1px solid ${T.borderSubtle}` }}>
                                        <input list="tpl-task-library" className="il-input" style={{ flex: '1 1 160px', width: 'auto' }} placeholder="Subtask name…" aria-label={`New subtask for ${t.task_name}`}
                                          value={newSubtaskName} onChange={e => setNewSubtaskName(e.target.value)}
                                          onKeyDown={e => { if (e.key === 'Escape') setAddingSubtaskTo(null) }} autoFocus />
                                        <Button type="submit" size="sm" disabled={!newSubtaskName.trim()}>Add</Button>
                                        <Button size="sm" variant="ghost" onClick={() => setAddingSubtaskTo(null)}>Cancel</Button>
                                      </form>
                                    )}
                                  </div>
                                )
                              })}

                              {/* trailing insert line when appending to the end of this day */}
                              {draggingTaskId && tplDropTarget && tplDropTarget.phase === phase && tplDropTarget.beforeId === null && phaseTasks.length > 0 && (
                                <div style={{ height: '2px', background: T.brand, borderRadius: '2px', margin: '0 6px' }} />
                              )}

                              {isAddingToThis && (
                                <form onSubmit={e => { e.preventDefault(); addTask(phase) }} style={{ marginTop: '8px', padding: '12px', background: T.surfaceSunken, border: `1px solid ${T.border}`, borderRadius: T.radiusMd }}>
                                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                                    <input list="tpl-task-library" className="il-input" style={{ flex: '1 1 180px', width: 'auto' }} placeholder="Type a task name…" aria-label={`New task for ${phase}`}
                                      value={newTaskName} onChange={e => setNewTaskName(e.target.value)}
                                      onKeyDown={e => { if (e.key === 'Escape') { setAddingTaskToPhase(null); setNewTaskName('') } }} autoFocus />
                                    <select className="il-input" style={{ width: 'auto' }} aria-label="Owner" value={newTaskOwner} onChange={e => setNewTaskOwner(e.target.value)}>
                                      {OWNERS.map(o => <option key={o}>{o}</option>)}
                                    </select>
                                    <Button type="submit" size="sm" disabled={!newTaskName.trim()}>Add</Button>
                                    <Button size="sm" variant="ghost" onClick={() => { setAddingTaskToPhase(null); setNewTaskName('') }}>Cancel</Button>
                                  </div>
                                  <div style={{ ...BASE_STYLES.rowMuted, marginTop: '6px' }}>Type a new task, or pick a saved one from the suggestions.</div>
                                </form>
                              )}
                            </section>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {libraryOpen && (
          <div
            className="il-backdrop"
            style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.3)', display: 'flex', justifyContent: 'flex-end', fontFamily: T.font }}
            onClick={() => setLibraryOpen(false)}>
            <div
              role="dialog" aria-modal="true" aria-labelledby="task-library-title"
              style={{ background: T.surface, height: '100%', width: isMobile ? '100%' : '400px', maxWidth: '100%', boxShadow: T.shadowLg, display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${T.border}` }}
              onClick={e => e.stopPropagation()}>
              <div style={{ padding: '20px 24px', borderBottom: `1px solid ${T.borderSubtle}`, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                <div>
                  <h2 id="task-library-title" style={{ ...T.type.h2, fontSize: '15px', margin: 0, color: T.text }}>Task library</h2>
                  <div style={{ fontSize: '12px', color: T.muted, marginTop: '4px', lineHeight: 1.5 }}>Saved task names that are suggested when you add tasks to a role. Remove typos or outdated entries.</div>
                </div>
                <button type="button" onClick={() => setLibraryOpen(false)} aria-label="Close task library" autoFocus className="il-btn-ghost"
                  style={{ background: 'none', border: 'none', fontSize: '22px', lineHeight: 1, color: T.subtle, cursor: 'pointer', fontFamily: 'inherit', padding: '0 4px', borderRadius: T.radiusSm }}>×</button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '8px 24px 24px' }}>
                {taskLibrary.length === 0 ? (
                  <EmptyState compact icon={EmptyIcons.list} title="Library is empty" message="Tasks you add to a role are saved here automatically." />
                ) : taskLibrary.map(t => (
                  <div key={t.id} className="il-task-row" style={{ ...BASE_STYLES.row, padding: '10px 0' }}>
                    <span style={{ fontSize: '13px', color: T.text }}>{t.task_name}</span>
                    <Button variant="ghost" size="xs" style={{ color: T.danger }} onClick={() => deleteLibraryTask(t.id)} aria-label={`Remove ${t.task_name} from the library`}>Remove</Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {renderModal()}
      </Layout>
    )
  }

  // ── DOCUMENTS ──
  if (initialTab === 'documents') {
    return (
      <Layout session={session} userProfile={userProfile} currentPage="documents" onNavigate={onNavigate}>
        {renderAdminHeader('Documents', 'Forms and documents new hires need to review, sign or return.')}
        <div style={contentStyle}>
          <div style={{ ...card, padding: '16px 18px', marginBottom: '8px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: T.text, marginBottom: '4px' }}>Upload a document</div>
            <div style={{ fontSize: '12px', color: T.muted, marginBottom: '12px' }}>Choose who it’s for, then pick a PDF or Word file.</div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <select className="il-input" aria-label="Who this document is for" style={{ flex: '1 1 220px', width: 'auto', maxWidth: '320px' }} value={uploadDocRole} onChange={e => setUploadDocRole(e.target.value)}>
                <option value="">Every employee</option>
                {BRANDS.map(b => {
                  const brandRoles = roles.filter(r => r.brand === b.code)
                  return brandRoles.length ? <optgroup key={b.code} label={b.name}>{brandRoles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</optgroup> : null
                })}
              </select>
              <FileButton variant="primary" busy={uploadingDoc} onFile={handleAdminDocumentUpload} accept=".pdf,.doc,.docx">Upload document</FileButton>
            </div>
          </div>

          {!loaded.documents ? listSkeleton : documents.length === 0 ? (
            <EmptyState icon={EmptyIcons.doc} title="No documents yet" message="Upload the forms new hires need, like tax forms or policies. You can target a single role." />
          ) : (
            [null, ...roles.filter(r => documents.some(d => d.role_id === r.id))].map(role => {
              const roleDocs = role === null
                ? documents.filter(d => !d.role_id)
                : documents.filter(d => d.role_id === role.id)
              if (roleDocs.length === 0) return null
              return (
                <section key={role?.id || 'universal'} aria-label={role ? role.name : 'Every employee'}>
                  <h2 style={groupLabel}>{role ? `${role.name} · ${brandName(role.brand)}` : 'Every employee'}</h2>
                  {roleDocs.map(doc => (
                    <div key={doc.id} className="il-task-row" style={{ ...BASE_STYLES.row, gap: '12px' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ ...BASE_STYLES.rowName, overflowWrap: 'anywhere' }}>{doc.name}</div>
                        <div style={BASE_STYLES.rowMuted}>Added {formatDate(doc.uploaded_at, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                      </div>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0 }}>
                        <a href={doc.file_url} target="_blank" rel="noreferrer" className="il-btn-link" style={{ fontSize: '12px', color: T.brand, textDecoration: 'none', padding: '4px 8px' }}>View</a>
                        <span className="il-row-actions"><Button variant="ghost" size="xs" style={{ color: T.danger }} onClick={() => deleteDoc(doc, false)} aria-label={`Remove ${doc.name}`}>Remove</Button></span>
                      </div>
                    </div>
                  ))}
                </section>
              )
            })
          )}
        </div>
        {renderModal()}
      </Layout>
    )
  }

  // ── COMPANY RESOURCES ──
  if (initialTab === 'company-resources') {
    return (
      <Layout session={session} userProfile={userProfile} currentPage="company-resources" onNavigate={onNavigate}>
        {renderAdminHeader('Company resources', 'Handbooks, policies and guides every employee can open from their portal.',
          <FileButton variant="primary" busy={uploadingResource} onFile={handleCompanyResourceUpload} accept=".pdf,.doc,.docx,.xlsx,.pptx">Upload</FileButton>
        )}
        <div style={contentStyle}>
          {!loaded.resources ? listSkeleton : companyResources.length === 0 ? (
            <EmptyState icon={EmptyIcons.folder} title="No company resources yet" message="Upload handbooks, policies and guides. Every employee sees them in their portal." />
          ) : (
            companyResources.map(doc => (
              <div key={doc.id} className="il-task-row" style={{ ...BASE_STYLES.row, gap: '12px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {renamingDocId === doc.id ? (
                    <form onSubmit={e => { e.preventDefault(); renameResource(doc.id) }} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input className="il-input" autoFocus aria-label="Resource name" style={{ flex: '1 1 200px', width: 'auto', maxWidth: '360px' }}
                        value={renameValue} onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Escape') setRenamingDocId(null) }} />
                      <Button type="submit" size="sm" disabled={!renameValue.trim()}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setRenamingDocId(null)}>Cancel</Button>
                    </form>
                  ) : (
                    <>
                      <div style={{ ...BASE_STYLES.rowName, overflowWrap: 'anywhere' }}>{doc.name}</div>
                      <div style={BASE_STYLES.rowMuted}>Added {formatDate(doc.uploaded_at, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                    </>
                  )}
                </div>
                {renamingDocId !== doc.id && (
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0 }}>
                    <a href={doc.file_url} target="_blank" rel="noreferrer" className="il-btn-link" style={{ fontSize: '12px', color: T.brand, textDecoration: 'none', padding: '4px 8px' }}>View</a>
                    <span className="il-row-actions" style={{ display: 'flex', gap: '2px' }}>
                      <Button variant="ghost" size="xs" onClick={() => { setRenamingDocId(doc.id); setRenameValue(doc.name) }} aria-label={`Rename ${doc.name}`}>Rename</Button>
                      <Button variant="ghost" size="xs" style={{ color: T.danger }} onClick={() => deleteDoc(doc, true)} aria-label={`Remove ${doc.name}`}>Remove</Button>
                    </span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        {renderModal()}
      </Layout>
    )
  }

  return (
    <Layout session={session} userProfile={userProfile} currentPage="dashboard" onNavigate={onNavigate}>
      <PageHeader title="Admin" />
      <EmptyState icon={EmptyIcons.list} title="Pick a section" message="Choose an admin section from the sidebar." />
      {renderModal()}
    </Layout>
  )
}
