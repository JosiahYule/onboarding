import { describe, it, expect } from 'vitest'
import {
  countsAgainstBalance, balanceBucket, yearSplitOf, summarizeYear, remainingIfApproved,
  findOverlap, employeeCanCancel, relevantYears, formatDays, workFromWhereverHint, othersOff,
  portionsOf, requestPortions,
} from './timeOffMath'
import { fmtRequestDates } from './timeOffShared'

const vac = (o) => ({ id: o.id || 'r', type: 'personal_vacation', status: 'pending', ...o })

describe('countsAgainstBalance', () => {
  it('vacation and care days use an allowance; nothing else does', () => {
    expect(balanceBucket('personal_vacation')).toBe('vacation')
    expect(balanceBucket('vacation')).toBe('vacation')
    expect(balanceBucket('care_day')).toBe('care')
    expect(balanceBucket('sick')).toBe('care')
    for (const t of ['bereavement', 'volunteer', 'professional_development', 'work_from_wherever', 'other']) {
      expect(countsAgainstBalance(t)).toBe(false)
    }
  })
})

describe('yearSplitOf', () => {
  it('uses the stored split', () => {
    expect(yearSplitOf({ year_split: { 2026: 4, 2027: 3 } })).toEqual({ 2026: 4, 2027: 3 })
  })
  it('falls back to the start year for older rows', () => {
    expect(yearSplitOf({ start_date: '2026-06-22', business_days: '5' })).toEqual({ 2026: 5 })
  })
})

describe('summarizeYear', () => {
  const balance = { total_days: 15, carried_over: 2, used_days: 4, care_days: 5, care_used: 1 }
  const requests = [
    vac({ id: 'a', year_split: { 2026: 3 } }),
    vac({ id: 'b', year_split: { 2026: 1, 2027: 2 } }),
    vac({ id: 'c', status: 'approved', year_split: { 2026: 4 } }), // already in used_days
    { id: 'd', type: 'bereavement', status: 'pending', year_split: { 2026: 2 } }, // doesn't count
    { id: 'e', type: 'care_day', status: 'pending', year_split: { 2026: 1 } },
  ]
  it('counts only pending vacation days that fall in the year, with no carry-over', () => {
    const s = summarizeYear(balance, requests, 2026)
    expect(s.pending).toBe(4)
    expect(s.available).toBe(15)
    expect(s.remaining).toBe(15 - 4 - 4)
  })
  it('keeps care days separate', () => {
    const s = summarizeYear(balance, requests, 2026, { bucket: 'care' })
    expect(s.entitlement).toBe(5)
    expect(s.used).toBe(1)
    expect(s.pending).toBe(1)
    expect(s.remaining).toBe(3)
  })
  it('handles a missing balance as zero', () => {
    const s = summarizeYear(null, requests, 2027)
    expect(s.hasBalance).toBe(false)
    expect(s.remaining).toBe(-2)
  })
})

describe('remainingIfApproved', () => {
  it('reports each year a request touches', () => {
    const req = vac({ id: 'x', year_split: { 2026: 2, 2027: 3 } })
    const others = [req, vac({ id: 'y', year_split: { 2027: 1 } })]
    const result = remainingIfApproved(req, { 2026: { total_days: 10, used_days: 9 }, 2027: { total_days: 10, used_days: 0 } }, others)
    expect(result).toEqual([
      { year: 2026, bucket: 'vacation', days: 2, hasBalance: true, remaining: -1 },
      { year: 2027, bucket: 'vacation', days: 3, hasBalance: true, remaining: 6 },
    ])
  })
  it('uses the care allowance for a Care Day', () => {
    const req = { id: 'c', type: 'care_day', status: 'pending', year_split: { 2026: 1 } }
    expect(remainingIfApproved(req, { 2026: { total_days: 10, care_days: 3, care_used: 1 } }, [req]))
      .toEqual([{ year: 2026, bucket: 'care', days: 1, hasBalance: true, remaining: 1 }])
  })
  it('is empty for leave that does not use the balance', () => {
    expect(remainingIfApproved({ type: 'bereavement', year_split: { 2026: 2 } }, {}, [])).toEqual([])
  })
})

