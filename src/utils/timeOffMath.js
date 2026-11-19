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
// `portion` is the first day's part ('full', 'am' or 'pm'); `endPortion` the
// last day's, which defaults to the same.
export function workFromWhereverHint(type, start, end, portion = 'full', endPortion = portion) {
  if (type !== 'work_from_wherever' || !start || !end || end < start) return null
  const msg = 'Work from Wherever is usually taken as one full week, Monday to Friday, rather than split into parts. You can still send this; HR will review it.'
  if (portion !== 'full' || endPortion !== 'full') return msg
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

// Other people off during a request's dates, for HR deciding on it. Approved
// and still-pending requests are listed apart, so HR can spot two pending
// requests that clash before approving both. Names are first names, each
// listed once.
export function othersOff(req, requests) {
  const firstNames = list => [...new Set(list.map(r => r.employee?.full_name?.split(' ')[0] || '?'))]
  const overlapping = (requests || []).filter(r =>
    r.id !== req.id && r.employee_id !== req.employee_id &&
    r.start_date <= req.end_date && r.end_date >= req.start_date)
  return {
    approved: firstNames(overlapping.filter(r => r.status === TIME_OFF_STATUS.APPROVED)),
    pending: firstNames(overlapping.filter(r => r.status === TIME_OFF_STATUS.PENDING)),
  }
}

// Which part of its first and last day a request takes: { start, end }, each
// 'full', 'am' or 'pm'. A longer request can start in the afternoon
// (start 'pm') and end after the morning (end 'am'); a single day has the same
// value at both ends. Rows saved before start_portion/end_portion existed
// fall back to day_portion, which only ever described a single day.
export function portionsOf(req) {
  const single = req?.day_portion && req.day_portion !== 'full' ? req.day_portion : 'full'
  const pick = v => (v === 'am' || v === 'pm' ? v : null)
  return {
    start: pick(req?.start_portion) || single,
    end: pick(req?.end_portion) || single,
  }
}

// What a time-off form's choices add up to. `dayPortion` is the Duration
// choice: 'full' for one or more whole days, 'am' or 'pm' for part of a single
// day. `startPortion` ('full' or 'pm') and `endPortion` ('full' or 'am') only
// apply when the request runs over several days. Returns
//   { half, end, startPortion, endPortion, partialEnds }
// where `end` is the real last day (the start date for a half day) and
// `partialEnds` is true for a longer request with a partial first or last day.
export function requestPortions(start, end, dayPortion = 'full', startPortion = 'full', endPortion = 'full') {
  const half = dayPortion !== 'full'
  const last = half ? start : end
  const multi = !half && Boolean(start) && Boolean(last) && last > start
  const sp = half ? dayPortion : multi && startPortion === 'pm' ? 'pm' : 'full'
  const ep = half ? dayPortion : multi && endPortion === 'am' ? 'am' : 'full'
  return { half, end: last, startPortion: sp, endPortion: ep, partialEnds: multi && (sp !== 'full' || ep !== 'full') }
}

// The halves of `day` a request covers: ['am', 'pm'], ['am'] or ['pm'].
function halvesOn(start, end, portions, day) {
  const both = ['am', 'pm']
  if (start === end) return portions.start === 'full' ? both : [portions.start]
  if (day === start && portions.start !== 'full') return [portions.start]
  if (day === end && portions.end !== 'full') return [portions.end]
  return both
}

function nextDay(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

// An employee's own pending or approved request that overlaps these dates.
// Two requests only clash when they both take the same half of some day, so
// a morning and an afternoon on the same day don't clash (a half-day Care Day
// and a half-day of vacation together), and neither does a request ending on
// Tuesday morning and another starting Tuesday afternoon.
//   portion:      the new request's single-day portion ('full', 'am', 'pm')
//   startPortion: its first day's part, for a longer request (default: portion)
//   endPortion:   its last day's part (default: portion)
export function findOverlap(requests, start, end, { excludeId, portion = 'full', startPortion = portion, endPortion = portion } = {}) {
  if (!start || !end) return null
  const mine = { start: startPortion, end: endPortion }
  return (requests || []).find(r => {
    if (r.id === excludeId) return false
    if (r.status !== TIME_OFF_STATUS.PENDING && r.status !== TIME_OFF_STATUS.APPROVED) return false
    const from = r.start_date > start ? r.start_date : start
    const to = r.end_date < end ? r.end_date : end
    if (from > to) return false
    const theirs = portionsOf(r)
    // Only the shared days at the edges can be partial; walk at most those.
    for (let day = from, n = 0; day <= to && n < 3; day = nextDay(day), n++) {
      const a = halvesOn(start, end, mine, day)
      const b = halvesOn(r.start_date, r.end_date, theirs, day)
      if (a.some(h => b.includes(h))) return true
    }
    return false
  }) || null
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
