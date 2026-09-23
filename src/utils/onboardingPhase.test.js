import { getPhase } from './onboardingPhase'

const today = new Date(2026, 8, 23) // Sep 23, 2026

test('future start dates count down instead of claiming Week 1', () => {
  expect(getPhase('2026-09-24', today).label).toBe('Starts tomorrow')
  expect(getPhase('2026-09-28', today)).toEqual({ label: 'Starts in 5 days', tone: 'neutral' })
})

test('first day and the standard phases', () => {
  expect(getPhase('2026-09-23', today).label).toBe('Starts today')
  expect(getPhase('2026-09-16', today).label).toBe('Week 1')
  expect(getPhase('2026-09-09', today).label).toBe('Week 2')
  expect(getPhase('2026-08-25', today).label).toBe('30 Day')
  expect(getPhase('2026-07-26', today).label).toBe('60 Day')
  expect(getPhase('2026-06-25', today).label).toBe('90 Day')
})

test('onboardings still open after 90 days are flagged', () => {
  expect(getPhase('2026-06-01', today)).toEqual({ label: 'Past 90 days', tone: 'warning' })
})

test('a missing start date does not crash', () => {
  expect(getPhase(null, today).label).toBe('—')
})
