import { T } from './theme'

// Search field with a leading icon and a clear button.
export default function SearchInput({ value, onChange, placeholder = 'Search…', label = 'Search' }) {
  return (
    <div role="search" style={{ position: 'relative' }}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"
        style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: T.subtle }}>
        <circle cx="6" cy="6" r="4" /><path d="M10 10l2.5 2.5" />
      </svg>
      <input
        type="search"
        className="il-input"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape' && value) { e.preventDefault(); onChange('') } }}
        style={{ paddingLeft: '32px', paddingRight: value ? '32px' : '12px' }}
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange('')} className="il-link-subtle"
          style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', borderRadius: '6px', cursor: 'pointer', color: T.subtle, fontSize: '16px', lineHeight: 1, padding: 0 }}>
          ×
        </button>
      )}
    </div>
  )
}
