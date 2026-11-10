import { BUCKETS, formatDays } from '../utils/timeOffMath'
import Segmented from '../ui/Segmented'
import { T } from '../ui/theme'

// One primary figure per allowance. The supporting breakdown stays smaller
// so an employee can see what they have left before reading the details.
export default function TimeOffBalanceCard({ summaries, year, years, onYearChange, hasBalance, isMobile }) {
  const balances = summaries.filter(sum => sum.entitlement > 0 || sum.used > 0 || sum.pending > 0 || sum.bucket === 'vacation')
  return (
    <section aria-labelledby="il-bal-title" style={{ background: T.surface, border: '1px solid var(--border-card)', borderRadius: T.radiusMd, padding: isMobile ? '16px' : '22px', marginBottom: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <h2 id="il-bal-title" className="il-section-title">Your time off</h2>
        {years.length > 1 ? (
          <Segmented size="sm" label="Balance year" value={year} onChange={onYearChange}
            options={years.map(y => ({ value: y, label: String(y) }))} />
        ) : <span style={{ fontSize: T.fontSize.base, color: T.muted, fontVariantNumeric: 'tabular-nums' }}>{year}</span>}
      </div>
      {!hasBalance ? (
        <div style={{ fontSize: T.fontSize.base, color: T.muted, lineHeight: 1.6 }}>No {year} balance yet.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: !isMobile && balances.length > 1 ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)' }}>
          {balances.map((sum, i) => {
            const over = sum.remaining < 0
            const remaining = Math.abs(sum.remaining)
            const usedWidth = sum.available > 0 ? Math.max(0, Math.min(100, sum.used / sum.available * 100)) : 0
            const pendingWidth = sum.available > 0 ? Math.max(0, Math.min(100 - usedWidth, sum.pending / sum.available * 100)) : 0
            const remainingWidth = Math.max(0, 100 - usedWidth - pendingWidth)
            const divider = i > 0 ? isMobile
              ? { borderTop: `1px solid ${T.borderSubtle}`, marginTop: '24px', paddingTop: '24px' }
              : { borderLeft: `1px solid ${T.borderSubtle}`, paddingLeft: '24px' }
              : !isMobile && balances.length > 1 ? { paddingRight: '24px' } : {}
            return (
              <div key={sum.bucket} style={{ minWidth: 0, ...divider }}>
                <h3 style={{ margin: '0 0 8px', fontSize: T.fontSize.base, fontWeight: 500, color: T.text }}>{BUCKETS[sum.bucket].label}</h3>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
                  <span style={{ fontSize: T.fontSize['2xl'], lineHeight: 1.15, fontWeight: 600, letterSpacing: '-0.8px', fontVariantNumeric: 'tabular-nums', color: over ? T.danger : T.brand }}>
                    {formatDays(remaining).slice(0, -1)}
                  </span>
                  <span style={{ fontSize: T.fontSize.sm, color: over ? T.danger : T.muted }}>
                    {remaining === 1 ? 'day' : 'days'} {over ? 'over allowance' : sum.pending > 0 ? 'left after pending requests' : 'remaining'}
                  </span>
                </div>
                {sum.available > 0 && (
                  <div aria-hidden="true" style={{ height: '4px', borderRadius: T.radiusSm, background: T.borderSubtle, overflow: 'hidden', display: 'flex', marginBottom: '16px' }}>
                    {remainingWidth > 0 && <div style={{ width: `${remainingWidth}%`, background: T.brand }} />}
                    {usedWidth > 0 && <div style={{ width: `${usedWidth}%`, background: T.text }} />}
                    {pendingWidth > 0 && <div style={{ width: `${pendingWidth}%`, background: T.warning }} />}
                  </div>
                )}
                <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px', margin: 0 }}>
                  {/* Used and Pending carry the bar's colours, so the bar needs no separate key. */}
                  {[['Allowance', sum.available, null], ['Used', sum.used, T.text], ['Pending', sum.pending, T.warning]].map(([label, value, swatch]) => (
                    <div key={label}>
                      <dt style={{ fontSize: T.fontSize.sm, color: T.subtle, lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {swatch && sum.available > 0 && <span aria-hidden="true" style={{ width: '8px', height: '8px', borderRadius: '2px', background: swatch, flexShrink: 0 }} />}
                        {label}
                      </dt>
                      <dd style={{ margin: '4px 0 0', fontSize: T.fontSize.md, lineHeight: 1.4, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: label === 'Pending' && value > 0 ? T.warning : T.text }}>
                        {formatDays(value).slice(0, -1)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
