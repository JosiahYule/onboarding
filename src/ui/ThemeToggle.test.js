import { render, screen, fireEvent } from '@testing-library/react'
import ThemeToggle from './ThemeToggle'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
})

test('the icon and label update on the same click that changes the theme', () => {
  render(<ThemeToggle />)
  const button = screen.getByRole('button', { name: /switch to dark mode/i })
  fireEvent.click(button)
  expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  expect(button).toHaveAccessibleName(/switch to light mode/i)
  fireEvent.click(button)
  expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  expect(button).toHaveAccessibleName(/switch to dark mode/i)
})
