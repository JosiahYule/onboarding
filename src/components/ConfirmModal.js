import { useEffect, useRef, useState } from 'react'
import Button from '../ui/Button'
import Modal from '../ui/Modal'

export default function ConfirmModal({ title, message, confirmLabel, confirmDanger, onConfirm, onCancel }) {
  const [confirming, setConfirming] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => () => { mountedRef.current = false }, [])

  async function handleConfirm() {
    setConfirming(true)
    try {
      await onConfirm()
    } finally {
      if (mountedRef.current) setConfirming(false)
    }
  }

  return (
    <Modal
      title={title}
      description={message}
      onClose={onCancel}
      busy={confirming}
      maxWidth={400}
      // Danger dialogs focus Cancel so a stray Enter can't confirm a destructive action.
      initialFocus={confirmDanger ? 'first' : 'last'}
      footer={(
        <>
          <Button variant="glass" onClick={onCancel} disabled={confirming}>
            Cancel
          </Button>
          <Button
            variant={confirmDanger ? 'danger' : 'primary'}
            onClick={handleConfirm}
            busy={confirming}
            busyLabel="Working…"
            style={{ minWidth: '88px' }}
          >
            {confirmLabel || 'Confirm'}
          </Button>
        </>
      )}
    />
  )
}
