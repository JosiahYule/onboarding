import { parseLocalDate, toLocalISODate, formatDate, daysBetween } from './dates'

test('a date-only string parses to local midnight on the same day', () => {
  const d = parseLocalDate('2026-09-21')
  expect(d.getFullYear()).toBe(2026)
  expect(d.getMonth()).toBe(8)
  expect(d.getDate()).toBe(21)
  expect(d.getHours()).toBe(0)
})

test('formatDate shows the stored day, whatever the time zone', () => {
  expect(formatDate('2026-09-21')).toBe('September 21, 2026')
  expect(formatDate('2026-09-21', { month: 'short', day: 'numeric' })).toBe('Sep 21')
})

test('empty and invalid values format to an empty string', () => {
  expect(formatDate(null)).toBe('')
  expect(formatDate('')).toBe('')
  expect(formatDate('not a date')).toBe('')
})

test('toLocalISODate uses the local calendar date', () => {
  // 11:30pm local is still the 23rd locally, even though UTC may be the 24th.
  expect(toLocalISODate(new Date(2026, 8, 23, 23, 30))).toBe('2026-09-23')
})

test('daysBetween counts calendar days and goes negative for the future', () => {
  expect(daysBetween('2026-09-21', '2026-09-21')).toBe(0)
  expect(daysBetween('2026-09-21', '2026-09-28')).toBe(7)
  expect(daysBetween('2026-09-28', '2026-09-21')).toBe(-7)
  // Across the November daylight-saving change.
  expect(daysBetween('2026-10-30', '2026-11-03')).toBe(4)
})
