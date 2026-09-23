import { useState, useEffect, useRef } from 'react'
import Layout from '../components/Layout'
import { SkeletonLine, SkeletonTaskRow } from '../components/Skeleton'
import ConfirmModal from '../components/ConfirmModal'
import EditEmployeeModal from '../components/EditEmployeeModal'
import Toast from '../components/Toast'
import { useOnboardingPlan } from '../hooks/useOnboardingPlan'
import { BUCKET_SECTIONS, SCHEDULE_BUCKETS } from '../config'
import { groupParentsByBucket, bucketDateHint } from '../utils/schedule'
import { T } from '../ui/theme'
import { formatDate } from '../utils/dates'

const OWNERS = ['HR', 'Manager', 'IT']

const STYLES = {
  header: { padding: '28px 40px 24px', borderBottom: `1px solid ${T.border}` },
  backLink: { fontSize: '12px', color: T.muted, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '4px' },
  title: { fontSize: '22px', fontWeight: 600, letterSpacing: '-0.4px' },
  sub: { fontSize: '13px', color: T.muted, marginTop: '3px' },
  progressRow: { marginTop: '20px', display: 'flex', alignItems: 'center', gap: '16px' },
  progressTrack: { flex: 1, maxWidth: '320px', height: '6px', background: T.border, borderRadius: '3px', overflow: 'hidden' },
  progressFill: { height: '100%', transition: 'width 0.3s ease' },
  progressText: { fontSize: '12px', color: T.muted },
  progressPct: { fontSize: '12px', fontWeight: 500 },
  content: { padding: '32px 40px', maxWidth: '780px' },
  sectionLabel: { fontSize: '11px', fontWeight: 600, color: T.subtle, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  uploadLink: { fontSize: '12px', color: T.brand, cursor: 'pointer', fontWeight: 500, textTransform: 'none', letterSpacing: 0 },
  weekHeading: { fontSize: '11px', fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.6px', margin: '30px 0 10px' },
  bucketHeader: { display: 'flex', alignItems: 'baseline', gap: '8px', padding: '6px 0 8px', borderBottom: '1px solid var(--border-subtle)' },
  bucketName: (complete) => ({ fontSize: '12px', fontWeight: 600, color: complete ? T.success : T.text, letterSpacing: '-0.1px' }),
  bucketDate: { fontSize: '11px', color: T.subtle },
  bucketCount: { fontSize: '11px', color: T.subtle, marginLeft: 'auto' },
  parentRow: { display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 6px', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', borderRadius: T.radiusSm },
  subtaskRow: { display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 0 9px 40px', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', background: 'var(--surface-raised)' },
  dragHandle: { color: '#c8c7c3', fontSize: '13px', lineHeight: 1, flexShrink: 0, userSelect: 'none', padding: '4px', margin: '-4px -2px' },
  checkbox: (checked) => ({ width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0, border: checked ? 'none' : `1.5px solid ${T.border}`, background: checked ? T.brand : T.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s', cursor: 'pointer' }),
  subtaskCheckbox: (checked) => ({ width: '14px', height: '14px', borderRadius: '50%', flexShrink: 0, border: checked ? 'none' : `1.5px solid ${T.border}`, background: checked ? T.brand : T.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s', cursor: 'pointer' }),
  taskName: (checked) => ({ fontSize: '13px', color: checked ? T.subtle : T.text, textDecoration: checked ? 'line-through' : 'none', flex: 1, minWidth: 0 }),
  subtaskName: (checked) => ({ fontSize: '12px', color: checked ? T.subtle : T.muted, textDecoration: checked ? 'line-through' : 'none', flex: 1 }),
  owner: { fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: T.bg, color: T.muted, fontWeight: 500, flexShrink: 0 },
  chevron: (open) => ({ fontSize: '10px', color: T.subtle, transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0 }),
  subtaskCount: { fontSize: '11px', color: T.subtle, flexShrink: 0 },
  rowBtn: { fontSize: '11px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, padding: '2px 4px' },
  expandedPanel: { background: 'var(--surface-raised)', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '14px', marginTop: '2px', marginBottom: '4px' },
  noteLabel: { fontSize: '11px', color: T.muted, marginBottom: '6px', fontWeight: 500 },
  noteInput: { width: '100%', border: `1px solid ${T.border}`, borderRadius: T.radiusSm, padding: '8px 10px', fontSize: '13px', fontFamily: 'inherit', outline: 'none', background: T.surface, color: T.text, resize: 'vertical', minHeight: '60px', boxSizing: 'border-box' },
  noteHint: { fontSize: '11px', color: T.subtle, marginTop: '6px' },
  noteIndicator: { fontSize: '11px', color: T.brand, marginLeft: '4px' },
  input: { border: `1px solid ${T.border}`, borderRadius: '7px', padding: '8px 10px', fontSize: '13px', fontFamily: 'inherit', outline: 'none', background: T.surface, color: T.text },
  addForm: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', padding: '10px 6px 4px' },
  addBtn: { fontSize: '12px', color: T.brand, background: 'none', border: 'none', cursor: 'pointer', padding: '8px 6px', fontFamily: 'inherit', display: 'block' },
  emptyBucket: { fontSize: '12px', color: '#c8c7c3', padding: '10px 6px', fontStyle: 'italic' },
  btnPrimary: { background: T.text, color: '#fff', border: 'none', borderRadius: '7px', padding: '9px 18px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' },
  btnSecondary: { background: 'transparent', color: T.muted, border: `1px solid ${T.border}`, borderRadius: '7px', padding: '9px 18px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' },
  footer: { borderTop: `1px solid ${T.border}`, padding: '24px 40px', display: 'flex', gap: '8px' },
}

export default function OnboardingPlan({ session, userProfile, instanceId, onBack, onNavigate }) {
  const {
    instance, setInstance,
    tasks, subtasksFor, isTaskComplete,
    completions, notes,
    expanded, setExpanded,
    expandedTasks, setExpandedTasks,
    documents, docCompletions,
    loading, uploading,
    modal, setModal,
    inviteSent, inviting,
    editingEmployee, setEditingEmployee,
    showHiddenDocs, setShowHiddenDocs,
    fetchError, noteSaveState,
    toast, hideToast,
    noteTimers,
    fetchPlan,
    toggleTask, moveTask, addTask, editTask, removeTask,
    saveNote, handleNoteChange,
    toggleDocument, hideDocument, restoreDocument, handleUploadDocument,
    handleMarkComplete, handleArchive, handleDeleteEmployee, handleInviteEmployee,
    totalTasks, completedTasksCount, pct,
  } = useOnboardingPlan({ instanceId, onBack })

  const canEdit = ['admin', 'super_admin'].includes(userProfile?.role)

  const [draggingId, setDraggingId] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [addingToBucket, setAddingToBucket] = useState(null)
  const [newName, setNewName] = useState('')
  const [newOwner, setNewOwner] = useState('HR')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editOwner, setEditOwner] = useState('HR')
  const [editBucket, setEditBucket] = useState(SCHEDULE_BUCKETS[0])
  const [flashId, setFlashId] = useState(null)
  const flashTimer = useRef(null)

  // Briefly highlight a row after it lands in a new spot
  function flashTask(id) {
    clearTimeout(flashTimer.current)
    setFlashId(id)
    flashTimer.current = setTimeout(() => setFlashId(null), 1200)
  }
  useEffect(() => () => clearTimeout(flashTimer.current), [])

  // Native HTML5 drag doesn't scroll the window in all browsers (notably
  // Firefox), and the schedule is long — nudge the viewport when the drag
  // pointer nears the top or bottom edge.
  useEffect(() => {
    if (!draggingId) return
    const EDGE = 90
    const onDragOver = (e) => {
      const y = e.clientY
      const h = window.innerHeight
      if (y < EDGE) window.scrollBy(0, -Math.ceil((EDGE - y) / 4))
      else if (y > h - EDGE) window.scrollBy(0, Math.ceil((y - (h - EDGE)) / 4))
    }
    window.addEventListener('dragover', onDragOver)
    return () => window.removeEventListener('dragover', onDragOver)
  }, [draggingId])

  const checkIcon = (size = 9) => (
    <svg width={size} height={size - 2} viewBox="0 0 10 8" fill="none">
      <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )

  function handleDragStart(e, task) {
    if (!canEdit) return
    setDraggingId(task.id)
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', task.id) } catch (_) { /* some browsers require this call */ }
  }
  function handleDragEnd() { setDraggingId(null); setDropTarget(null) }
  function handleRowDragOver(e, task, index, bucketTasks) {
    if (!draggingId) return
    e.preventDefault(); e.stopPropagation()
    // Top half of the row inserts before it, bottom half inserts after
    // (i.e. before the next row, or appended when it's the last row).
    const rect = e.currentTarget.getBoundingClientRect()
    const after = e.clientY > rect.top + rect.height / 2
    const beforeId = after ? (bucketTasks[index + 1]?.id ?? null) : task.id
    setDropTarget({ bucket: task.bucket, beforeId })
  }
  function handleBucketDragOver(e, bucket) {
    if (!draggingId) return
    e.preventDefault()
    setDropTarget({ bucket, beforeId: null })
  }
  function handleBucketDrop(e, bucket) {
    if (!draggingId) return
    e.preventDefault()
    const before = dropTarget && dropTarget.bucket === bucket ? dropTarget.beforeId : null
    const id = draggingId
    setDraggingId(null); setDropTarget(null)
    moveTask(id, bucket, before)
    flashTask(id)
  }

  function startAdd(bucket) {
    setAddingToBucket(bucket); setNewName(''); setNewOwner('HR')
  }
  async function submitAdd(bucket) {
    if (!newName.trim()) return
    await addTask(bucket, newName, newOwner)
    setNewName(''); setAddingToBucket(null)
  }
  function startEdit(task) {
    setEditingId(task.id); setEditName(task.name); setEditOwner(task.owner || 'HR'); setEditBucket(task.bucket)
  }
  async function submitEdit(task) {
    if (!editName.trim()) return
    await editTask(task.id, editName, editOwner)
    if (editBucket !== task.bucket) {
      await moveTask(task.id, editBucket, null)
      flashTask(task.id)
    }
    setEditingId(null)
  }

  if (loading) return (
    <Layout session={session} userProfile={userProfile} currentPage="dashboard" onNavigate={onNavigate}>
      <div style={{ padding: '28px 40px 24px', borderBottom: '1px solid var(--border)' }}>
        <SkeletonLine width="120px" height="12px" style={{ marginBottom: '16px' }} />
        <SkeletonLine width="220px" height="22px" style={{ marginBottom: '8px' }} />
        <SkeletonLine width="280px" height="13px" style={{ marginBottom: '20px' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <SkeletonLine width="160px" height="12px" />
          <SkeletonLine width="240px" height="4px" />
          <SkeletonLine width="32px" height="12px" />
        </div>
      </div>
      <div style={{ padding: '32px 40px', maxWidth: '780px' }}>
        <SkeletonLine width="90px" height="11px" style={{ marginBottom: '14px' }} />
        <SkeletonTaskRow /><SkeletonTaskRow /><SkeletonTaskRow />
        <SkeletonLine width="100px" height="11px" style={{ margin: '28px 0 14px' }} />
        <SkeletonTaskRow /><SkeletonTaskRow />
      </div>
    </Layout>
  )

  if (fetchError) return (
    <Layout session={session} userProfile={userProfile} currentPage="dashboard" onNavigate={onNavigate}>
      <div style={{ padding: '80px 40px', textAlign: 'center', fontFamily: 'Inter, -apple-system, sans-serif' }}>
        <div style={{ color: '#c04040', fontSize: '14px', marginBottom: '12px' }}>{fetchError}</div>
        <button onClick={fetchPlan} style={{ fontSize: '13px', color: 'var(--brand)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
          Try again
        </button>
      </div>
    </Layout>
  )

  const visibleDocs = documents.filter(doc => !docCompletions[doc.id]?.hidden)
  const hiddenDocs = documents.filter(doc => docCompletions[doc.id]?.hidden)
  const parentsByBucket = groupParentsByBucket(tasks)
  const hireDate = instance.employees.hire_date

  function renderTaskRow(task, index, bucketTasks) {
    const subtasks = subtasksFor(task)
    const hasSubtasks = subtasks.length > 0
    const isTaskExpanded = expandedTasks[task.id]
    const isChecked = isTaskComplete(task)
    const completedSubtasks = subtasks.filter(s => completions[s.id]).length
    const hasNote = notes[task.id] && notes[task.id].trim().length > 0
    const isNoteExpanded = expanded === task.id
    const isDragging = draggingId === task.id
    const showInsertLine = draggingId && draggingId !== task.id && dropTarget && dropTarget.beforeId === task.id

    if (editingId === task.id) {
      return (
        <div key={task.id} style={{ ...STYLES.addForm, borderBottom: '1px solid var(--border-subtle)' }}>
          <input style={{ ...STYLES.input, flex: 1, minWidth: '160px' }} value={editName} autoFocus
            onChange={e => setEditName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitEdit(task); if (e.key === 'Escape') setEditingId(null) }} />
          <select style={STYLES.input} value={editOwner} onChange={e => setEditOwner(e.target.value)} aria-label="Owner">
            {OWNERS.map(o => <option key={o}>{o}</option>)}
          </select>
          <select style={STYLES.input} value={editBucket} onChange={e => setEditBucket(e.target.value)} aria-label="Schedule" title="Move to another day">
            {SCHEDULE_BUCKETS.map(b => <option key={b}>{b}</option>)}
          </select>
          <button style={STYLES.btnPrimary} onClick={() => submitEdit(task)}>Save</button>
          <button style={{ ...STYLES.rowBtn, color: 'var(--muted)' }} onClick={() => setEditingId(null)}>Cancel</button>
        </div>
      )
    }

    return (
      <div key={task.id}>
        {showInsertLine && <div style={{ height: '2px', background: '#0066cc', borderRadius: '2px', margin: '0 6px' }} />}
        <div
          className={`il-row${flashId === task.id ? ' il-row-flash' : ''}`}
          draggable={canEdit}
          onDragStart={e => handleDragStart(e, task)}
          onDragEnd={handleDragEnd}
          onDragOver={e => handleRowDragOver(e, task, index, bucketTasks)}
          style={{ ...STYLES.parentRow, opacity: isDragging ? 0.4 : 1, background: isDragging ? '#f0f7ff' : 'transparent' }}
          onClick={() => hasSubtasks ? setExpandedTasks(prev => ({ ...prev, [task.id]: !prev[task.id] })) : setExpanded(isNoteExpanded ? null : task.id)}>
          {canEdit && <span className="il-drag-handle" style={STYLES.dragHandle} title="Drag to another day" onClick={e => e.stopPropagation()}>⠿</span>}
          {hasSubtasks ? (
            <div style={{ ...STYLES.checkbox(isChecked), cursor: 'default' }} onClick={e => e.stopPropagation()} title="Completion is driven by subtasks">
              {isChecked && checkIcon()}
            </div>
          ) : (
            <div style={STYLES.checkbox(isChecked)} onClick={(e) => toggleTask(task.id, completions[task.id], e)}>
              {isChecked && checkIcon()}
            </div>
          )}
          <div style={STYLES.taskName(isChecked)}>
            {task.name}
            {!hasSubtasks && hasNote && !isNoteExpanded && (
              <span style={STYLES.noteIndicator}>· note</span>
            )}
          </div>
          {hasSubtasks && <span style={STYLES.subtaskCount}>{completedSubtasks}/{subtasks.length}</span>}
          {task.owner && <div style={STYLES.owner}>{task.owner}</div>}
          {canEdit && (
            <>
              <button style={{ ...STYLES.rowBtn, color: 'var(--brand)' }} onClick={e => { e.stopPropagation(); startEdit(task) }}>Edit</button>
              <button style={{ ...STYLES.rowBtn, color: '#c04040' }} onClick={e => { e.stopPropagation(); removeTask(task.id) }}>Remove</button>
            </>
          )}
          {hasSubtasks && <span style={STYLES.chevron(isTaskExpanded)}>▶</span>}
        </div>

        {hasSubtasks && isTaskExpanded && (
          <div>
            {subtasks.map(s => (
              <div key={s.id} className="il-row" style={STYLES.subtaskRow} onClick={(e) => toggleTask(s.id, completions[s.id], e)}>
                <div className="il-checkbox" style={STYLES.subtaskCheckbox(completions[s.id])}>
                  {completions[s.id] && checkIcon(7)}
                </div>
                <div style={STYLES.subtaskName(completions[s.id])}>{s.name}</div>
              </div>
            ))}
          </div>
        )}

        {!hasSubtasks && isNoteExpanded && (
          <div style={STYLES.expandedPanel} onClick={e => e.stopPropagation()}>
            <div style={STYLES.noteLabel}>Note</div>
            <textarea
              style={STYLES.noteInput}
              value={notes[task.id] || ''}
              onChange={e => handleNoteChange(task.id, e.target.value)}
              onBlur={e => { clearTimeout(noteTimers.current[task.id]); saveNote(task.id, e.target.value) }}
              placeholder="Add a note about this task..."
            />
            <div style={{ ...STYLES.noteHint, color: noteSaveState[task.id] === 'saved' ? '#1a7a4a' : '#a4a39f' }}>
              {noteSaveState[task.id] === 'saving' ? 'Saving…' : noteSaveState[task.id] === 'saved' ? '✓ Saved' : 'Saves automatically.'}
            </div>
          </div>
        )}
      </div>
    )
  }

  function renderBucket(bucket) {
    const bucketTasks = parentsByBucket[bucket] || []
    if (bucketTasks.length === 0 && !canEdit) return null
    const complete = bucketTasks.length > 0 && bucketTasks.every(isTaskComplete)
    const dateHint = bucketDateHint(hireDate, bucket)
    const isDropTarget = draggingId && dropTarget && dropTarget.bucket === bucket
    const isAdding = addingToBucket === bucket

    return (
      <div
        key={bucket}
        onDragOver={e => handleBucketDragOver(e, bucket)}
        onDrop={e => handleBucketDrop(e, bucket)}
        style={{
          marginBottom: '18px', borderRadius: '8px',
          // While a drag is in flight, faintly outline every bucket so all
          // valid drop zones are visible; the hovered one gets the bold cue.
          outline: isDropTarget ? '2px dashed #0066cc' : draggingId ? '1px dashed #d8d7d3' : 'none',
          outlineOffset: '2px',
          background: isDropTarget ? '#f7fbff' : 'transparent',
          transition: 'background 0.12s',
        }}>
        <div style={STYLES.bucketHeader}>
          <span style={STYLES.bucketName(complete)}>{bucket}</span>
          {dateHint && <span style={STYLES.bucketDate}>{dateHint}</span>}
          {bucketTasks.length > 0 && (
            <span style={STYLES.bucketCount}>
              {bucketTasks.filter(isTaskComplete).length}/{bucketTasks.length}{complete ? ' · Complete' : ''}
            </span>
          )}
        </div>

        {bucketTasks.length === 0 && canEdit && !isAdding && (
          <div style={STYLES.emptyBucket}>{draggingId ? 'Drop here' : 'No tasks'}</div>
        )}

        {bucketTasks.map(renderTaskRow)}

        {/* trailing insert line when appending to end of this bucket */}
        {draggingId && dropTarget && dropTarget.bucket === bucket && dropTarget.beforeId === null && bucketTasks.length > 0 && (
          <div style={{ height: '2px', background: '#0066cc', borderRadius: '2px', margin: '0 6px' }} />
        )}

        {canEdit && (isAdding ? (
          <div style={STYLES.addForm}>
            <input style={{ ...STYLES.input, flex: 1, minWidth: '160px' }} placeholder="Task name" value={newName} autoFocus
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitAdd(bucket); if (e.key === 'Escape') setAddingToBucket(null) }} />
            <select style={STYLES.input} value={newOwner} onChange={e => setNewOwner(e.target.value)}>
              {OWNERS.map(o => <option key={o}>{o}</option>)}
            </select>
            <button style={STYLES.btnPrimary} onClick={() => submitAdd(bucket)}>Add</button>
            <button style={{ ...STYLES.rowBtn, color: 'var(--muted)' }} onClick={() => setAddingToBucket(null)}>Cancel</button>
          </div>
        ) : (
          <button style={STYLES.addBtn} onClick={() => startAdd(bucket)}>+ Add task</button>
        ))}
      </div>
    )
  }

  return (
    <Layout session={session} userProfile={userProfile} currentPage="dashboard" onNavigate={onNavigate}>
      <div style={STYLES.header}>
        <button style={STYLES.backLink} onClick={onBack}>
          <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 2L4 7l5 5"/></svg>
          Back to dashboard
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={STYLES.title}>{instance.employees.full_name}</div>
          <button onClick={() => setEditingEmployee(true)} style={{ fontSize: '12px', color: 'var(--muted)', background: 'none', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>Edit</button>
          <button onClick={handleDeleteEmployee} style={{ fontSize: '12px', color: '#c04040', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '4px 2px' }}>Delete</button>
        </div>
        <div style={STYLES.sub}>
          {instance.employees.roles?.name} · Started {formatDate(instance.employees.hire_date)}
        </div>
        <div style={STYLES.progressRow}>
          <span style={STYLES.progressText}>{completedTasksCount()} of {totalTasks()} tasks complete</span>
          <div style={STYLES.progressTrack}><div style={{ ...STYLES.progressFill, width: `${pct()}%`, background: pct() === 100 ? '#1a7a4a' : '#0066cc' }}></div></div>
          <span style={{ ...STYLES.progressPct, color: pct() === 100 ? '#1a7a4a' : '#0066cc' }}>{pct()}%</span>
        </div>
      </div>

      <div style={STYLES.content}>

        <div style={{ marginBottom: '36px' }}>
          <div style={STYLES.sectionLabel}>
            <span>Documents</span>
            <label style={STYLES.uploadLink}>
              {uploading ? 'Uploading...' : '+ Upload document'}
              <input type="file" style={{ display: 'none' }} onChange={handleUploadDocument} accept=".pdf,.doc,.docx" />
            </label>
          </div>

          {visibleDocs.length === 0 && hiddenDocs.length === 0 && (
            <div style={{ fontSize: '13px', color: 'var(--subtle)', padding: '12px 0' }}>No documents in the library yet.</div>
          )}

          {visibleDocs.map(doc => {
            const dc = docCompletions[doc.id]
            const signed = dc?.signed || false
            const completedFileUrl = dc?.resolvedUrl || dc?.completed_file_url || null
            return (
              <div key={doc.id} style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px', marginBottom: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 0 4px' }} onClick={(e) => toggleDocument(doc.id, e)}>
                  <div style={STYLES.checkbox(signed)}>
                    {signed && checkIcon()}
                  </div>
                  <div style={STYLES.taskName(signed)}>{doc.name}</div>
                  <a href={doc.file_url} target="_blank" rel="noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{ fontSize: '12px', color: 'var(--brand)', textDecoration: 'none', flexShrink: 0 }}>
                    View
                  </a>
                  <button
                    onClick={(e) => { e.stopPropagation(); hideDocument(doc.id) }}
                    style={{ fontSize: '11px', color: 'var(--subtle)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                    Hide
                  </button>
                </div>
                {completedFileUrl && (
                  <div style={{ paddingLeft: '32px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', color: '#1a7a4a' }}>✓ Employee uploaded</span>
                    <a href={completedFileUrl} target="_blank" rel="noreferrer"
                      style={{ fontSize: '12px', color: 'var(--brand)', textDecoration: 'none' }}>
                      Download
                    </a>
                  </div>
                )}
              </div>
            )
          })}

          {hiddenDocs.length > 0 && (
            <div style={{ marginTop: '8px' }}>
              <button
                onClick={() => setShowHiddenDocs(prev => !prev)}
                style={{ fontSize: '12px', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                {showHiddenDocs ? `Collapse (${hiddenDocs.length} shown)` : `Show hidden (${hiddenDocs.length})`}
              </button>
              {showHiddenDocs && hiddenDocs.map(doc => (
                <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', opacity: 0.5 }}>
                  <div style={{ flex: 1, fontSize: '13px', color: 'var(--muted)', textDecoration: 'line-through' }}>{doc.name}</div>
                  <button
                    onClick={() => restoreDocument(doc.id)}
                    style={{ fontSize: '12px', color: 'var(--brand)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={STYLES.sectionLabel}>
          <span>Onboarding schedule</span>
          {canEdit && <span style={{ fontSize: '11px', color: 'var(--subtle)', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>Drag tasks to reschedule</span>}
        </div>

        {BUCKET_SECTIONS.map(section => {
          const showHeading = section.buckets.length > 1 || section.label !== section.buckets[0]
          const renderedBuckets = section.buckets.map(renderBucket).filter(Boolean)
          if (renderedBuckets.length === 0) return null
          return (
            <div key={section.label}>
              {showHeading && <div style={STYLES.weekHeading}>{section.label}</div>}
              {renderedBuckets}
            </div>
          )
        })}
      </div>

      <div style={STYLES.footer}>
        <button style={STYLES.btnPrimary} onClick={handleMarkComplete}>Mark as complete</button>
        <button style={STYLES.btnSecondary} onClick={handleArchive}>Archive</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          {inviteSent ? (
            <span style={{ fontSize: '13px', color: '#1a7a4a' }}>Invite sent</span>
          ) : (
            <button onClick={handleInviteEmployee} disabled={inviting}
              style={{ background: 'transparent', color: 'var(--brand)', border: '1px solid #0066cc', borderRadius: '7px', padding: '9px 18px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
              {inviting ? 'Sending...' : 'Invite to portal'}
            </button>
          )}
        </div>
      </div>

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

      {editingEmployee && (
        <EditEmployeeModal
          employee={instance.employees}
          instanceId={instanceId}
          onClose={() => setEditingEmployee(false)}
          onSave={(updated) => {
            setInstance(prev => ({ ...prev, employees: { ...prev.employees, ...updated } }))
            setEditingEmployee(false)
            fetchPlan()
          }}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={hideToast} />}
    </Layout>
  )
}
