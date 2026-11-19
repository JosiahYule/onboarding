import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react'
import { vi } from 'vitest'

const { fixture, inserts, invoke, rpc, audit } = vi.hoisted(() => ({
  fixture: { managers: [], managerError: null, requests: [] },
  inserts: [], invoke: vi.fn(), rpc: vi.fn(), audit: vi.fn(),
}))

vi.mock('../supabaseClient', () => ({
  supabase: {
    from(table) {
      let payload
      const builder = {
        select() { return builder }, eq() { return builder }, order() { return builder },
        single() { return builder }, maybeSingle() { return builder }, is() { return builder },
        or() { return builder }, in() { return builder },
        insert(value) { payload = value; return builder },
        then(resolve, reject) {
          let result = { data: [], error: null }
          if (table === 'employees') result.data = { id: 'employee1', full_name: 'Test Employee', brand: 'ISL', manager_id: 'saved-manager', takes_time_off: true }
          if (table === 'onboarding_instances') result = { data: null, error: { code: 'PGRST116' } }
          if (table === 'time_off_balances') result.data = [{ year: 2027, total_days: 15, used_days: 0, carried_over: 0, care_days: 10, care_used: 0 }]
          if (table === 'time_off_requests') {
            result.data = fixture.requests
            if (payload) {
              inserts.push(payload)
              const manager = fixture.managers.find(m => m.manager_id === payload.direct_manager_id)
              const saved = { id: `req${inserts.length}`, ...payload, direct_manager_name: manager?.full_name, year_split: { 2027: 1 } }
              fixture.requests = [saved, ...fixture.requests]
              result.data = saved
            }
          }
          return Promise.resolve(result).then(resolve, reject)
        },
      }
      return builder
    },
    rpc, functions: { invoke }, auth: { signOut: vi.fn() },
  },
}))
vi.mock('../utils/auditLog', () => ({ logAudit: audit }))
vi.mock('../ui/ThemeToggle', () => ({ default: () => null }))
vi.mock('../ui/AnimatedNumber', () => ({ default: ({ value }) => value }))

import EmployeePortal from './EmployeePortal'

beforeEach(() => {
  vi.clearAllMocks()
  inserts.length = 0
  fixture.managerError = null
  fixture.requests = []
  fixture.managers = [
    { manager_id: 'saved-manager', full_name: 'Saved Manager', is_default: true },
    { manager_id: 'chosen-manager', full_name: 'Chosen Manager', is_default: false },
  ]
  rpc.mockImplementation(name => Promise.resolve(name === 'get_time_off_managers'
    ? { data: fixture.managers, error: fixture.managerError }
    : { data: { 2027: 1 }, error: null }))
})
afterEach(cleanup)

async function openTimeOff() {
  render(<EmployeePortal session={{ user: { id: 'user1', email: 'test@example.test' } }} userProfile={{ employee_id: 'employee1', role: 'employee' }} />)
  fireEvent.click(await screen.findByRole('tab', { name: 'Time off' }))
  const select = await screen.findByLabelText(/Direct manager/)
  await waitFor(() => expect(select).not.toHaveTextContent('Loading managers'))
  return select
}

async function fillDatesAndFlexibility() {
  fireEvent.change(screen.getByLabelText('First day off'), { target: { value: '2027-01-04' } })
  fireEvent.change(screen.getByLabelText('Last day off'), { target: { value: '2027-01-04' } })
  fireEvent.click(screen.getByRole('radio', { name: 'Firm' }))
  await waitFor(() => expect(screen.queryByText('Counting business days…')).not.toBeInTheDocument())
}

test('defaults to the saved manager, saves a changed choice on the request, and sends no email', async () => {
  const select = await openTimeOff()
  expect(select).toHaveValue('saved-manager')
  expect(screen.getByLabelText('First day off')).toHaveAttribute('min', '2027-01-01')
  expect(screen.queryByText('2026')).not.toBeInTheDocument()
  fireEvent.change(select, { target: { value: 'chosen-manager' } })
  await fillDatesAndFlexibility()
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }))
  await screen.findByText('Request submitted.')
  expect(inserts).toHaveLength(1)
  expect(inserts[0]).toMatchObject({ employee_id: 'employee1', direct_manager_id: 'chosen-manager', start_date: '2027-01-04' })
  expect(screen.getByText('Direct manager: Chosen Manager')).toBeInTheDocument()
  expect(invoke).not.toHaveBeenCalled()
  expect(rpc).not.toHaveBeenCalledWith('get_time_off_request_recipients', expect.anything())
})

