// "Who's off this week": the list HR sends managers each week, worked out from
// approved time off and laid out so it pastes cleanly into an email.
//
// Weeks run Monday to Friday. A request is clipped to the week it's shown in,
// so someone off Thursday to the following Tuesday appears in both weeks with
// only that week's days. Leave types stay private (managers don't need to know
// it's a Care Day or bereavement); the one exception is Work from Wherever,
// shown as "working remotely" because that person is still working.

import { TIME_OFF_STATUS, branchName } from '../config'
import { formatDate, parseLocalDate, toLocalISODate } from './dates'
import { escapeHtml } from './escapeHtml'

function iso(d) { return toLocalISODate(d) }

function addDays(isoDate, n) {
  const d = parseLocalDate(isoDate)
  d.setDate(d.getDate() + n)
  return iso(d)
}

function isWeekday(isoDate) {
  const day = parseLocalDate(isoDate).getDay()
  return day !== 0 && day !== 6
}

// Every Monday-to-Friday week with at least one weekday in the given month.
// month is 0-based, like Date.
export function weeksOfMonth(year, month) {
  const first = new Date(year, month, 1)
  const monday = new Date(first)
  monday.setDate(first.getDate() - ((first.getDay() + 6) % 7))
  const weeks = []
  for (let m = monday; ; m = new Date(m.getFullYear(), m.getMonth(), m.getDate() + 7)) {
    const mon = iso(m)
    const fri = addDays(mon, 4)
    const startsAfter = m.getFullYear() * 12 + m.getMonth() > year * 12 + month
    if (startsAfter) break
    // Skip a leading week whose weekdays all fall in the previous month.
    if (fri >= iso(first)) weeks.push({ monday: mon, friday: fri })
  }
  return weeks
}

// The Monday of the week a date falls in (weekends belong to the week before).
export function mondayOf(isoDate) {
  const d = parseLocalDate(isoDate)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return iso(d)
}

// Who is off between monday and friday. Returns one line per request, sorted
// by name: { name, email, branch, from, to, wholeWeek, portion, remote, status }.
// Only approved time off counts, unless includePending is set.
export function peopleOffInWeek(requests, monday, friday, { includePending = false } = {}) {
  const wanted = r => r.status === TIME_OFF_STATUS.APPROVED || (includePending && r.status === TIME_OFF_STATUS.PENDING)
  return (requests || [])
    .filter(r => wanted(r) && r.start_date <= friday && r.end_date >= monday)
    .map(r => {
      let from = r.start_date > monday ? r.start_date : monday
      let to = r.end_date < friday ? r.end_date : friday
      // Move off weekend edges so "Sat to Mon" reads as just "Mon".
      while (from <= to && !isWeekday(from)) from = addDays(from, 1)
      while (to >= from && !isWeekday(to)) to = addDays(to, -1)
      if (from > to) return null
      return {
        id: r.id,
        name: r.employee?.full_name || 'Someone',
        email: r.employee?.email || '',
        branch: r.employee?.branch || null,
        from, to,
        wholeWeek: from === monday && to === friday,
        portion: r.day_portion && r.day_portion !== 'full' ? r.day_portion : null,
        remote: r.type === 'work_from_wherever',
        status: r.status,
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name) || (a.from < b.from ? -1 : 1))
}

const SHORT = { weekday: 'short', month: 'short', day: 'numeric' }

// "All week", "Mon, Nov 16", "Fri, Nov 20 (afternoon)", "Mon, Nov 16 to Wed, Nov 18".
export function describeDays(entry) {
  let when
  if (entry.wholeWeek) when = 'All week'
  else if (entry.from === entry.to) when = formatDate(entry.from, SHORT) + (entry.portion === 'am' ? ' (morning)' : entry.portion === 'pm' ? ' (afternoon)' : '')
  else when = `${formatDate(entry.from, SHORT)} to ${formatDate(entry.to, SHORT)}`
  return entry.remote ? `${when}, working remotely` : when
}

export function weekTitle(monday) {
  return `Week of ${formatDate(monday, { weekday: 'long', month: 'long', day: 'numeric' })}`
}

// The text and HTML put on the clipboard. HTML pastes into Outlook or Gmail
// as a bulleted list; the plain text is the fallback for anything else.
//   holidays: [{ date, name }] falling in the week
//   showBranch: add each person's branch (useful when the list covers several)
export function weekEmail(monday, entries, { holidays = [], showBranch = false } = {}) {
  const title = `Who's off: ${weekTitle(monday).replace(/^Week/, 'week')}`
  const label = e => `${e.name}${showBranch ? ` (${branchName(e.branch || 'halifax')})` : ''}`
  const lines = entries.map(e => `${label(e)}: ${describeDays(e)}`)
  const hols = holidays.map(h => `${h.name}, ${formatDate(h.date, SHORT)}`)

  const text = [
    title,
    '',
    ...(lines.length ? lines.map(l => `- ${l}`) : ['Nobody is booked off this week.']),
    ...(hols.length ? ['', `Holiday${hols.length > 1 ? 's' : ''}: ${hols.join('; ')}`] : []),
  ].join('\n')

  const html = [
    `<p><strong>${escapeHtml(title)}</strong></p>`,
    lines.length
      ? `<ul>${entries.map(e => `<li><strong>${escapeHtml(label(e))}</strong>: ${escapeHtml(describeDays(e))}</li>`).join('')}</ul>`
      : '<p>Nobody is booked off this week.</p>',
    hols.length ? `<p>Holiday${hols.length > 1 ? 's' : ''}: ${escapeHtml(hols.join('; '))}</p>` : '',
  ].join('')

  return { text, html }
}

// Puts both versions on the clipboard. Falls back to plain text where the
// browser can't write HTML. Resolves true on success.
export async function copyRich({ text, html }) {
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new window.ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      })])
      return true
    }
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try { await navigator.clipboard.writeText(text); return true } catch { return false }
  }
}
