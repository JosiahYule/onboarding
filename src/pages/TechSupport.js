import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import Layout from '../components/Layout'
import { SkeletonLine } from '../components/Skeleton'
import Toast from '../components/Toast'
import useToast from '../hooks/useToast'
import { handleSupabaseError } from '../utils/handleError'
import { logAudit } from '../utils/auditLog'
import { useWindowSize } from '../hooks/useWindowSize'
import { escapeHtml, escapeHtmlMultiline } from '../utils/escapeHtml'
import { sendEmail, appLink } from '../utils/emailNotify'
import { TICKET_STATUS, TicketStatusPill, categoryLabel, urgencyLabel } from '../utils/ticketShared'
import { T } from '../ui/theme'
import PageHeader from '../ui/PageHeader'
import Button from '../ui/Button'
import EmptyState, { EmptyIcons } from '../ui/EmptyState'
import Avatar from '../ui/Avatar'

// The admin side of the employee portal's Tech support tab: one queue of
// tickets, each moved from Open to In progress to Resolved. A response written
// here is shown to the employee on their ticket, and emailed to them when the
// ticket is resolved.

const URGENCY_RANK = { blocking: 0, normal: 1, low: 2 }

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

export default function TechSupport({ session, userProfile, onNavigate }) {
  const [view, setView] = useState('open')
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState({})
  const [savingId, setSavingId] = useState(null)
  const { toast, showToast, hideToast } = useToast()
  const { isMobile } = useWindowSize()

  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only fetch
  useEffect(() => { fetchTickets() }, [])

  async function fetchTickets() {
    const { data, error } = await supabase
      .from('tech_support_tickets')
      .select(`
        *,
        employee:employees!tech_support_tickets_employee_id_fkey(id, full_name, email),
        resolver:employees!tech_support_tickets_resolved_by_fkey(id, full_name)
      `)
      .order('created_at', { ascending: false })
    if (error) showToast(handleSupabaseError(error, 'Failed to load tickets.'), 'error')
    setTickets(data || [])
    setLoading(false)
  }

  async function updateTicket(ticket, status) {
    const note = (drafts[ticket.id] ?? ticket.admin_notes ?? '').trim()
    const resolving = status === TICKET_STATUS.RESOLVED
    setSavingId(ticket.id)
    const { error } = await supabase
      .from('tech_support_tickets')
      .update({
        status,
        admin_notes: note || null,
        resolved_at: resolving ? new Date().toISOString() : null,
        resolved_by: resolving ? (userProfile?.employee_id || null) : null,
      })
      .eq('id', ticket.id)
    if (error) { setSavingId(null); showToast(handleSupabaseError(error, 'Failed to update the ticket.'), 'error'); return }

    logAudit('ticket_updated', 'tech_support_ticket', ticket.id, { from: ticket.status, to: status })

    let emailed = null
    if (resolving && ticket.employee?.email && ticket.status !== TICKET_STATUS.RESOLVED) {
      emailed = await sendEmail({
        to: ticket.employee.email,
        subject: `Resolved: ${ticket.title}`,
        html: `<p>Hi ${escapeHtml(ticket.employee.full_name?.split(' ')[0] || '')},</p>
<p>Your tech support ticket <strong>${escapeHtml(ticket.title)}</strong> has been marked resolved.</p>
${note ? `<p><strong>Response:</strong><br/>${escapeHtmlMultiline(note)}</p>` : ''}
<p>If it's still not working, send a new ticket from your portal and mention this one.</p>
${appLink('/', 'Open your portal')}`,
      })
    }

    setSavingId(null)
    setDrafts(prev => { const next = { ...prev }; delete next[ticket.id]; return next })
    const label = status === TICKET_STATUS.RESOLVED ? 'Ticket resolved' : status === TICKET_STATUS.IN_PROGRESS ? 'Marked in progress' : 'Ticket reopened'
    if (emailed === false) showToast(`${label}, but the email to the employee failed.`, 'warning')
    else showToast(emailed ? `${label}. The employee has been emailed.` : `${label}.`)
    await fetchTickets()
  }

  async function saveNote(ticket) {
    const note = (drafts[ticket.id] ?? '').trim()
    setSavingId(ticket.id)
    const { error } = await supabase.from('tech_support_tickets').update({ admin_notes: note || null }).eq('id', ticket.id)
    setSavingId(null)
    if (error) { showToast(handleSupabaseError(error, 'Failed to save the response.'), 'error'); return }
    setDrafts(prev => { const next = { ...prev }; delete next[ticket.id]; return next })
    showToast('Response saved. The employee can see it on their ticket.')
    await fetchTickets()
  }

  const counts = {
    open: tickets.filter(t => t.status === TICKET_STATUS.OPEN).length,
    in_progress: tickets.filter(t => t.status === TICKET_STATUS.IN_PROGRESS).length,
  }
  // Waiting tickets: most urgent first, then oldest first. Resolved: newest first.
  const shown = tickets
    .filter(t => view === 'all' || t.status === view)
    .sort((a, b) => {
      if (view === 'resolved' || view === 'all') return a.created_at < b.created_at ? 1 : -1
      const u = (URGENCY_RANK[a.urgency] ?? 1) - (URGENCY_RANK[b.urgency] ?? 1)
      return u !== 0 ? u : (a.created_at < b.created_at ? -1 : 1)
    })

  const card = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, boxShadow: T.shadowSm }

  return (
    <Layout session={session} userProfile={userProfile} currentPage="tech-support" onNavigate={onNavigate}>
      <PageHeader
        title="Tech support"
        subtitle={isMobile ? null : 'Tickets sent from the employee portal. Your response shows on the employee’s ticket.'}
        tabs={{
          mode: 'tabs', label: 'Ticket views', value: view, onChange: setView,
          items: [
            { id: 'open', label: 'Open', badge: counts.open || null },
            { id: 'in_progress', label: 'In progress', badge: counts.in_progress || null },
            { id: 'resolved', label: 'Resolved' },
            { id: 'all', label: 'All' },
          ],
        }}
      />

      <div style={{ padding: isMobile ? '16px 16px 40px' : '24px 40px 48px', maxWidth: '880px' }} role="tabpanel" aria-label={view}>
        {loading ? (
          [1, 2, 3].map(i => <div key={i} style={{ ...card, padding: '18px', marginBottom: '12px' }}><SkeletonLine width={`${35 + i * 12}%`} height="13px" /></div>)
        ) : shown.length === 0 ? (
          <div style={card}>
            <EmptyState icon={EmptyIcons.doc}
              title={view === 'open' ? 'No open tickets' : view === 'in_progress' ? 'Nothing in progress' : 'No tickets here'}
              message={tickets.length === 0 ? 'When someone sends a ticket from their portal it lands here, and an email goes to the tech support address in System settings.' : 'Nothing in this view right now.'} />
          </div>
        ) : shown.map(ticket => {
          const draft = drafts[ticket.id]
          const noteValue = draft ?? ticket.admin_notes ?? ''
          const noteChanged = draft !== undefined && draft.trim() !== (ticket.admin_notes || '')
          const busy = savingId === ticket.id
          const urgent = ticket.urgency === 'blocking' && ticket.status !== TICKET_STATUS.RESOLVED
          return (
            <article key={ticket.id} style={{ ...card, padding: isMobile ? '14px 16px' : '18px 20px', marginBottom: '12px', borderLeft: urgent ? `3px solid ${T.danger}` : card.border }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
                <Avatar name={ticket.employee?.full_name} colorKey={ticket.employee?.email} size={28} />
                <h2 style={{ margin: 0, flex: '1 1 240px', fontSize: 'var(--text-md)', fontWeight: 600, color: T.text, lineHeight: 1.35 }}>{ticket.title}</h2>
                <TicketStatusPill status={ticket.status} />
              </div>
              <div style={{ fontSize: 'var(--text-sm)', color: T.muted, display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginBottom: '12px' }}>
                <span>
                  {ticket.employee?.full_name || 'Former employee'}
                  {ticket.employee?.email && <> · <a href={`mailto:${ticket.employee.email}?subject=${encodeURIComponent(`Re: ${ticket.title}`)}`} style={{ color: T.brand }}>{ticket.employee.email}</a></>}
                </span>
                <span>{categoryLabel(ticket.category)}</span>
                <span style={{ color: urgent ? T.danger : T.muted, fontWeight: urgent ? 600 : 400 }}>{urgencyLabel(ticket.urgency)}</span>
                <span title={new Date(ticket.created_at).toLocaleString('en-CA')}>{timeAgo(ticket.created_at)}</span>
              </div>
              <div style={{ fontSize: 'var(--text-base)', color: T.text, whiteSpace: 'pre-wrap', lineHeight: 1.55, marginBottom: '14px' }}>{ticket.description}</div>

              <label htmlFor={`il-resp-${ticket.id}`} style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 500, color: T.muted, marginBottom: '6px' }}>
                Response to the employee <span style={{ color: T.subtle, fontWeight: 400 }}>(optional, they can see this)</span>
              </label>
              <textarea id={`il-resp-${ticket.id}`} className="il-input" rows={2} style={{ resize: 'vertical', marginBottom: '10px' }}
                placeholder="What you did, or what they should try"
                value={noteValue} onChange={e => setDrafts(prev => ({ ...prev, [ticket.id]: e.target.value }))} />

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                {ticket.status === TICKET_STATUS.OPEN && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => updateTicket(ticket, TICKET_STATUS.IN_PROGRESS)}>Start working on it</Button>
                )}
                {ticket.status !== TICKET_STATUS.RESOLVED ? (
                  <Button size="sm" busy={busy} busyLabel="Saving…" onClick={() => updateTicket(ticket, TICKET_STATUS.RESOLVED)}>Resolve and email them</Button>
                ) : (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => updateTicket(ticket, TICKET_STATUS.OPEN)}>Reopen</Button>
                )}
                {noteChanged && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => saveNote(ticket)}>Save response only</Button>
                )}
                {ticket.status === TICKET_STATUS.RESOLVED && ticket.resolved_at && (
                  <span style={{ fontSize: 'var(--text-xs)', color: T.subtle, marginLeft: 'auto' }}>
                    Resolved {new Date(ticket.resolved_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}{ticket.resolver?.full_name ? ` by ${ticket.resolver.full_name}` : ''}
                  </span>
                )}
              </div>
            </article>
          )
        })}
      </div>

      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onClose={hideToast} />}
    </Layout>
  )
}
