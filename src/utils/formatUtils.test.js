import { getInitials, displayNameFromEmail, humanize } from './formatUtils'

test('getInitials takes the first two initials', () => {
  expect(getInitials('Jane Mary Smith')).toBe('JM')
  expect(getInitials('')).toBe('?')
})

test('displayNameFromEmail turns the local part into a name', () => {
  expect(displayNameFromEmail('josiah.yule@integratedstaffing.ca')).toBe('Josiah Yule')
  expect(displayNameFromEmail('JANE_DOE@example.com')).toBe('Jane Doe')
  expect(displayNameFromEmail('')).toBe('')
})

test('humanize makes enum values readable', () => {
  expect(humanize('super_admin')).toBe('Super admin')
  expect(humanize('personal_vacation')).toBe('Personal vacation')
})
