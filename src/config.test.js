import { pathToPage, pageToPath, planPath, parseInstanceId, ROUTES, brandInfo, brandName } from './config'

test('pageToPath and pathToPage round-trip for known pages', () => {
  const pages = ['dashboard', 'new-onboarding-select', 'templates', 'documents', 'roles', 'history', 'time-off', 'super-admin-users']
  pages.forEach(page => {
    expect(pathToPage(pageToPath(page))).toBe(page)
  })
})

test('unknown path falls back to dashboard', () => {
  expect(pathToPage('/totally-unknown')).toBe('dashboard')
})

test('plan path carries the instance id and parses back', () => {
  const id = 'abc-123'
  expect(planPath(id)).toBe(`${ROUTES.PLAN}/${id}`)
  expect(pathToPage(planPath(id))).toBe('plan')
  expect(parseInstanceId(planPath(id))).toBe(id)
})

test('plan route without an id parses to null', () => {
  expect(planPath(null)).toBe(ROUTES.PLAN)
  expect(pathToPage(ROUTES.PLAN)).toBe('plan')
  expect(parseInstanceId(ROUTES.PLAN)).toBe(null)
})

test('parseInstanceId returns null for non-plan paths', () => {
  expect(parseInstanceId('/dashboard')).toBe(null)
})

test('brand codes map to the agency names people recognise', () => {
  expect(brandName('AS')).toBe('Accountant Staffing')
  expect(brandName('ADS')).toBe('Administrative Staffing')
  expect(brandInfo('ISL').signOff).toBe('Integrated Staffing Limited')
  // Unknown codes fall back to the raw value rather than a wrong agency.
  expect(brandName('XYZ')).toBe('XYZ')
  expect(brandName(null)).toBe('')
})
