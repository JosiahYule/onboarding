import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import Modal from './Modal'
import Field from './Field'
import Segmented from './Segmented'
import Tabs from './Tabs'
import Menu from './Menu'
import CheckCircle from './CheckCircle'

test('Modal is a labelled dialog that takes focus, closes on Escape, and hands focus back', () => {
  const onClose = vi.fn()
  function Harness() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        {open && (
          <Modal title="Edit employee" onClose={() => { onClose(); setOpen(false) }}>
            <input aria-label="Name" />
            <button>Save</button>
          </Modal>
        )}
      </>
    )
  }
  render(<Harness />)
  const opener = screen.getByRole('button', { name: 'Open' })
  opener.focus()
  fireEvent.click(opener)

  expect(screen.getByRole('dialog', { name: 'Edit employee' })).toHaveAttribute('aria-modal', 'true')
  expect(screen.getByLabelText('Name')).toHaveFocus()

  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(opener).toHaveFocus()
})

test('Modal ignores Escape while busy, so a save in flight is not abandoned', () => {
  const onClose = vi.fn()
  render(<Modal title="Saving" busy onClose={onClose}><button>OK</button></Modal>)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onClose).not.toHaveBeenCalled()
})

test('Field ties its label, hint and error to the control', () => {
  const { rerender } = render(<Field label="Email" hint="We’ll send a welcome email"><input /></Field>)
  const input = screen.getByLabelText('Email')
  expect(input).toHaveAccessibleDescription('We’ll send a welcome email')
  expect(input).not.toHaveAttribute('aria-invalid')

  rerender(<Field label="Email" error="Enter a valid email address."><input /></Field>)
  expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address.')
})

test('Segmented is a radio group that arrow keys move through', () => {
  function Harness() {
    const [v, setV] = useState('all')
    return <Segmented label="Show" value={v} onChange={setV} options={[{ value: 'all', label: 'All' }, { value: 'left', label: 'Remaining' }]} />
  }
  render(<Harness />)
  const all = screen.getByRole('radio', { name: 'All' })
  expect(all).toHaveAttribute('aria-checked', 'true')
  fireEvent.keyDown(all, { key: 'ArrowRight' })
  expect(screen.getByRole('radio', { name: 'Remaining' })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('radio', { name: 'Remaining' })).toHaveFocus()
})

test('Tabs skip disabled tabs with the arrow keys', () => {
  function Harness() {
    const [v, setV] = useState('a')
    return <Tabs label="Views" value={v} onChange={setV} items={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B', disabled: true }, { id: 'c', label: 'C' }]} />
  }
  render(<Harness />)
  fireEvent.keyDown(screen.getByRole('tab', { name: 'A' }), { key: 'ArrowRight' })
  expect(screen.getByRole('tab', { name: 'C' })).toHaveAttribute('aria-selected', 'true')
})

test('Menu opens from its trigger, runs an item, and closes', () => {
  const onArchive = vi.fn()
  render(<Menu label="More actions" items={[{ label: 'Archive', onClick: onArchive }, 'divider', { label: 'Delete', onClick: vi.fn(), danger: true }]} />)
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveFocus()
  fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }))
  expect(onArchive).toHaveBeenCalled()
  expect(screen.queryByRole('menu')).toBeNull()
})

test('CheckCircle with onToggle is a real, labelled checkbox', () => {
  const onToggle = vi.fn()
  render(<CheckCircle checked={false} label="Set up laptop" onToggle={onToggle} />)
  const box = screen.getByRole('checkbox', { name: 'Set up laptop' })
  expect(box).toHaveAttribute('aria-checked', 'false')
  fireEvent.click(box)
  expect(onToggle).toHaveBeenCalled()
})
