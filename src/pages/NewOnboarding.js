import { useState } from 'react'
import { supabase } from '../supabaseClient'
import Layout from '../components/Layout'
import { handleSupabaseError } from '../utils/handleError'
import { logAudit } from '../utils/auditLog'
import { getHrEmail } from '../utils/getHrEmail'
import { escapeHtml } from '../utils/escapeHtml'
import { ONBOARDING_STATUS, brandInfo, brandName } from '../config'
import { T } from '../ui/theme'
import PageHeader from '../ui/PageHeader'
import Field from '../ui/Field'
import Button from '../ui/Button'
import { useWindowSize } from '../hooks/useWindowSize'
import { formatDate } from '../utils/dates'

export default function NewOnboarding({ session, userProfile, roleId, roleName, roleBrand, onBack, onNavigate, onComplete }) {
  const { isMobile } = useWindowSize()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [hireDate, setHireDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [touched, setTouched] = useState({})

  const emailValid = !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const nameError = touched.name && !fullName.trim() ? 'Please enter the employee\'s full name.' : ''
  const emailError = touched.email && !emailValid ? 'Enter a valid email address.' : ''
  const dateError = touched.hireDate && !hireDate ? 'Please choose a start date.' : ''
  const markTouched = (field) => setTouched(t => ({ ...t, [field]: true }))

async function handleCreate(e) {
  e?.preventDefault()
  if (loading) return
  if (!fullName.trim() || !hireDate || !emailValid) {
    setTouched({ name: true, email: true, hireDate: true })
    setError('')
    return
  }
  setLoading(true)
  setError('')

  const { data: roleData } = await supabase.from('roles').select('brand').eq('id', roleId).single()
  const brand = roleData?.brand || 'ISL'

  const existingEmployees = await supabase
    .from('employees')
    .select('id, full_name, onboarding_instances (id, status)')
    .ilike('full_name', fullName.trim())

  if (existingEmployees.data && existingEmployees.data.length > 0) {
    const hasActive = existingEmployees.data.some(emp =>
      emp.onboarding_instances?.some(inst => inst.status === ONBOARDING_STATUS.ACTIVE)
    )
    if (hasActive) {
      setError(`An active onboarding already exists for someone named “${fullName.trim()}”. Check the dashboard before creating another.`)
      setLoading(false)
      return
    }
  }

  const { data, error: rpcError } = await supabase.rpc('create_onboarding', {
    p_full_name: fullName.trim(),
    p_email: email.trim(),
    p_role_id: roleId,
    p_hire_date: hireDate,
    p_brand: brand
  })

if (rpcError) {
  setError(handleSupabaseError(rpcError, 'Failed to create onboarding. Please try again.'))
  setLoading(false)
  return
}

  await sendOnboardingStartedEmails(fullName.trim(), email.trim(), roleName, hireDate, brand)
  await logAudit('onboarding_created', 'onboarding_instance', data.instance_id, {
    employee_name: fullName.trim(),
    role: roleName
  })

  setLoading(false)
  onComplete(data.instance_id)
}

async function sendOnboardingStartedEmails(name, employeeEmail, role, startDate, brandCode) {
  // Each agency's hires should be welcomed by that agency, not always by ISL.
  const agency = brandInfo(brandCode)
  const startFormatted = formatDate(startDate)
  const firstName = escapeHtml(name.split(' ')[0])
  const safeName = escapeHtml(name)
  const safeRole = escapeHtml(role)
  const safeEmail = escapeHtml(employeeEmail || 'not provided')
  const hrEmail = await getHrEmail()

  try {
    if (employeeEmail) {
      await supabase.functions.invoke('send-email', {
        body: {
          to: employeeEmail,
          subject: `Welcome to ${agency.name}, ${name.split(' ')[0]}`,
          html: `
            <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a;">
              <h1 style="font-size: 22px; font-weight: 600; letter-spacing: -0.4px; margin-bottom: 16px;">Welcome aboard, ${firstName}</h1>
              <p style="font-size: 15px; line-height: 1.6; color: #444;">We're excited to have you joining as a <strong>${safeRole}</strong>, starting <strong>${startFormatted}</strong>.</p>
              <p style="font-size: 15px; line-height: 1.6; color: #444;">Our HR team has prepared your onboarding plan and will be in touch shortly with next steps, required paperwork, and training schedule.</p>
              <p style="font-size: 15px; line-height: 1.6; color: #444;">If you have any questions before your start date, please reach out.</p>
              <p style="font-size: 15px; line-height: 1.6; color: #444; margin-top: 32px;">Welcome to the team.</p>
              <p style="font-size: 13px; color: #888; margin-top: 40px; border-top: 1px solid #eee; padding-top: 20px;">${escapeHtml(agency.signOff)}</p>
            </div>
          `
        }
      })
    }

    if (hrEmail) {
      await supabase.functions.invoke('send-email', {
        body: {
          to: hrEmail,
          subject: `New onboarding started: ${name}`,
          html: `
            <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a;">
              <h2 style="font-size: 18px; font-weight: 600; margin-bottom: 16px;">New onboarding plan created</h2>
              <table style="font-size: 14px; color: #444;">
                <tr><td style="padding: 4px 16px 4px 0; color: #888;">Employee</td><td>${safeName}</td></tr>
                <tr><td style="padding: 4px 16px 4px 0; color: #888;">Email</td><td>${safeEmail}</td></tr>
                <tr><td style="padding: 4px 16px 4px 0; color: #888;">Role</td><td>${safeRole}</td></tr>
                <tr><td style="padding: 4px 16px 4px 0; color: #888;">Start date</td><td>${startFormatted}</td></tr>
              </table>
              <p style="font-size: 13px; color: #888; margin-top: 32px;">Sent by Integrated Launch</p>
            </div>
          `
        }
      })
    }
  } catch (err) {
    console.error('Email notification failed:', err)
  }
}

  const agency = brandName(roleBrand)
  return (
    <Layout session={session} userProfile={userProfile} currentPage="active" onNavigate={onNavigate}>
      <PageHeader
        title="New onboarding"
        subtitle="Their plan is built from the role’s task template."
        back={{ label: 'Choose a different role', onClick: () => onNavigate('active') }}
      />

      <div style={{ padding: isMobile ? '20px 16px 40px' : '32px 40px 48px', maxWidth: '560px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', marginBottom: '24px', background: T.surfaceSunken, border: `1px solid ${T.borderSubtle}`, borderRadius: T.radiusMd }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: T.subtle, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Role</div>
            <div style={{ fontSize: '14px', fontWeight: 500, color: T.text, marginTop: '2px' }}>{roleName}{agency && <span style={{ color: T.muted, fontWeight: 400 }}> · {agency}</span>}</div>
          </div>
          <Button variant="link" size="sm" onClick={() => onNavigate('active')}>Change</Button>
        </div>

        <form onSubmit={handleCreate} noValidate>
          {error && (
            <div role="alert" style={{ fontSize: '13px', color: T.danger, background: T.dangerBg, border: `1px solid ${T.dangerBorder}`, borderRadius: T.radiusMd, padding: '10px 12px', marginBottom: '18px', lineHeight: 1.5 }}>
              {error}
            </div>
          )}

          <Field label="Full name" required error={nameError}>
            <input type="text" placeholder="Jane Smith" autoComplete="off" autoFocus
              value={fullName} onChange={e => setFullName(e.target.value)} onBlur={() => markTouched('name')} />
          </Field>

          <Field label="Email address" optional error={emailError}
            hint={emailError ? null : 'We’ll send a welcome email here. You can invite them to the portal later.'}>
            <input type="email" placeholder="jane@example.com" autoComplete="off" inputMode="email"
              value={email} onChange={e => setEmail(e.target.value)} onBlur={() => markTouched('email')} />
          </Field>

          <Field label="Start date" required error={dateError}>
            <input type="date" value={hireDate} onChange={e => setHireDate(e.target.value)} onBlur={() => markTouched('hireDate')} />
          </Field>

          <div style={{ display: 'flex', gap: '8px', marginTop: '26px', flexWrap: 'wrap' }}>
            <Button type="submit" busy={loading} busyLabel="Creating plan…">Create onboarding plan</Button>
            <Button variant="secondary" onClick={onBack} disabled={loading}>Cancel</Button>
          </div>
        </form>
      </div>
    </Layout>
  )
}
