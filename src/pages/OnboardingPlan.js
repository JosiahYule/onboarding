import { useState, useEffect, useRef } from 'react'
import Layout from '../components/Layout'
import { SkeletonLine, SkeletonTaskRow } from '../components/Skeleton'
import ConfirmModal from '../components/ConfirmModal'
import EditEmployeeModal from '../components/EditEmployeeModal'
import Toast from '../components/Toast'
import { useOnboardingPlan } from '../hooks/useOnboardingPlan'
import { useWindowSize } from '../hooks/useWindowSize'
import { BUCKET_SECTIONS, SCHEDULE_BUCKETS, brandName } from '../config'
import { groupParentsByBucket, bucketDateHint } from '../utils/schedule'
import { formatDate } from '../utils/dates'
import { getPhase } from '../utils/onboardingPhase'
import PageHeader from '../ui/PageHeader'
import Button from '../ui/Button'
import Menu from '../ui/Menu'
import CheckCircle from '../ui/CheckCircle'
import Segmented from '../ui/Segmented'
import FileButton from '../ui/FileButton'
import EmptyState, { EmptyIcons } from '../ui/EmptyState'
import { T } from '../ui/theme'

const OWNERS = ['HR', 'Manager', 'IT']

const S = {
  card: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '18px 20px', boxShadow: T.shadowSm },
  cardTitle: { fontSize: '11px', fontWeight: 600, color: T.subtle, textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 },
  weekHeading: { fontSize: '11px', fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.6px', margin: '28px 0 8px' },
  bucketHeader: { display: 'flex', alignItems: 'center', gap: '8px', minHeight: '34px', padding: '4px 6px', borderBottom: `1px solid ${T.borderSubtle}` },
  row: { display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 6px', borderBottom: `1px solid ${T.borderSubtle}`, borderRadius: T.radiusSm },
  subRow: { display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 6px 8px 42px', borderBottom: `1px solid ${T.borderSubtle}`, background: T.surfaceSunken },
  taskMain: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0', background: 'none', border: 'none', font: 'inherit', textAlign: 'left', cursor: 'pointer', color: 'inherit' },
  owner: { fontSize: '11px', padding: '2px 8px', borderRadius: '99px', background: T.hoverBg, color: T.muted, fontWeight: 500, flexShrink: 0 },
  handle: { color: T.subtle, fontSize: '13px', lineHeight: 1, flexShrink: 0, userSelect: 'none', padding: '4px', margin: '-4px -2px' },
  form: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', padding: '10px 6px', borderBottom: `1px solid ${T.borderSubtle}` },
  insertLine: { height: '2px', background: T.brand, borderRadius: '2px', margin: '0 6px' },
  detailRow: { display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '7px 0', fontSize: '13px', borderBottom: `1px solid ${T.borderSubtle}` },
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

  const { isMobile, width } = useWindowSize()
  const wide = width >= 1180
  const canEdit = ['admin', 'super_admin'].includes(userProfile?.role)
  const canDrag = canEdit && !isMobile

  const [view, setView] = useState('all')
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

  function handleDragStart(e, task) {
    if (!canDrag) return
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

  const px = isMobile ? '16px' : '40px'

  if (loading) return (
    <Layout session={session} userProfile={userProfile} currentPage="dashboard" onNavigate={onNavigate}>
      <div style={{ padding: `26px ${px} 22px`, borderBottom: `1px solid ${T.border}` }} aria-busy="true" aria-label="Loading onboarding plan">
        <SkeletonLine width="80px" height="11px" style={{ marginBottom: '14px' }} />
        <SkeletonLine width="220px" height="22px" style={{ marginBottom: '8px' }} />
        <SkeletonLine width="280px" height="13px" style={{ marginBottom: '18px' }} />
        <SkeletonLine width="320px" height="6px" />
      </div>
      <div style={{ padding: `28px ${px}`, maxWidth: '780px' }}>
        <SkeletonLine width="90px" height="11px" style={{ marginBottom: '14px' }} />
        <SkeletonTaskRow /><SkeletonTaskRow /><SkeletonTaskRow />
        <SkeletonLine width="100px" height="11px" style={{ margin: '28px 0 14px' }} />
        <SkeletonTaskRow /><SkeletonTaskRow />
      </div>
    </Layout>
  )

  if (fetchError) return (
    <Layout session={session} userProfile={userProfile} currentPage="dashboard" onNavigate={onNavigate}>
      <PageHeader title="Onboarding plan" back={{ label: 'Dashboard', onClick: onBack }} />
      <EmptyState icon={EmptyIcons.alert} title="Couldn't load this plan" message={fetchError}
        action={<Button variant="secondary" onClick={fetchPlan}>Try again</Button>} />
    </Layout>
  )

  const emp = instance.employees
  const visibleDocs = documents.filter(doc => !docCompletions[doc.id]?.hidden)
  const hiddenDocs = documents.filter(doc => docCompletions[doc.id]?.hidden)
  const receivedCount = visibleDocs.filter(doc => docCompletions[doc.id]?.signed).length
  const parentsByBucket = groupParentsByBucket(tasks)
  const hireDate = emp.hire_date
  const phase = getPhase(hireDate)
  const done = completedTasksCount()
  const total = totalTasks()
  const percent = pct()
  const remainingOnly = view === 'remaining'
  const hasStarted = phase.tone !== 'neutral'

  function renderTaskRow(task, index, bucketTasks) {
    const subtasks = subtasksFor(task)
    const hasSubtasks = subtasks.length > 0
    const isTaskExpanded = !!expandedTasks[task.id]
    const isChecked = isTaskComplete(task)
    const completedSubtasks = subtasks.filter(s => completions[s.id]).length
    const hasNote = !!(notes[task.id] && notes[task.id].trim())
    const isNoteExpanded = expanded === task.id
    const isDragging = draggingId === task.id
    const showInsertLine = draggingId && draggingId !== task.id && dropTarget && dropTarget.beforeId === task.id

    if (editingId === task.id) {
      return (
        <div key={task.id} style={S.form}>
          <input className="il-input" style={{ flex: 1, minWidth: '160px', width: 'auto' }} value={editName} autoFocus aria-label="Task name"
            onChange={e => setEditName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitEdit(task); if (e.key === 'Escape') setEditingId(null) }} />
          <select className="il-input" style={{ width: 'auto' }} value={editOwner} onChange={e => setEditOwner(e.target.value)} aria-label="Owner">
            {OWNERS.map(o => <option key={o}>{o}</option>)}
          </select>
          <select className="il-input" style={{ width: 'auto' }} value={editBucket} onChange={e => setEditBucket(e.target.value)} aria-label="Scheduled for">
            {SCHEDULE_BUCKETS.map(b => <option key={b}>{b}</option>)}
          </select>
          <Button size="sm" onClick={() => submitEdit(task)} disabled={!editName.trim()}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
          <Button size="sm" variant="ghost" style={{ color: T.danger, marginLeft: 'auto' }} onClick={() => { setEditingId(null); removeTask(task.id) }}>Remove task</Button>
        </div>
      )
    }

    const toggleDetails = () => hasSubtasks
      ? setExpandedTasks(prev => ({ ...prev, [task.id]: !prev[task.id] }))
      : setExpanded(isNoteExpanded ? null : task.id)

    return (
      <div key={task.id}>
        {showInsertLine && <div style={S.insertLine} />}
        <div
          className={`il-row il-task-row${flashId === task.id ? ' il-row-flash' : ''}`}
          draggable={canDrag}
          onDragStart={e => handleDragStart(e, task)}
          onDragEnd={handleDragEnd}
          onDragOver={e => handleRowDragOver(e, task, index, bucketTasks)}
          style={{ ...S.row, opacity: isDragging ? 0.45 : 1, background: isDragging ? T.brandLight : 'transparent' }}
        >
          {canDrag && <span className="il-drag-handle" style={S.handle} title="Drag to reorder or move to another day" aria-hidden="true">⠿</span>}
          {hasSubtasks
            ? <CheckCircle checked={isChecked} title="Completes when all its subtasks are done" />
            : <CheckCircle checked={isChecked} label={`${task.name}: ${isChecked ? 'done' : 'not done'}`} onToggle={e => toggleTask(task.id, completions[task.id], e)} />}
          <button type="button" style={S.taskMain} onClick={toggleDetails} aria-expanded={hasSubtasks ? isTaskExpanded : isNoteExpanded}
            aria-label={hasSubtasks ? `${task.name}, ${completedSubtasks} of ${subtasks.length} subtasks done` : `${task.name}, ${hasNote ? 'has a note' : 'add a note'}`}>
            <span style={{ fontSize: '13px', color: isChecked ? T.subtle : T.text, textDecoration: isChecked ? 'line-through' : 'none', overflowWrap: 'anywhere' }}>{task.name}</span>
            {!hasSubtasks && hasNote && !isNoteExpanded && (
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" style={{ color: T.brand, flexShrink: 0 }}>
                <path d="M2.5 2.5h9v6.5H6L3.5 11.5V9h-1z" strokeLinejoin="round" />
              </svg>
            )}
            {task.isCustom && <span style={{ fontSize: '10px', color: T.subtle, flexShrink: 0 }}>custom</span>}
          </button>
          {hasSubtasks && <span className="il-tabular" style={{ fontSize: '11px', color: T.subtle, flexShrink: 0 }}>{completedSubtasks}/{subtasks.length}</span>}
          {task.owner && <span style={S.owner}>{task.owner}</span>}
          {canEdit && isMobile && (
            <button type="button" onClick={() => startEdit(task)} aria-label={`Edit ${task.name}`} className="il-btn-ghost"
              style={{ width: '30px', height: '30px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: 'none', border: 'none', borderRadius: T.radiusSm, color: T.subtle, cursor: 'pointer', margin: '-6px -4px -6px 0' }}>
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M9.5 2.5l2 2L5 11H3V9z" /></svg>
            </button>
          )}
          {canEdit && !isMobile && (
            <div className="il-row-actions" style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
              <Button size="xs" variant="ghost" onClick={() => startEdit(task)} aria-label={`Edit ${task.name}`}>Edit</Button>
              <Button size="xs" variant="ghost" onClick={() => removeTask(task.id)} aria-label={`Remove ${task.name}`} style={{ color: T.danger }}>Remove</Button>
            </div>
          )}
          {hasSubtasks && (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={{ color: T.subtle, flexShrink: 0, transform: isTaskExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
              <path d="M3 1.5L6.5 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
        </div>

        {hasSubtasks && isTaskExpanded && (
          <div>
            {subtasks.map(s => (
              <div key={s.id} className="il-row" style={S.subRow}>
                <CheckCircle size={15} checked={!!completions[s.id]} label={`${s.name}: ${completions[s.id] ? 'done' : 'not done'}`} onToggle={e => toggleTask(s.id, completions[s.id], e)} />
                <span style={{ fontSize: '12px', color: completions[s.id] ? T.subtle : T.muted, textDecoration: completions[s.id] ? 'line-through' : 'none', flex: 1 }}>{s.name}</span>
              </div>
            ))}
          </div>
        )}

        {!hasSubtasks && isNoteExpanded && (
          <div style={{ padding: '10px 6px 14px 34px', borderBottom: `1px solid ${T.borderSubtle}` }}>
            <label htmlFor={`note-${task.id}`} style={{ display: 'block', fontSize: '11px', color: T.muted, marginBottom: '6px', fontWeight: 500 }}>Note</label>
            <textarea
              id={`note-${task.id}`}
              className="il-input"
              value={notes[task.id] || ''}
              onChange={e => handleNoteChange(task.id, e.target.value)}
              // Flush on blur rather than waiting for the debounce, but skip the
              // write (and the "Saving…" flicker) when nothing changed.
              onBlur={e => { clearTimeout(noteTimers.current[task.id]); if ((e.target.value || '') !== (task.notes || '')) saveNote(task.id, e.target.value) }}
              placeholder="Add a note about this task…"
              autoFocus
            />
            <div aria-live="polite" style={{ fontSize: '11px', marginTop: '6px', color: noteSaveState[task.id] === 'saved' ? T.success : T.subtle }}>
              {noteSaveState[task.id] === 'saving' ? 'Saving…' : noteSaveState[task.id] === 'saved' ? '✓ Saved' : 'Saves automatically.'}
            </div>
          </div>
        )}
      </div>
    )
  }

  function renderBucket(bucket) {
    const allTasks = parentsByBucket[bucket] || []
    const bucketTasks = remainingOnly ? allTasks.filter(t => !isTaskComplete(t)) : allTasks
    const isAdding = addingToBucket === bucket
    const isDropTarget = draggingId && dropTarget && dropTarget.bucket === bucket
    if (bucketTasks.length === 0 && !isAdding && !draggingId && (remainingOnly || !canEdit)) return null

    const doneHere = allTasks.filter(isTaskComplete).length
    const complete = allTasks.length > 0 && doneHere === allTasks.length
    const dateHint = bucketDateHint(hireDate, bucket)

    return (
      <section
        key={bucket}
        aria-label={`${bucket}${dateHint ? `, ${dateHint}` : ''}`}
        onDragOver={e => handleBucketDragOver(e, bucket)}
        onDrop={e => handleBucketDrop(e, bucket)}
        style={{
          marginBottom: '14px', borderRadius: T.radiusMd,
          // While a drag is in flight, faintly outline every bucket so all
          // valid drop zones are visible; the hovered one gets the bold cue.
          outline: isDropTarget ? `2px dashed ${T.brand}` : draggingId ? `1px dashed ${T.border}` : 'none',
          outlineOffset: '2px',
          background: isDropTarget ? T.brandLight : 'transparent',
          transition: 'background 0.12s',
        }}
      >
        <div style={S.bucketHeader}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: complete ? T.success : T.text }}>{bucket}</span>
          {dateHint && <span style={{ fontSize: '11px', color: T.subtle }}>{dateHint}</span>}
          {allTasks.length === 0 && <span style={{ fontSize: '11px', color: T.subtle, fontStyle: 'italic' }}>{draggingId ? 'Drop here' : 'No tasks'}</span>}
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {allTasks.length > 0 && (
              <span className="il-tabular" style={{ fontSize: '11px', color: complete ? T.success : T.subtle, fontWeight: complete ? 600 : 400 }}>
                {complete ? '✓ Done' : `${doneHere}/${allTasks.length}`}
              </span>
            )}
            {canEdit && !isAdding && (
              <Button variant="link" size="sm" onClick={() => startAdd(bucket)} aria-label={`Add a task to ${bucket}`}>+ Add</Button>
            )}
          </span>
        </div>

        {bucketTasks.map(renderTaskRow)}

        {/* trailing insert line when appending to end of this bucket */}
        {draggingId && dropTarget && dropTarget.bucket === bucket && dropTarget.beforeId === null && bucketTasks.length > 0 && (
          <div style={S.insertLine} />
        )}

        {canEdit && isAdding && (
          <div style={S.form}>
            <input className="il-input" style={{ flex: 1, minWidth: '160px', width: 'auto' }} placeholder="Task name" value={newName} autoFocus aria-label={`New task for ${bucket}`}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitAdd(bucket); if (e.key === 'Escape') setAddingToBucket(null) }} />
            <select className="il-input" style={{ width: 'auto' }} value={newOwner} onChange={e => setNewOwner(e.target.value)} aria-label="Owner">
              {OWNERS.map(o => <option key={o}>{o}</option>)}
            </select>
            <Button size="sm" onClick={() => submitAdd(bucket)} disabled={!newName.trim()}>Add task</Button>
            <Button size="sm" variant="ghost" onClick={() => setAddingToBucket(null)}>Cancel</Button>
          </div>
        )}
      </section>
    )
  }

  const sectionsRendered = BUCKET_SECTIONS.map(section => {
    const showHeading = section.buckets.length > 1 || section.label !== section.buckets[0]
    const renderedBuckets = section.buckets.map(renderBucket).filter(Boolean)
    if (renderedBuckets.length === 0) return null
    return (
      <div key={section.label}>
        {showHeading && <h3 style={S.weekHeading}>{section.label}</h3>}
        {renderedBuckets}
      </div>
    )
  }).filter(Boolean)

  const schedule = (
    <section aria-labelledby="schedule-heading" style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '4px' }}>
        <h2 id="schedule-heading" style={{ ...T.type.h2, margin: 0, color: T.text }}>Schedule</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {canDrag && <span style={{ fontSize: '11px', color: T.subtle }}>Drag ⠿ to reschedule</span>}
          <Segmented size="sm" label="Show tasks" value={view} onChange={setView}
            options={[{ value: 'all', label: 'All' }, { value: 'remaining', label: `Remaining (${total - done})` }]} />
        </div>
      </div>
      {sectionsRendered.length > 0 ? sectionsRendered : (
        <EmptyState compact icon={EmptyIcons.check} title={remainingOnly ? 'All caught up' : 'No tasks yet'}
          message={remainingOnly ? 'Every task in this plan is done.' : 'This role’s template has no tasks. Add some to any day above, or set up the role’s template.'} />
      )}
    </section>
  )

  const details = (
    <section aria-labelledby="details-heading" style={S.card}>
      <h2 id="details-heading" style={{ ...S.cardTitle, marginBottom: '8px' }}>Details</h2>
      {[
        ['Email', emp.email || <span style={{ color: T.subtle }}>Not on file</span>],
        ['Role', emp.roles?.name || '—'],
        ['Agency', brandName(emp.brand) || '—'],
        ['Start date', formatDate(hireDate)],
        ['Phase', phase.label],
      ].map(([k, v]) => (
        <div key={k} style={S.detailRow}>
          <span style={{ color: T.muted, flexShrink: 0 }}>{k}</span>
          <span style={{ color: T.text, textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{v}</span>
        </div>
      ))}
      <div style={{ ...S.detailRow, borderBottom: 'none' }}>
        <span style={{ color: T.muted }}>Portal access</span>
        {inviteSent
          ? <span style={{ color: T.success }}>Invite sent</span>
          : canEdit && emp.email
            ? <Button variant="link" size="sm" busy={inviting} busyLabel="Sending…" onClick={handleInviteEmployee}>Send invite</Button>
            : <span style={{ color: T.subtle }}>{emp.email ? '—' : 'Needs an email'}</span>}
      </div>
    </section>
  )

  const docs = (
    <section aria-labelledby="docs-heading" style={S.card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
        <h2 id="docs-heading" style={S.cardTitle}>
          Documents {visibleDocs.length > 0 && <span className="il-tabular" style={{ color: T.muted, textTransform: 'none', letterSpacing: 0 }}>· {receivedCount}/{visibleDocs.length} received</span>}
        </h2>
        {canEdit && (
          <FileButton variant="link" icon={false} busy={uploading} onFile={handleUploadDocument} accept=".pdf,.doc,.docx"
            title="Adds the file to the document library, so every employee sees it">
            + Add to library
          </FileButton>
        )}
      </div>

      {visibleDocs.length === 0 && hiddenDocs.length === 0 && (
        <div style={{ fontSize: '13px', color: T.subtle, padding: '8px 0' }}>No documents in the library yet.</div>
      )}

      {visibleDocs.map(doc => {
        const dc = docCompletions[doc.id]
        const received = dc?.signed || false
        const completedFileUrl = dc?.resolvedUrl || dc?.completed_file_url || null
        return (
          <div key={doc.id} className="il-task-row" style={{ padding: '9px 0', borderBottom: `1px solid ${T.borderSubtle}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <CheckCircle size={16} checked={received} label={`${doc.name}: ${received ? 'received' : 'not received'}`}
                onToggle={canEdit ? e => toggleDocument(doc.id, e) : undefined} />
              <span style={{ flex: 1, minWidth: 0, fontSize: '13px', color: received ? T.muted : T.text, overflowWrap: 'anywhere' }}>{doc.name}</span>
              <a href={doc.file_url} target="_blank" rel="noreferrer" className="il-btn-link" style={{ fontSize: '12px', color: T.brand, textDecoration: 'none', flexShrink: 0 }}>View</a>
              {canEdit && (
                <span className="il-row-actions">
                  <Button variant="link" size="sm" style={{ color: T.subtle }} onClick={() => hideDocument(doc.id)} aria-label={`Hide ${doc.name} for this employee`}>Hide</Button>
                </span>
              )}
            </div>
            {completedFileUrl && (
              <div style={{ paddingLeft: '26px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                <span style={{ color: T.success }}>✓ Employee uploaded</span>
                <a href={completedFileUrl} target="_blank" rel="noreferrer" className="il-btn-link" style={{ color: T.brand, textDecoration: 'none' }}>Download</a>
              </div>
            )}
          </div>
        )
      })}

      {hiddenDocs.length > 0 && (
        <div style={{ marginTop: '8px' }}>
          <Button variant="link" size="sm" style={{ color: T.muted }} aria-expanded={showHiddenDocs} onClick={() => setShowHiddenDocs(prev => !prev)}>
            {showHiddenDocs ? 'Hide hidden documents' : `Show hidden (${hiddenDocs.length})`}
          </Button>
          {showHiddenDocs && hiddenDocs.map(doc => (
            <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: `1px solid ${T.borderSubtle}` }}>
              <div style={{ flex: 1, fontSize: '13px', color: T.subtle, textDecoration: 'line-through' }}>{doc.name}</div>
              {canEdit && <Button variant="link" size="sm" onClick={() => restoreDocument(doc.id)}>Restore</Button>}
            </div>
          ))}
        </div>
      )}
    </section>
  )

  const headerActions = canEdit ? (
    <>
      <Button size="sm" variant={percent === 100 ? 'primary' : 'secondary'} onClick={handleMarkComplete}>Mark complete</Button>
      <Menu label="More actions for this onboarding" items={[
        { label: 'Edit details', onClick: () => setEditingEmployee(true) },
        { label: inviteSent ? 'Invite sent' : 'Send portal invite', onClick: handleInviteEmployee, disabled: inviteSent || inviting || !emp.email, hint: emp.email ? null : 'Add an email first' },
        { label: 'Archive onboarding', onClick: handleArchive, hint: 'Moves it to History' },
        'divider',
        { label: 'Delete employee…', onClick: handleDeleteEmployee, danger: true },
      ]} />
    </>
  ) : null

  return (
    <Layout session={session} userProfile={userProfile} currentPage="dashboard" onNavigate={onNavigate}>
      <PageHeader
        title={emp.full_name}
        subtitle={[emp.roles?.name, brandName(emp.brand), hireDate && `${hasStarted ? 'Started' : 'Starts'} ${formatDate(hireDate)}`].filter(Boolean).join(' · ')}
        back={{ label: 'Dashboard', onClick: onBack }}
        actions={headerActions}
      >
        <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <div role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Onboarding progress"
            style={{ flex: '1 1 200px', maxWidth: '360px', height: '6px', background: T.borderSubtle, borderRadius: '99px', overflow: 'hidden' }}>
            <div className="il-progress-fill" style={{ height: '100%', width: `${percent}%`, borderRadius: '99px', background: percent === 100 ? T.success : `linear-gradient(90deg, ${T.brand}, ${T.brandMid})` }} />
          </div>
          <span className="il-tabular" style={{ fontSize: '12px', color: T.muted }}>
            <strong style={{ color: percent === 100 ? T.success : T.text, fontWeight: 600 }}>{percent}%</strong> · {done} of {total} tasks
          </span>
        </div>
      </PageHeader>

      <div style={{
        padding: `${isMobile ? 20 : 28}px ${px} 48px`,
        display: 'grid', gap: wide ? '32px' : '20px', alignItems: 'start',
        gridTemplateColumns: wide ? 'minmax(0, 1fr) 330px' : 'minmax(0, 1fr)',
        maxWidth: wide ? '1240px' : '820px',
      }}>
        {wide ? (
          <>
            {schedule}
            <aside style={{ display: 'grid', gap: '16px' }}>{details}{docs}</aside>
          </>
        ) : (
          <>
            {docs}
            {schedule}
            {details}
          </>
        )}
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
          employee={emp}
          instanceId={instanceId}
          onClose={() => setEditingEmployee(false)}
          onSave={(updated) => {
            setInstance(prev => ({ ...prev, employees: { ...prev.employees, ...updated } }))
            setEditingEmployee(false)
            fetchPlan()
          }}
        />
      )}

      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onClose={hideToast} />}
    </Layout>
  )
}
