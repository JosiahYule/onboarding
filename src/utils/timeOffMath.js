// The arithmetic behind time off balances, kept in one place so the employee
// portal, the admin page and the emails can't disagree.
//
// The database is the source of truth: approve/deny/cancel adjust
// time_off_balances.used_days themselves. This file only works out what to
// *show*: what's pending, what would be left, and which year a day falls in.

import { TIME_OFF_STATUS } from '../config'

// Must match public.time_off_balance_bucket() in the database. Two types of
// leave come out of a yearly allowance: Personal / Vacation and Care Days.
// Every other type is still requested and approved, it just doesn't spend
// days. ('vacation' and 'sick' are legacy names.)
const BUCKET_OF_TYPE = {
  personal_vacation: 'vacation', vacation: 'vacation',
  care_day: 'care', sick: 'care',
}
export const BUCKETS = {
  vacation: { label: 'Personal / Vacation', short: 'vacation days', allowance: 'total_days', used: 'used_days' },
  care: { label: 'Care days', short: 'care days', allowance: 'care_days', used: 'care_used' },
}

export function balanceBucket(type) {
  return BUCKET_OF_TYPE[type] || null
}

export function countsAgainstBalance(type) {
  return balanceBucket(type) !== null
}

// "Uses vacation days", "Uses care days" or "Doesn't use your balance".
export function balanceUseLabel(type) {
  const b = balanceBucket(type)
  return b ? `Uses ${BUCKETS[b].short}` : "Doesn't use your balance"
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

// One employee's position for one year, for one allowance ('vacation' or
// 'care'). There's no carry-over: unused days don't roll into next year.
//   entitlement  the yearly allowance HR sets
//   used         days already deducted by approvals (or entered by HR)
//   pending      days of this kind waiting for approval in this year
//   remaining    what's left if every pending request is approved
export function summarizeYear(balance, requests, year, { excludeId, bucket = 'vacation' } = {}) {
  const meta = BUCKETS[bucket]
  const entitlement = Number(balance?.[meta.allowance]) || 0
  const used = Number(balance?.[meta.used]) || 0
  const pending = (requests || [])
    .filter(r => r.id !== excludeId && r.status === TIME_OFF_STATUS.PENDING && balanceBucket(r.type) === bucket)
    .reduce((s, r) => s + daysInYear(r, year), 0)
  return {
    year,
    bucket,
    hasBalance: Boolean(balance),
    entitlement,
    available: entitlement,
    used,
    pending,
    remaining: entitlement - used - pending,
  }
}

// What would be left in each year a request touches, if it were approved,
// in the allowance its type comes out of. [] for leave that doesn't use one.
//   balancesByYear: { 2026: balanceRow, 2027: balanceRow }
//   otherRequests:  the same employee's requests (this one is excluded)
export function remainingIfApproved(req, balancesByYear, otherRequests) {
  const bucket = balanceBucket(req.type)
  if (!bucket) return []
  return Object.entries(yearSplitOf(req))
    .filter(([, days]) => Number(days) > 0)
    .map(([year, days]) => {
      const summary = summarizeYear(balancesByYear?.[year], otherRequests, Number(year), { excludeId: req.id, bucket })
      return { year: Number(year), bucket, days: Number(days), hasBalance: summary.hasBalance, remaining: summary.remaining - Number(days) }
    })
}

// Work from Wherever is meant to be taken as one whole Monday-to-Friday week,
// not split into pieces. It's a guideline, not a rule: the request can still
// be sent, so this only returns a hint to show. Dates are YYYY-MM-DD.
export function workFromWhereverHint(type, start, end, portion = 'full') {
  if (type !== 'work_from_wherever' || !start || !end || end < start) return null
  const msg = 'Work from Wherever is usually taken as one full week, Monday to Friday, rather than split into parts. You can still send this; HR will review it.'
  if (portion !== 'full') return msg
  const startDow = dayOfWeek(start)
  const endDow = dayOfWeek(end)
  const span = daysBetween(start, end)
  return startDow === 1 && endDow === 5 && span === 4 ? null : msg
}

function dayOfWeek(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
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
