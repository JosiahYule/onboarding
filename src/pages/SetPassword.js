import { useState } from 'react'
import { supabase } from '../supabaseClient'
import Button from '../ui/Button'
import Field from '../ui/Field'
import { T } from '../ui/theme'
import { BrandLockup, BrandLogo, BrandMark } from '../ui/Brand'

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
    <div className="signin">
      <main className="signin__panel">
        <div className="signin__form">
          <BrandLockup size={34} sub="Integrated Launch" />
          <h1 className="signin__title">Set your password</h1>
          <p className="signin__sub">Create a password to access your onboarding portal.</p>

          <form onSubmit={e => { e.preventDefault(); if (!loading) handleSetPassword() }} noValidate>
            <Field label="New password" hint={password.length > 0 && password.length < 8 ? `${8 - password.length} more character${8 - password.length === 1 ? '' : 's'} needed` : 'At least 8 characters.'}>
              <input id="new-password" type="password" autoComplete="new-password" value={password} autoFocus
                onChange={e => setPassword(e.target.value)} />
            </Field>
            <Field label="Confirm password" error={mismatch ? 'Passwords don’t match yet.' : ''} style={{ marginBottom: '20px' }}>
              <input id="confirm-password" type="password" autoComplete="new-password" value={confirm}
                onChange={e => setConfirm(e.target.value)} />
            </Field>
            {error && (
              <div role="alert" style={{ fontSize: 'var(--text-base)', color: T.danger, marginBottom: '16px', padding: '10px 12px', background: T.dangerBg, border: `1px solid ${T.dangerBorder}`, borderRadius: T.radiusSm }}>
                {error}
              </div>
            )}
            <Button type="submit" size="lg" fullWidth busy={loading} busyLabel="Saving…">
              Set password
            </Button>
          </form>
        </div>

        <footer className="signin__foot">
          <span>© {new Date().getFullYear()} Integrated Staffing Limited</span>
        </footer>
      </main>

      <aside className="signin__brand" aria-hidden="true">
        <span className="signin__watermark">
          <BrandMark size={560} tone="inverse" />
        </span>
        <BrandLogo className="signin__logo" />
      </aside>
    </div>
  )
}
