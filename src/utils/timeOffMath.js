// The arithmetic behind time off balances, kept in one place so the employee
// portal, the admin page and the emails can't disagree.
//
// The database is the source of truth: approve/deny/cancel adjust
// time_off_balances.used_days themselves. This file only works out what to
// *show*: what's pending, what would be left, and which year a day falls in.

import { TIME_OFF_STATUS } from '../config'

// Must match public.time_off_counts_against_balance() in the database. Only
// vacation uses up the yearly balance; every other type is still requested
// and approved, it just doesn't spend days. ('vacation' is the legacy name.)
export const BALANCE_TYPES = new Set(['personal_vacation', 'vacation'])

export function countsAgainstBalance(type) {
  return BALANCE_TYPES.has(type)
}

// Business days per calendar year. The database stores this as year_split
// ({"2026": 4, "2027": 3}) so a request over New Year comes off both years.
// Older rows without it count entirely in the start year.
export function yearSplitOf(req) {
  if (req?.year_split && typeof req.year_split === 'object') return req.year_split
  if (!req?.start_date) return {}
  return { [req.start_date.slice(0, 4)]: Number(req.business_days) || 0 }
}

export function daysInYear(req, year) {
  return Number(yearSplitOf(req)[String(year)]) || 0
}

export function splitTotal(split) {
  return Object.values(split || {}).reduce((s, v) => s + (Number(v) || 0), 0)
}

// One employee's position for one year.
//   entitlement  the yearly allowance HR sets (total_days)
//   carried      days brought forward from last year
//   used         days already deducted by approvals (or entered by HR)
//   pending      vacation days waiting for approval in this year
//   remaining    what's left if every pending request is approved
export function summarizeYear(balance, requests, year, { excludeId } = {}) {
  const entitlement = Number(balance?.total_days) || 0
  const carried = Number(balance?.carried_over) || 0
  const used = Number(balance?.used_days) || 0
  const pending = (requests || [])
    .filter(r => r.id !== excludeId && r.status === TIME_OFF_STATUS.PENDING && countsAgainstBalance(r.type))
    .reduce((s, r) => s + daysInYear(r, year), 0)
  return {
    year,
    hasBalance: Boolean(balance),
    entitlement,
    carried,
    available: entitlement + carried,
    used,
    pending,
    remaining: entitlement + carried - used - pending,
  }
}

// What would be left in each year a request touches, if it were approved.
// Returns [] for leave that doesn't use the balance.
//   balancesByYear: { 2026: balanceRow, 2027: balanceRow }
//   otherRequests:  the same employee's requests (this one is excluded)
export function remainingIfApproved(req, balancesByYear, otherRequests) {
  if (!countsAgainstBalance(req.type)) return []
  return Object.entries(yearSplitOf(req))
    .filter(([, days]) => Number(days) > 0)
    .map(([year, days]) => {
      const summary = summarizeYear(balancesByYear?.[year], otherRequests, Number(year), { excludeId: req.id })
      return { year: Number(year), days: Number(days), hasBalance: summary.hasBalance, remaining: summary.remaining - Number(days) }
    })
}

// An employee's own pending or approved request that overlaps these dates.
// A morning and an afternoon on the same day don't clash, so someone can take
// a half-day Care Day and a half-day of vacation together. `portion` is the
// new request's day_portion: 'full', 'am' or 'pm'.
export function findOverlap(requests, start, end, { excludeId, portion = 'full' } = {}) {
  if (!start || !end) return null
  return (requests || []).find(r =>
    r.id !== excludeId &&
    (r.status === TIME_OFF_STATUS.PENDING || r.status === TIME_OFF_STATUS.APPROVED) &&
    r.start_date <= end && r.end_date >= start &&
    !halvesOfTheSameDay(r.day_portion, portion)
  ) || null
}

function halvesOfTheSameDay(a, b) {
  return (a === 'am' && b === 'pm') || (a === 'pm' && b === 'am')
}

// Employees may cancel a pending request any time, and approved leave only
// before it starts (the database enforces the same rule; after that, HR does
// it). `today` is a YYYY-MM-DD string.
export function employeeCanCancel(req, today) {
  if (req.status === TIME_OFF_STATUS.PENDING) return true
  if (req.status === TIME_OFF_STATUS.APPROVED) return req.start_date > today
  return false
}

// Years worth offering in a year picker: this year, next year once anyone
// has booked into it, and any year that has a balance or a request.
export function relevantYears(currentYear, { balances = [], requests = [] } = {}) {
  const years = new Set([currentYear])
  balances.forEach(b => b?.year && years.add(Number(b.year)))
  requests.forEach(r => Object.keys(yearSplitOf(r)).forEach(y => years.add(Number(y))))
  return [...years].filter(y => y >= currentYear - 1 && y <= currentYear + 1).sort((a, b) => a - b)
}

export function formatDays(n) {
  const v = Number(n) || 0
  return `${Number.isInteger(v) ? v : v.toFixed(1).replace(/\.0$/, '')}d`
}
