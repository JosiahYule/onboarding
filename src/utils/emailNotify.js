import { supabase } from '../supabaseClient'
import { escapeHtml } from './escapeHtml'
import { FEATURES } from '../config'

// A link back into the app, for the bottom of notification emails.
export function appLink(path, label) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `<p><a href="${escapeHtml(origin + path)}">${escapeHtml(label)}</a></p>`
}

// Sends one email through the send-email function. Resolves to true when it
// was accepted, false otherwise; never throws, so a mail problem can't undo
// the action that triggered it.
export async function sendEmail({ to, subject, html }) {
  if (!to) return false
  try {
    const { error } = await supabase.functions.invoke('send-email', { body: { to, subject, html } })
    if (error) { console.error('Email failed:', error); return false }
    return true
  } catch (err) {
    console.error('Email failed:', err)
    return false
  }
}

// Time-off email is deliberately inactive during preparation. The existing
// Microsoft Forms / Power Automate system is not connected or changed here.
// Before enabling this flag, complete the transport cutover documented in
// docs/time-off-launch.md. Requests saved while paused are never replayed.
export async function sendTimeOffEmail(payload) {
  if (!FEATURES.timeOffEmails) return null
  return sendEmail(payload)
}

// Resolve the recipients from the saved request, not from a client-supplied
// address or the employee's current profile manager. The RPC checks ownership.
export async function notifyTimeOffHrAndManager({ requestId, subject, html }) {
  if (!FEATURES.timeOffEmails) return { hr: null, manager: null, paused: true }
  let recipients
  try {
    const { data, error } = await supabase.rpc('get_time_off_request_recipients', { p_request_id: requestId })
    if (error || !data?.hr_email || !data?.manager_email) return { hr: false, manager: false }
    recipients = data
  } catch {
    return { hr: false, manager: false }
  }
  const { hr_email: hrEmail, manager_email: managerEmail } = recipients
  const sameAddress = hrEmail && managerEmail && hrEmail.toLowerCase() === managerEmail.toLowerCase()
  const [hr, manager] = await Promise.all([
    sendTimeOffEmail({ to: hrEmail, subject, html }),
    !sameAddress ? sendTimeOffEmail({ to: managerEmail, subject, html }) : null,
  ])
  return { hr, manager }
}
