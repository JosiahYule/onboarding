export function getInitials(name) {
  if (!name) return '?'
  return name.split(' ').map(n => n[0]).filter(Boolean).join('').toUpperCase().slice(0, 2) || '?'
}

// "josiah.yule@integratedstaffing.ca" -> "Josiah Yule". Used where we only
// have the login email, so the sidebar shows a name rather than "josiah.yule".
export function displayNameFromEmail(email) {
  const local = String(email || '').split('@')[0]
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

// "super_admin" -> "Super admin"
export function humanize(value) {
  const s = String(value || '').replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
