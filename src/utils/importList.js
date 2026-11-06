// Reads HR's yearly list (start dates, branches, vacation and Care day
// allowances) pasted from a spreadsheet or exported as CSV, and matches each
// line to an employee. Nothing here touches the database: it produces a
// preview, and only the lines with no problems are sent to
// import_time_off_list().
//
// How it reads the list:
//   - The first line is the header. Columns are recognised by name, so their
//     order doesn't matter: "Email", "Name", "Start date", "Branch",
//     "Vacation" (or "Personal"), "Care".
//   - Pasting from Excel gives tab-separated text; a .csv file is
//     comma-separated. Both work, including quoted values with commas inside.
//   - A blank cell means "leave this as it is".

import { BRANCHES } from '../config'

const COLUMN_PATTERNS = [
  ['email', /e-?mail/],
  ['start', /start|hire|anniversary/],
  ['branch', /branch|office|location|city/],
  ['vacation', /vacation|personal|pto/],
  ['care', /care/],
  ['name', /name|employee/],
]

// Splits one line into cells. Handles "quoted, values" and "" as an escaped quote.
function splitLine(line, sep) {
  const cells = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"' && cur === '') quoted = true
    else if (ch === sep) { cells.push(cur.trim()); cur = '' }
    else cur += ch
  }
  cells.push(cur.trim())
  return cells
}

function normalise(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9@.]+/g, ' ').trim()
}

// "Halifax", "St. John's", "Saint John" ... -> branch code, or null.
export function parseBranch(raw) {
  const s = normalise(raw).replace(/\./g, '')
  if (!s) return null
  if (/johns|john s\b/.test(s)) return 'st_johns'
  if (/saint john/.test(s)) return 'saint_john'
  const hit = BRANCHES.find(b => normalise(b.name).replace(/\./g, '') === s || b.code === s.replace(/ /g, '_'))
  return hit ? hit.code : null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function iso(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// 2019-03-14, 3/14/2019 (month first, as Excel shows it in Canada and the US),
// or "March 14, 2019" / "14 Mar 2019" -> "2019-03-14", or null.
export function parseDate(raw) {
  const s = (raw || '').trim()
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return iso(+m[3], +m[1], +m[2])
  m = s.toLowerCase().match(/^([a-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})$/)
  if (m && MONTHS.includes(m[1])) return iso(+m[3], MONTHS.indexOf(m[1]) + 1, +m[2])
  m = s.toLowerCase().match(/^(\d{1,2}) ([a-z]{3})[a-z]*\.?,? (\d{4})$/)
  if (m && MONTHS.includes(m[2])) return iso(+m[3], MONTHS.indexOf(m[2]) + 1, +m[1])
  return null
}

function parseDays(raw) {
  const s = (raw || '').trim().replace(/\s*(days?|d)$/i, '')
  if (!s) return { value: null }
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return { error: `"${raw}" isn't a number of days` }
  return { value: n }
}

// Returns { columns, rows, error }. Each row:
//   { line, label, employee, values: { start_date, branch, vacation_days, care_days }, problems: [] }
export function parseImportList(text, employees) {
  const lines = (text || '').split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { columns: {}, rows: [], error: 'Paste a header line and at least one person.' }

  const sep = lines[0].includes('\t') ? '\t' : ','
  const header = splitLine(lines[0], sep).map(h => normalise(h))
  const columns = {}
  header.forEach((h, i) => {
    const hit = COLUMN_PATTERNS.find(([key, re]) => columns[key] === undefined && re.test(h))
    if (hit) columns[hit[0]] = i
  })
  if (columns.email === undefined && columns.name === undefined) {
    return { columns, rows: [], error: 'The first line needs a "Name" or "Email" column so each line can be matched to a person.' }
  }
  if (['start', 'branch', 'vacation', 'care'].every(k => columns[k] === undefined)) {
    return { columns, rows: [], error: 'No columns to import. Expected some of: Start date, Branch, Vacation, Care.' }
  }

  const byEmail = new Map(employees.filter(e => e.email).map(e => [e.email.toLowerCase(), e]))
  const byName = new Map()
  employees.forEach(e => {
    const k = normalise(e.full_name)
    byName.set(k, byName.has(k) ? 'duplicate' : e)
  })

  const rows = lines.slice(1).map((line, i) => {
    const cells = splitLine(line, sep)
    const cell = key => (columns[key] === undefined ? '' : cells[columns[key]] || '')
    const problems = []

    const email = cell('email').toLowerCase()
    const name = cell('name')
    let employee = email ? byEmail.get(email) : null
    if (!employee && name) {
      const hit = byName.get(normalise(name))
      if (hit === 'duplicate') problems.push(`More than one person is called ${name}; add their email`)
      else employee = hit || null
    }
    if (!employee && problems.length === 0) problems.push('No matching person')

    const values = { start_date: null, branch: null, vacation_days: null, care_days: null }
    if (cell('start')) {
      values.start_date = parseDate(cell('start'))
      if (!values.start_date) problems.push(`Can't read the date "${cell('start')}"`)
    }
    if (cell('branch')) {
      values.branch = parseBranch(cell('branch'))
      if (!values.branch) problems.push(`Unknown branch "${cell('branch')}"`)
    }
    for (const [key, field] of [['vacation', 'vacation_days'], ['care', 'care_days']]) {
      const parsed = parseDays(cell(key))
      if (parsed.error) problems.push(parsed.error)
      else values[field] = parsed.value
    }
    if (Object.values(values).every(v => v === null) && problems.length === 0) problems.push('Nothing to import on this line')

    return { line: i + 2, label: name || email || `Line ${i + 2}`, employee, values, problems }
  })

  return { columns, rows, error: null }
}
