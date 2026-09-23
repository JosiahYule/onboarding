import { safeFileName } from './files'

test('keeps ordinary names and extensions', () => {
  expect(safeFileName('Offer-Letter_v2.pdf')).toBe('Offer-Letter_v2.pdf')
})

test('replaces URL-breaking characters and accents', () => {
  expect(safeFileName('Q3 #1 résumé?.docx')).toBe('Q3_1_resume_.docx')
})

test('never returns an empty name', () => {
  expect(safeFileName('???')).toBe('file')
  expect(safeFileName('')).toBe('file')
})
