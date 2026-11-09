import { vi } from 'vitest'
import { FEATURES } from '../config'

const { invoke, rpc } = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn() }))
vi.mock('../supabaseClient', () => ({ supabase: { functions: { invoke }, rpc } }))

import { sendEmail, sendTimeOffEmail, notifyTimeOffHrAndManager } from './emailNotify'

beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockResolvedValue({ data: { success: true }, error: null })
  rpc.mockResolvedValue({ data: { hr_email: 'hr@example.test', manager_email: 'selected@example.test' }, error: null })
})
afterEach(() => { FEATURES.timeOffEmails = false })

test('time-off mail ships paused and makes no recipient lookup or send call', async () => {
  expect(FEATURES.timeOffEmails).toBe(false)
  expect(await notifyTimeOffHrAndManager({ requestId: 'r1', subject: 'Test', html: '<p>Test</p>' }))
    .toEqual({ hr: null, manager: null, paused: true })
  expect(await sendTimeOffEmail({ to: 'employee@example.test', subject: 'Decision', html: '' })).toBeNull()
  expect(rpc).not.toHaveBeenCalled()
  expect(invoke).not.toHaveBeenCalled()
})

test('the pause does not affect onboarding or tech-support mail', async () => {
  expect(await sendEmail({ to: 'help@example.test', subject: 'Tech support', html: 'Help' })).toBe(true)
  expect(invoke).toHaveBeenCalledOnce()
})

test('prepared routing uses the saved request and sends to HR and its selected manager', async () => {
  // All sending is mocked; this flag is restored after the test.
  FEATURES.timeOffEmails = true
  expect(await notifyTimeOffHrAndManager({ requestId: 'r-selected', subject: 'Request', html: 'Details' }))
    .toEqual({ hr: true, manager: true })
  expect(rpc).toHaveBeenCalledWith('get_time_off_request_recipients', { p_request_id: 'r-selected' })
  expect(invoke.mock.calls.map(([, args]) => args.body.to)).toEqual(['hr@example.test', 'selected@example.test'])
})

test('HR and manager sharing an address receive one email', async () => {
  FEATURES.timeOffEmails = true
  rpc.mockResolvedValue({ data: { hr_email: 'hr@example.test', manager_email: 'HR@EXAMPLE.TEST' }, error: null })
  expect(await notifyTimeOffHrAndManager({ requestId: 'r1', subject: '', html: '' }))
    .toEqual({ hr: true, manager: null })
  expect(invoke).toHaveBeenCalledOnce()
})

test.each([
  { data: { hr_email: 'hr@example.test', manager_email: null }, error: null },
  { data: null, error: { message: 'Access denied' } },
])('does not guess or partially send when recipient resolution fails', async result => {
  FEATURES.timeOffEmails = true
  rpc.mockResolvedValue(result)
  expect(await notifyTimeOffHrAndManager({ requestId: 'r1', subject: '', html: '' }))
    .toEqual({ hr: false, manager: false })
  expect(invoke).not.toHaveBeenCalled()
})
