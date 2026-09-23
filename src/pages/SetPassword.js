import { useState } from 'react'
import { supabase } from '../supabaseClient'
import Button from '../ui/Button'
import Field from '../ui/Field'
import { T } from '../ui/theme'

const AUTH_ERROR_MAP = {
  'Auth session missing':       'Your invite link has expired. Please request a new one.',
  'New password should be different from the old password': 'Please choose a different password from your previous one.',
  'Password should be at least 6 characters': 'Password must be at least 8 characters.',
  'Token has expired or is invalid': 'Your invite link has expired. Please request a new one.',
}

function friendlyAuthError(msg) {
  for (const [key, friendly] of Object.entries(AUTH_ERROR_MAP)) {
    if (msg.includes(key)) return friendly
  }
  return msg || 'Something went wrong. Please try again.'
}

export default function SetPassword({ onComplete }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSetPassword() {
    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(friendlyAuthError(error.message))
      setLoading(false)
    } else {
      onComplete()
    }
  }

  const mismatch = confirm.length > 0 && password.length > 0 && confirm !== password

  return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.font, padding: '20px' }}>
      <main className="il-auth" style={{ width: '100%', maxWidth: '380px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '32px' }}>
          <div aria-hidden="true" style={{ width: '48px', height: '48px', background: 'linear-gradient(135deg, #004db3 0%, #0080ff 100%)', borderRadius: T.radiusLg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '16px', fontWeight: 700, marginBottom: '18px', boxShadow: '0 4px 16px rgba(0,102,204,0.3)' }}>IL</div>
          <h1 style={{ fontSize: '22px', fontWeight: 600, color: T.text, letterSpacing: '-0.6px', margin: '0 0 4px' }}>Set your password</h1>
          <div style={{ fontSize: '13px', color: T.muted, textAlign: 'center' }}>Create a password to access your onboarding portal.</div>
        </div>

        <form
          onSubmit={e => { e.preventDefault(); if (!loading) handleSetPassword() }}
          noValidate
          style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: '14px', padding: '28px', boxShadow: T.shadowMd }}
        >
          <Field label="New password" hint={password.length > 0 && password.length < 8 ? `${8 - password.length} more character${8 - password.length === 1 ? '' : 's'} needed` : 'At least 8 characters.'}>
            <input id="new-password" type="password" autoComplete="new-password" value={password} autoFocus
              onChange={e => setPassword(e.target.value)} />
          </Field>
          <Field label="Confirm password" error={mismatch ? 'Passwords don’t match yet.' : ''} style={{ marginBottom: '20px' }}>
            <input id="confirm-password" type="password" autoComplete="new-password" value={confirm}
              onChange={e => setConfirm(e.target.value)} />
          </Field>
          {error && (
            <div role="alert" style={{ fontSize: '12px', color: T.danger, marginBottom: '16px', padding: '10px 12px', background: T.dangerBg, border: `1px solid ${T.dangerBorder}`, borderRadius: T.radiusSm }}>
              {error}
            </div>
          )}
          <Button type="submit" fullWidth busy={loading} busyLabel="Saving…">
            Set password
          </Button>
        </form>
      </main>
    </div>
  )
}
