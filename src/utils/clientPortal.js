import { supabase } from '../supabaseClient'

// The client onboarding portal is a separate application on its own Supabase
// project, so a rep has no session there. Rather than asking them to keep a
// second password, we hand their Integrated Launch token to the portal's
// staff-api function, which confirms with us that they are a sales rep and
// returns a one-time sign-in link.
const env = import.meta.env || {}

export const CLIENT_PORTAL_URL =
  env.REACT_APP_CLIENT_PORTAL_URL || 'https://clients.integratedstaffing.ca'

const STAFF_API_URL = env.REACT_APP_CLIENT_PORTAL_STAFF_API || ''

export function isSalesRep(userProfile) {
  return Boolean(userProfile?.is_sales_rep)
}

/**
 * Resolves to a URL that signs the rep into the client portal.
 *
 * Falls back to the portal's own sign-in page when the handoff endpoint is not
 * configured or is unreachable — the rep can still get there, they just sign in
 * themselves. A broken handoff should never be a dead end.
 */
export async function getClientPortalUrl() {
  if (!STAFF_API_URL) return CLIENT_PORTAL_URL

  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return CLIENT_PORTAL_URL

  const response = await fetch(STAFF_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action: 'portal-handoff' })
  })

  if (!response.ok) {
    let message = 'Could not sign you in to the client portal.'
    try {
      const body = await response.json()
      if (body?.error) message = body.error
    } catch {
      // Keep the default message when the body is not JSON.
    }
    const error = new Error(message)
    error.status = response.status
    throw error
  }

  const { url } = await response.json()
  return url || CLIENT_PORTAL_URL
}

/**
 * Opens the client portal in a new tab, signed in when the handoff works.
 *
 * The tab is opened synchronously, inside the click, so popup blockers allow
 * it, then pointed at the sign-in link once the handoff resolves. `noopener`
 * is deliberately not passed to window.open: with it the browser returns null
 * instead of the new tab, leaving nothing to navigate (the old behaviour: a
 * blank tab, and the app tab navigated away). Clearing `opener` gives the same
 * isolation.
 *
 * Throws only when the rep is genuinely not permitted (403); any other failure
 * falls back to the portal's own sign-in page.
 */
export async function openClientPortal() {
  const tab = window.open('', '_blank')
  if (tab) tab.opener = null
  const go = (url) => {
    if (tab) tab.location.href = url
    else window.location.assign(url)
  }
  try {
    go(await getClientPortalUrl())
  } catch (err) {
    if (err.status === 403) {
      if (tab) tab.close()
      throw err
    }
    go(CLIENT_PORTAL_URL)
  }
}