describe('workFromWhereverHint', () => {
  it('is quiet for one full Monday-to-Friday week', () => {
    expect(workFromWhereverHint('work_from_wherever', '2026-11-16', '2026-11-20')).toBeNull()
  })
  it('flags part of a week, a week that starts midweek, and half days', () => {
    expect(workFromWhereverHint('work_from_wherever', '2026-11-16', '2026-11-18')).toMatch(/Monday to Friday/)
    expect(workFromWhereverHint('work_from_wherever', '2026-11-18', '2026-11-24')).toMatch(/Monday to Friday/)
    expect(workFromWhereverHint('work_from_wherever', '2026-11-16', '2026-11-27')).toMatch(/Monday to Friday/)
    expect(workFromWhereverHint('work_from_wherever', '2026-11-16', '2026-11-16', 'am')).toMatch(/Monday to Friday/)
  })
  it('only applies to Work from Wherever', () => {
    expect(workFromWhereverHint('personal_vacation', '2026-11-18', '2026-11-18')).toBeNull()
  })
})

describe('findOverlap', () => {
  const reqs = [
    { id: '1', status: 'approved', start_date: '2026-12-21', end_date: '2026-12-24' },
    { id: '2', status: 'cancelled', start_date: '2026-11-10', end_date: '2026-11-10' },
  ]
  it('finds an overlapping live request', () => {
    expect(findOverlap(reqs, '2026-12-24', '2026-12-28')?.id).toBe('1')
  })
  it('lets a morning and an afternoon share a day', () => {
    const half = [{ id: 'm', status: 'pending', start_date: '2026-11-13', end_date: '2026-11-13', day_portion: 'am' }]
    expect(findOverlap(half, '2026-11-13', '2026-11-13', { portion: 'pm' })).toBeNull()
    expect(findOverlap(half, '2026-11-13', '2026-11-13', { portion: 'am' })?.id).toBe('m')
    expect(findOverlap(half, '2026-11-12', '2026-11-13', { portion: 'full' })?.id).toBe('m')
  })
  it('ignores cancelled requests and non-overlaps', () => {
    expect(findOverlap(reqs, '2026-11-10', '2026-11-10')).toBeNull()
    expect(findOverlap(reqs, '2026-12-25', '2026-12-28')).toBeNull()
  })
})

describe('partial first and last days', () => {
  // Jan 2027: Thu 7, Fri 8, Mon 11, Tue 12.
  const thuPmToFri = { id: 'a', status: 'pending', start_date: '2027-01-07', end_date: '2027-01-08', day_portion: 'full', start_portion: 'pm', end_portion: 'full' }

  it('portionsOf reads the new columns, and falls back to day_portion for older rows', () => {
    expect(portionsOf(thuPmToFri)).toEqual({ start: 'pm', end: 'full' })
    expect(portionsOf({ start_date: '2027-01-07', end_date: '2027-01-07', day_portion: 'am' })).toEqual({ start: 'am', end: 'am' })
    expect(portionsOf({ start_date: '2027-01-07', end_date: '2027-01-08' })).toEqual({ start: 'full', end: 'full' })
  })

  it('requestPortions turns form choices into a request', () => {
    expect(requestPortions('2027-01-07', '2027-01-08', 'full', 'pm', 'full'))
      .toEqual({ half: false, end: '2027-01-08', startPortion: 'pm', endPortion: 'full', partialEnds: true })
    // A half day ignores the end date and the first/last-day choices.
    expect(requestPortions('2027-01-07', '2027-01-20', 'am', 'pm', 'am'))
      .toEqual({ half: true, end: '2027-01-07', startPortion: 'am', endPortion: 'am', partialEnds: false })
    // Same first and last day: the first/last-day choices don't apply.
    expect(requestPortions('2027-01-07', '2027-01-07', 'full', 'pm', 'am'))
      .toEqual({ half: false, end: '2027-01-07', startPortion: 'full', endPortion: 'full', partialEnds: false })
    // Only afternoon-first and morning-last make sense; anything else is a whole day.
    expect(requestPortions('2027-01-07', '2027-01-08', 'full', 'am', 'pm').partialEnds).toBe(false)
  })

  it('a request ending in the morning and one starting that afternoon do not clash', () => {
    const endsTueAm = [{ id: 'b', status: 'approved', start_date: '2027-01-11', end_date: '2027-01-12', start_portion: 'full', end_portion: 'am' }]
    expect(findOverlap(endsTueAm, '2027-01-12', '2027-01-15', { startPortion: 'pm' })).toBeNull()
    expect(findOverlap(endsTueAm, '2027-01-12', '2027-01-15')?.id).toBe('b')
    // A single afternoon on that Tuesday fits too; a morning doesn't.
    expect(findOverlap(endsTueAm, '2027-01-12', '2027-01-12', { portion: 'pm' })).toBeNull()
    expect(findOverlap(endsTueAm, '2027-01-12', '2027-01-12', { portion: 'am' })?.id).toBe('b')
  })

  it('a morning before a request that starts in the afternoon fits; the same half clashes', () => {
    expect(findOverlap([thuPmToFri], '2027-01-07', '2027-01-07', { portion: 'am' })).toBeNull()
    expect(findOverlap([thuPmToFri], '2027-01-07', '2027-01-07', { portion: 'pm' })?.id).toBe('a')
    expect(findOverlap([thuPmToFri], '2027-01-05', '2027-01-07', { endPortion: 'am' })).toBeNull()
  })

  it('days in the middle of both requests always clash', () => {
    expect(findOverlap([thuPmToFri], '2027-01-06', '2027-01-11', { startPortion: 'pm', endPortion: 'am' })?.id).toBe('a')
  })

  it('Work from Wherever with a partial first or last day gets the hint', () => {
    expect(workFromWhereverHint('work_from_wherever', '2027-01-11', '2027-01-15', 'full', 'am')).toMatch(/Monday to Friday/)
    expect(workFromWhereverHint('work_from_wherever', '2027-01-11', '2027-01-15', 'pm', 'full')).toMatch(/Monday to Friday/)
    expect(workFromWhereverHint('work_from_wherever', '2027-01-11', '2027-01-15', 'full', 'full')).toBeNull()
  })

  it('date labels name a partial first or last day', () => {
    expect(fmtRequestDates(thuPmToFri)).toBe('Jan 7 (afternoon) – Jan 8')
    expect(fmtRequestDates({ ...thuPmToFri, start_portion: 'full', end_portion: 'am' })).toBe('Jan 7 – Jan 8 (morning)')
    expect(fmtRequestDates({ start_date: '2027-01-07', end_date: '2027-01-07', day_portion: 'am' })).toBe('Jan 7')
  })
})

