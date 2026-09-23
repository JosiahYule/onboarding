import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { logAudit } from '../utils/auditLog'
import { handleSupabaseError } from '../utils/handleError'
import { brandName } from '../config'
import Modal from '../ui/Modal'
import Field from '../ui/Field'
import Button from '../ui/Button'
import { T } from '../ui/theme'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function EditEmployeeModal({ employee, instanceId, onClose, onSave }) {
  const [fullName, setFullName] = useState(employee.full_name)
  const [email, setEmail] = useState(employee.email || '')
  const [hireDate, setHireDate] = useState(employee.hire_date)
  const [roleId, setRoleId] = useState(employee.role_id)
  const [managerId, setManagerId] = useState(employee.manager_id || '')
  const [roles, setRoles] = useState([])
  const [employees, setEmployees] = useState([])
  const [saving, setSaving] = useState(false)
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('roles').select('*').order('name').then(({ data }) => { if (data) setRoles(data) }),
      supabase.from('employees').select('id, full_name').order('full_name').then(({ data }) => { if (data) setEmployees(data) }),
    ]).finally(() => setOptionsLoading(false))
  }, [])

  const roleChanged = roleId !== employee.role_id
  const emailInvalid = email.trim() !== '' && !EMAIL_RE.test(email.trim())

  async function handleSave(e) {
    e?.preventDefault()
    if (!fullName.trim() || !hireDate) { setError('Name and start date are required.'); return }
    if (!roleId) { setError('Please select a role.'); return }
    if (emailInvalid) { setError('Enter a valid email address, or leave it blank.'); return }
    setSaving(true)
    setError('')

    const { error: rpcError } = await supabase.rpc('swap_employee_and_tasks', {
      p_employee_id: employee.id,
      p_full_name: fullName.trim(),
      p_email: email.trim(),
      p_hire_date: hireDate,
      p_role_id: roleId,
      p_manager_id: managerId || null,
      p_instance_id: (roleChanged && instanceId) ? instanceId : null,
    })

    if (rpcError) {
      setError(handleSupabaseError(rpcError, 'Failed to save employee details. Please try again.'))
      setSaving(false)
      return
    }

    if (roleChanged) {
      await logAudit('role_changed', 'employee', employee.id, {
        employee_name: fullName.trim(),
        old_role_id: employee.role_id,
        new_role_id: roleId
      })
    }
    await logAudit('employee_edited', 'employee', employee.id, { employee_name: fullName.trim() })

    const newRole = roles.find(r => r.id === roleId)
    const newManager = employees.find(e => e.id === managerId) || null
    setSaving(false)
    onSave({
      ...employee,
      full_name: fullName.trim(),
      email: email.trim(),
      hire_date: hireDate,
      role_id: roleId,
      manager_id: managerId || null,
      roles: newRole ? { name: newRole.name } : employee.roles,
      manager: newManager ? { id: newManager.id, full_name: newManager.full_name } : null
    })
  }

  return (
    <Modal
      title="Edit employee"
      onClose={onClose}
      busy={saving}
      closeOnBackdrop={false}
      maxWidth={440}
    >
      <form onSubmit={handleSave} noValidate>
        {error && (
          <div role="alert" style={{ fontSize: '12px', color: T.danger, background: T.dangerBg, border: `1px solid ${T.dangerBorder}`, borderRadius: T.radiusSm, padding: '10px 12px', marginBottom: '16px' }}>
            {error}
          </div>
        )}
        {roleChanged && (
          <div role="status" style={{ fontSize: '12px', color: T.warning, background: T.warningBg, border: `1px solid ${T.warningBorder}`, borderRadius: T.radiusSm, padding: '10px 12px', marginBottom: '16px', lineHeight: 1.5 }}>
            Changing the role resets all task progress and replaces the checklist with the new role's tasks.
          </div>
        )}
        <Field label="Full name" required>
          <input type="text" autoComplete="off" value={fullName} onChange={e => setFullName(e.target.value)} />
        </Field>
        <Field label="Email address" optional error={emailInvalid ? 'Enter a valid email address.' : ''}>
          <input type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} />
        </Field>
        <Field label="Start date" required>
          <input type="date" value={hireDate || ''} onChange={e => setHireDate(e.target.value)} />
        </Field>
        <Field label="Role" required>
          <select value={roleId || ''} onChange={e => setRoleId(e.target.value)} disabled={optionsLoading}>
            {optionsLoading ? <option value="">Loading roles…</option> : <option value="">Select a role…</option>}
            {roles.map(r => <option key={r.id} value={r.id}>{r.name} · {brandName(r.brand)}</option>)}
          </select>
        </Field>
        <Field label="Manager" optional>
          <select value={managerId} onChange={e => setManagerId(e.target.value)} disabled={optionsLoading}>
            <option value="">{optionsLoading ? 'Loading…' : 'No manager'}</option>
            {employees.filter(e => e.id !== employee.id).map(e => (
              <option key={e.id} value={e.id}>{e.full_name}</option>
            ))}
          </select>
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" busy={saving} busyLabel="Saving…">Save changes</Button>
        </div>
      </form>
    </Modal>
  )
}
