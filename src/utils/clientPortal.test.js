import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isSalesRep, getClientPortalUrl, openClientPortal, CLIENT_PORTAL_URL } from './clientPortal'

vi.mock('../supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'il-token' } } }))
    }
  }
}))

describe('isSalesRep', () => {
  it('is false for a profile without the flag', () => {
    expect(isSalesRep({ role: 'employee' })).toBe(false)
  })

  it('is false for a missing profile', () => {
    expect(isSalesRep(null)).toBe(false)
    expect(isSalesRep(undefined)).toBe(false)
  })

  // The whole point of a capability flag: it is independent of role, so an
  // employee-rep keeps their employee portal and an admin-rep keeps admin.
  it('is true for any role once the flag is set', () => {
    expect(isSalesRep({ role: 'employee', is_sales_rep: true })).toBe(true)
    expect(isSalesRep({ role: 'admin', is_sales_rep: true })).toBe(true)
    expect(isSalesRep({ role: 'super_admin', is_sales_rep: true })).toBe(true)
  })
})

describe('getClientPortalUrl', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.unstubAllEnvs?.()
  })

  it('falls back to the portal sign-in page when no handoff endpoint is set', async () => {
    // REACT_APP_CLIENT_PORTAL_STAFF_API is unset in the test environment.
    await expect(getClientPortalUrl()).resolves.toBe(CLIENT_PORTAL_URL)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('openClientPortal', () => {
  const originalOpen = window.open

  afterEach(() => {
    window.open = originalOpen
  })

  it('navigates the tab it opened, rather than the app tab', async () => {
    const tab = { opener: 'app', location: { href: '' }, close: vi.fn() }
    window.open = vi.fn(() => tab)
    await openClientPortal()
    // No 'noopener' feature: that makes window.open return null.
    expect(window.open).toHaveBeenCalledWith('', '_blank')
    expect(tab.opener).toBeNull()
    expect(tab.location.href).toBe(CLIENT_PORTAL_URL)
    expect(tab.close).not.toHaveBeenCalled()
  })
})
