import { describe, it, expect } from 'vitest'
import { parseImportList, parseDate, parseBranch } from './importList'

const employees = [
  { id: '1', full_name: 'Shelley Rowe', email: 'shelley@integratedstaffing.ca' },
  { id: '2', full_name: 'José Martín', email: 'jose@integratedstaffing.ca' },
  { id: '3', full_name: 'Sam Lee', email: 'sam.a@integratedstaffing.ca' },
  { id: '4', full_name: 'Sam Lee', email: 'sam.b@integratedstaffing.ca' },
]

describe('parseDate', () => {
  it('reads the common spreadsheet formats', () => {
    expect(parseDate('2019-03-14')).toBe('2019-03-14')
    expect(parseDate('3/14/2019')).toBe('2019-03-14')
    expect(parseDate('March 14, 2019')).toBe('2019-03-14')
    expect(parseDate('14 Mar 2019')).toBe('2019-03-14')
  })
  it('rejects dates that do not exist', () => {
    expect(parseDate('2019-02-30')).toBeNull()
    expect(parseDate('14/3/2019')).toBeNull()
    expect(parseDate('soon')).toBeNull()
  })
})

describe('parseBranch', () => {
  it("tells St. John's from Saint John", () => {
    expect(parseBranch("St. John's")).toBe('st_johns')
    expect(parseBranch('st johns')).toBe('st_johns')
    expect(parseBranch('Saint John')).toBe('saint_john')
    expect(parseBranch('HALIFAX')).toBe('halifax')
    expect(parseBranch('Toronto')).toBeNull()
  })
})

describe('parseImportList', () => {
  it('reads a pasted Excel table in any column order', () => {
    const text = 'Care days\tName\tStart date\tVacation\tBranch\n3\tShelley Rowe\t2015-06-01\t20\tHalifax\n5\tjose martin\t1/9/2021\t15\tMoncton'
    const { rows, error } = parseImportList(text, employees)
    expect(error).toBeNull()
    expect(rows[0].employee.id).toBe('1')
    expect(rows[0].values).toEqual({ start_date: '2015-06-01', branch: 'halifax', vacation_days: 20, care_days: 3 })
    expect(rows[1].employee.id).toBe('2')
    expect(rows[1].values.start_date).toBe('2021-01-09')
    expect(rows[1].problems).toEqual([])
  })
  it('reads CSV with quoted commas and leaves blank cells alone', () => {
    const text = 'Email,Name,Vacation,Care\nshelley@integratedstaffing.ca,"Rowe, Shelley",,4'
    const { rows } = parseImportList(text, employees)
    expect(rows[0].employee.id).toBe('1')
    expect(rows[0].values.vacation_days).toBeNull()
    expect(rows[0].values.care_days).toBe(4)
  })
  it('flags what it cannot match or read instead of guessing', () => {
    const text = 'Name,Branch,Vacation\nSam Lee,Halifax,10\nNobody,Halifax,10\nShelley Rowe,Toronto,lots'
    const { rows } = parseImportList(text, employees)
    expect(rows[0].problems[0]).toMatch(/More than one person/)
    expect(rows[1].problems).toContain('No matching person')
    expect(rows[2].problems).toEqual(['Unknown branch "Toronto"', '"lots" isn\'t a number of days'])
  })
  it('needs a way to match people and something to import', () => {
    expect(parseImportList('Vacation\n10', employees).error).toMatch(/Name/)
    expect(parseImportList('Name\nShelley Rowe', employees).error).toMatch(/No columns/)
  })
})
