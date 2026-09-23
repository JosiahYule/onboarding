// Postgres `date` columns (hire_date, start_date, ...) arrive as bare
// "YYYY-MM-DD" strings with no time zone. `new Date('2026-09-21')` reads that
// as midnight UTC, which in Atlantic time is the evening of the 20th, so the
// date displays a day early. These helpers read date-only strings as local
// midnight instead. Full timestamps (created_at, uploaded_at) still go through
// the normal Date parser, since they carry their own offset.
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

function pad(n) {
  return String(n).padStart(2, '0')
}

export function parseLocalDate(value) {
  if (!value) return null
  if (value instanceof Date) return new Date(value.getTime())
  const m = DATE_ONLY.exec(String(value))
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

// Today's date in the viewer's own time zone, as "YYYY-MM-DD".
export function toLocalISODate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const LONG = { month: 'long', day: 'numeric', year: 'numeric' }

export function formatDate(value, options = LONG) {
  const d = parseLocalDate(value)
  return d ? d.toLocaleDateString('en-CA', options) : ''
}

// Whole calendar days from `from` to `to` (negative when `to` is earlier).
// Uses calendar dates, not elapsed milliseconds, so a daylight-saving change
// in between can't round the answer the wrong way.
export function daysBetween(from, to = new Date()) {
  const a = parseLocalDate(from)
  const b = parseLocalDate(to)
  if (!a || !b) return null
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((utcB - utcA) / 86400000)
}
