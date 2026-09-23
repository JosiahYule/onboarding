import { daysBetween } from './dates'

// Where someone is in their first 90 days, from calendar days since their
// start date. `tone` picks the pill colour: upcoming hires are neutral, and an
// onboarding still open past day 90 is flagged so it doesn't go stale quietly.
export function getPhase(hireDate, today = new Date()) {
  const days = daysBetween(hireDate, today)
  if (days === null) return { label: '—', tone: 'neutral' }
  if (days < 0) return { label: days === -1 ? 'Starts tomorrow' : `Starts in ${-days} days`, tone: 'neutral' }
  if (days === 0) return { label: 'Starts today', tone: 'brand' }
  if (days <= 7) return { label: 'Week 1', tone: 'brand' }
  if (days <= 14) return { label: 'Week 2', tone: 'brand' }
  if (days <= 30) return { label: '30 Day', tone: 'brand' }
  if (days <= 60) return { label: '60 Day', tone: 'brand' }
  if (days <= 90) return { label: '90 Day', tone: 'brand' }
  return { label: 'Past 90 days', tone: 'warning' }
}
