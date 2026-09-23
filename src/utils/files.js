// Storage keys become part of a URL. Characters like #, ?, % and spaces in an
// uploaded file's name break those links, so keep only a safe subset while
// preserving the extension.
export function safeFileName(name) {
  const cleaned = String(name || 'file')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.]+|_+$/g, '')
  return cleaned || 'file'
}
