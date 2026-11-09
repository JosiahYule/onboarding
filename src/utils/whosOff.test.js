import { describe, it, expect } from 'vitest'
import { weeksOfMonth, mondayOf, peopleOffInWeek, describeDays, weekEmail } from './whosOff'

const emp = (name, branch = 'halifax') => ({ full_name: name, email: `${name.split(' ')[0].toLowerCase()}@x.ca`, branch })
const req = (o) => ({ id: o.id || Math.random(), status: 'approved', type: 'personal_vacation', day_portion: 'full', ...o })

describe('weeksOfMonth', () => {
  it('lists the Monday-to-Friday weeks touching November 2026', () => {
    // Nov 1 2026 is a Sunday, so the first week starts Mon Nov 2.
    expect(weeksOfMonth(2026, 10).map(w => w.monday)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'])
  })
  it('includes a leading week that starts in the previous month', () => {
    // Jan 1 2027 is a Friday, so the week of Mon Dec 28 is included.
    expect(weeksOfMonth(2027, 0)[0]).toEqual({ monday: '2026-12-28', friday: '2027-01-01' })
  })
})

describe('mondayOf', () => {
  it('maps any day, weekend included, to that week\'s Monday', () => {
    expect(mondayOf('2026-11-11')).toBe('2026-11-09')
    expect(mondayOf('2026-11-15')).toBe('2026-11-09') // Sunday
    expect(mondayOf('2026-11-16')).toBe('2026-11-16')
  })
})

describe('peopleOffInWeek', () => {
  const mon = '2026-11-16', fri = '2026-11-20'
  it('clips requests to the week and sorts by name', () => {
    const rows = peopleOffInWeek([
      req({ employee: emp('Zoe Park'), start_date: '2026-11-12', end_date: '2026-11-17' }),
      req({ employee: emp('Amy Chen'), start_date: '2026-11-16', end_date: '2026-11-20' }),
    ], mon, fri)
    expect(rows.map(r => [r.name, r.from, r.to, r.wholeWeek])).toEqual([
      ['Amy Chen', mon, fri, true],
      ['Zoe Park', mon, '2026-11-17', false],
    ])
  })
  it('leaves out pending, denied and weekend-only time off by default', () => {
    const rows = peopleOffInWeek([
      req({ employee: emp('A'), status: 'pending', start_date: mon, end_date: mon }),
      req({ employee: emp('B'), status: 'denied', start_date: mon, end_date: mon }),
      req({ employee: emp('C'), start_date: '2026-11-21', end_date: '2026-11-22' }),
    ], mon, fri)
    expect(rows).toEqual([])
    expect(peopleOffInWeek([req({ employee: emp('A'), status: 'pending', start_date: mon, end_date: mon })], mon, fri, { includePending: true })).toHaveLength(1)
  })
})

describe('describeDays', () => {
  it('reads naturally', () => {
    expect(describeDays({ wholeWeek: true })).toBe('All week')
    expect(describeDays({ from: '2026-11-20', to: '2026-11-20', portion: 'pm' })).toBe('Fri, Nov 20 (afternoon)')
    expect(describeDays({ from: '2026-11-16', to: '2026-11-18' })).toBe('Mon, Nov 16 to Wed, Nov 18')
    expect(describeDays({ wholeWeek: true, remote: true })).toBe('All week, working remotely')
  })
})

describe('weekEmail', () => {
  it('builds a pasteable list without leave types', () => {
    const rows = peopleOffInWeek([
      req({ employee: emp('Amy Chen'), type: 'bereavement', start_date: '2026-11-16', end_date: '2026-11-17' }),
    ], '2026-11-16', '2026-11-20')
    const { text, html } = weekEmail('2026-11-16', rows, { holidays: [{ date: '2026-11-11', name: 'Remembrance Day' }] })
    expect(text).toBe("Who's off: week of Monday, November 16\n\n- Amy Chen: Mon, Nov 16 to Tue, Nov 17\n\nHoliday: Remembrance Day, Wed, Nov 11")
    expect(text).not.toMatch(/bereavement/i)
    expect(html).toContain('<li><strong>Amy Chen</strong>: Mon, Nov 16 to Tue, Nov 17</li>')
  })
  it('says so when nobody is off, and escapes names in HTML', () => {
    expect(weekEmail('2026-11-16', []).text).toContain('Nobody is booked off this week.')
    const rows = [{ name: '<b>X</b>', wholeWeek: true }]
    expect(weekEmail('2026-11-16', rows).html).toContain('&lt;b&gt;X&lt;/b&gt;')
  })
})
