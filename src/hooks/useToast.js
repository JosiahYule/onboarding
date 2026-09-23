import { useState, useCallback } from 'react'

export default function useToast() {
  const [toast, setToast] = useState(null)

  // A fresh id per toast lets callers key the <Toast>, so a second message
  // gets its own full display time instead of inheriting the first's timer.
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type, id: Date.now() + Math.random() })
  }, [])

  const hideToast = useCallback(() => {
    setToast(null)
  }, [])

  return { toast, showToast, hideToast }
}