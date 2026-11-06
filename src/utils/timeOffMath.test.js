import { describe, it, expect } from 'vitest'
import {
  countsAgainstBalance, yearSplitOf, summarizeYear, remainingIfApproved,
  findOverlap, employeeCanCancel, relevantYears, formatDays,
} from './timeOffMath'

const vac = (o) => ({ id: o.id || 'r', type: 'personal_vacation', status: 'pending', ...o })

describe('countsAgainstBalance', () => {
  it('only vacation uses the balance', () => {
    expect(countsAgainstBalance('personal_vacation')).toBe(true)
    expect(countsAgainstBalance('vacation')).toBe(true)
    for (const t of ['bereavement', 'care_day', 'volunteer', 'professional_development', 'work_from_wherever', 'other', 'sick']) {
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
  const balance = { total_days: 15, carried_over: 2, used_days: 4 }
  const requests = [
    vac({ id: 'a', year_split: { 2026: 3 } }),
    vac({ id: 'b', year_split: { 2026: 1, 2027: 2 } }),
    vac({ id: 'c', status: 'approved', year_split: { 2026: 4 } }), // already in used_days
    { id: 'd', type: 'bereavement', status: 'pending', year_split: { 2026: 2 } }, // doesn't count
  ]
  it('counts only pending vacation days that fall in the year', () => {
    const s = summarizeYear(balance, requests, 2026)
    expect(s.pending).toBe(4)
    expect(s.available).toBe(17)
    expect(s.remaining).toBe(17 - 4 - 4)
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
      { year: 2026, days: 2, hasBalance: true, remaining: -1 },
      { year: 2027, days: 3, hasBalance: true, remaining: 6 },
    ])
  })
  it('is empty for leave that does not use the balance', () => {
    expect(remainingIfApproved({ type: 'bereavement', year_split: { 2026: 2 } }, {}, [])).toEqual([])
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
