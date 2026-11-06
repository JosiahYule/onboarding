import { supabase } from '../supabaseClient'
import { getHrEmail } from './getHrEmail'
import { escapeHtml } from './escapeHtml'

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

// Sends the same notification to HR and to the signed-in employee's own
// manager. Employees can't read other employee records, so the manager's
// address comes from get_my_manager_email(), which returns only the caller's
// manager. Resolves to { hr, manager }: true when sent, false when it failed,
// null when there was nobody to send to.
export async function notifyHrAndManager({ subject, html }) {
  const [hrEmail, { data: managerEmail }] = await Promise.all([
    getHrEmail(),
    supabase.rpc('get_my_manager_email').then(r => r, () => ({ data: null })),
  ])
  const sameAddress = hrEmail && managerEmail && hrEmail.toLowerCase() === managerEmail.toLowerCase()
  const [hr, manager] = await Promise.all([
    hrEmail ? sendEmail({ to: hrEmail, subject, html }) : null,
    managerEmail && !sameAddress ? sendEmail({ to: managerEmail, subject, html }) : null,
  ])
  return { hr, manager }
}