test('a missing default requires an explicit manager selection', async () => {
  fixture.managers.forEach(m => { m.is_default = false })
  const select = await openTimeOff()
  expect(select).toHaveValue('')
  await fillDatesAndFlexibility()
  expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled()
  expect(screen.getByText('Select your direct manager to continue.')).toBeInTheDocument()
  expect(inserts).toHaveLength(0)
})

test('manager lookup failures can be retried without losing entered dates', async () => {
  fixture.managerError = { message: 'Network error' }
  await openTimeOff()
  fireEvent.change(screen.getByLabelText('First day off'), { target: { value: '2027-01-04' } })
  expect(screen.getByLabelText(/Direct manager/)).toBeDisabled()
  fixture.managerError = null
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(screen.getByLabelText(/Direct manager/)).toBeEnabled())
  expect(screen.getByLabelText('First day off')).toHaveValue('2027-01-04')
})

test('leave before January 2027 cannot be submitted even when the date input is bypassed', async () => {
  await openTimeOff()
  await fillDatesAndFlexibility()
  await act(async () => { fireEvent.change(screen.getByLabelText('First day off'), { target: { value: '2026-12-31' } }) })
  expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled()
  expect(screen.getByText('Choose time off on or after January 1, 2027.')).toBeInTheDocument()
  expect(inserts).toHaveLength(0)
})

test('a longer request can start in the afternoon: one request, counted by the database', async () => {
  rpc.mockImplementation((name, args) => Promise.resolve(name === 'get_time_off_managers'
    ? { data: fixture.managers, error: null }
    : { data: { 2027: args?.p_start_portion === 'pm' ? 1.5 : 2 }, error: null }))
  await openTimeOff()
  // Same first and last day: no first/last-day choice yet.
  await fillDatesAndFlexibility()
  expect(screen.queryByRole('radiogroup', { name: 'Part of first day off' })).not.toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('First day off'), { target: { value: '2027-01-07' } })
  fireEvent.change(screen.getByLabelText('Last day off'), { target: { value: '2027-01-08' } })
  await screen.findByText('2', { selector: 'strong' })
  // A whole-day stretch doesn't send the new arguments at all.
  expect(rpc).toHaveBeenLastCalledWith('time_off_year_split', { p_start: '2027-01-07', p_end: '2027-01-08', p_half_day: false })

  const firstDay = screen.getByRole('radiogroup', { name: 'Part of first day off' })
  fireEvent.click(within(firstDay).getByRole('radio', { name: 'Afternoon only' }))
  await screen.findByText('1.5', { selector: 'strong' })
  expect(rpc).toHaveBeenLastCalledWith('time_off_year_split', {
    p_start: '2027-01-07', p_end: '2027-01-08', p_half_day: false, p_start_portion: 'pm', p_end_portion: 'full',
  })

  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }))
  await screen.findByText('Request submitted.')
  expect(inserts).toHaveLength(1)
  expect(inserts[0]).toMatchObject({
    start_date: '2027-01-07', end_date: '2027-01-08', day_portion: 'full', is_half_day: false,
    start_portion: 'pm', end_portion: 'full',
  })
})

test('a whole-day request sends no portion columns, so it works before and after the migration', async () => {
  await openTimeOff()
  fireEvent.change(screen.getByLabelText('First day off'), { target: { value: '2027-01-07' } })
  fireEvent.change(screen.getByLabelText('Last day off'), { target: { value: '2027-01-08' } })
  fireEvent.click(screen.getByRole('radio', { name: 'Firm' }))
  await waitFor(() => expect(screen.queryByText('Counting business days…')).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }))
  await screen.findByText('Request submitted.')
  expect(inserts[0]).not.toHaveProperty('start_portion')
  expect(inserts[0]).not.toHaveProperty('end_portion')
})