describe('employeeCanCancel', () => {
  it('allows pending any time and approved only before it starts', () => {
    expect(employeeCanCancel({ status: 'pending', start_date: '2026-01-01' }, '2026-11-06')).toBe(true)
    expect(employeeCanCancel({ status: 'approved', start_date: '2026-11-07' }, '2026-11-06')).toBe(true)
    expect(employeeCanCancel({ status: 'approved', start_date: '2026-11-06' }, '2026-11-06')).toBe(false)
    expect(employeeCanCancel({ status: 'denied', start_date: '2027-01-01' }, '2026-11-06')).toBe(false)
  })
})

describe('relevantYears', () => {
  it('adds next year once something is booked in it', () => {
    expect(relevantYears(2026)).toEqual([2026])
    expect(relevantYears(2026, { requests: [{ year_split: { 2026: 1, 2027: 2 } }] })).toEqual([2026, 2027])
  })
})

describe('formatDays', () => {
  it('drops needless decimals', () => {
    expect(formatDays(5)).toBe('5d')
    expect(formatDays('4.0')).toBe('4d')
    expect(formatDays(2.5)).toBe('2.5d')
  })
})

describe('othersOff', () => {
  const person = (id, name) => ({ employee_id: id, employee: { full_name: name } })
  const req = { id: 'a', ...person('e1', 'Alex Morgan'), start_date: '2027-01-11', end_date: '2027-01-15', status: 'pending' }
  it('lists approved and pending overlaps separately, by first name, once each', () => {
    const others = [
      { id: 'b', ...person('e2', 'Jordan Lee'), start_date: '2027-01-13', end_date: '2027-01-13', status: 'pending' },
      { id: 'c', ...person('e3', 'Casey Nguyen'), start_date: '2027-01-08', end_date: '2027-01-11', status: 'approved' },
      { id: 'd', ...person('e3', 'Casey Nguyen'), start_date: '2027-01-14', end_date: '2027-01-14', status: 'approved' },
    ]
    expect(othersOff(req, [req, ...others])).toEqual({ approved: ['Casey'], pending: ['Jordan'] })
  })
  it('ignores the same person, other dates, and denied or cancelled requests', () => {
    const others = [
      { id: 'b', ...person('e1', 'Alex Morgan'), start_date: '2027-01-12', end_date: '2027-01-12', status: 'approved' },
      { id: 'c', ...person('e2', 'Jordan Lee'), start_date: '2027-01-16', end_date: '2027-01-20', status: 'approved' },
      { id: 'd', ...person('e3', 'Sam Patel'), start_date: '2027-01-12', end_date: '2027-01-12', status: 'denied' },
      { id: 'e', ...person('e4', 'Riley Chen'), start_date: '2027-01-12', end_date: '2027-01-12', status: 'cancelled' },
    ]
    expect(othersOff(req, others)).toEqual({ approved: [], pending: [] })
  })
})
