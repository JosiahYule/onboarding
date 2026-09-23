import Layout from '../components/Layout'
import { SkeletonRow } from '../components/Skeleton'
import Toast from '../components/Toast'
import useToast from '../hooks/useToast'
import { useWindowSize } from '../hooks/useWindowSize'
import { getInitials } from '../utils/formatUtils'
import { avatarStyle } from '../utils/avatarColor'
import { useDashboard, calcProgress } from '../hooks/useDashboard'
import Button from '../ui/Button'
import EmptyState from '../ui/EmptyState'
import AnimatedNumber from '../ui/AnimatedNumber'
import { T } from '../ui/theme'
import { formatDate } from '../utils/dates'
import { getPhase } from '../utils/onboardingPhase'
import { ROLE } from '../config'

const BASE_STYLES = {
  title: { fontSize: '20px', fontWeight: 600, letterSpacing: '-0.5px' },
  sub: { fontSize: '13px', color: T.muted, marginTop: '2px' },
  btn: { background: T.btnPrimaryBg, color: '#fff', border: 'none', borderRadius: T.radiusMd, padding: '8px 14px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', letterSpacing: '0.1px' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', background: T.border, borderBottom: `1px solid ${T.border}` },
  statLabel: { fontSize: '11px', color: T.subtle, marginBottom: '5px', fontWeight: 500, letterSpacing: '0.2px', textTransform: 'uppercase' },
  tableHeader: { display: 'grid', gridTemplateColumns: '32px 2fr 1.5fr 1fr 1fr 100px', padding: '14px 0', borderBottom: `1px solid ${T.borderSubtle}`, fontSize: '11px', color: T.subtle, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', alignItems: 'center', gap: '16px' },
  tableRow: { display: 'grid', gridTemplateColumns: '32px 2fr 1.5fr 1fr 1fr 100px', padding: '14px 0', borderBottom: '1px solid var(--border-subtle)', alignItems: 'center', gap: '16px', cursor: 'pointer', borderRadius: '8px' },
  avatar: { width: '28px', height: '28px', borderRadius: '50%', background: 'linear-gradient(135deg, #dbeafe, #bfdbfe)', color: '#1d4ed8', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  avatarLg: { width: '38px', height: '38px', borderRadius: '10px', background: 'linear-gradient(135deg, #dbeafe, #bfdbfe)', color: '#1d4ed8', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rowName: { fontSize: '13px', fontWeight: 500, color: T.text },
  rowMeta: { fontSize: '12px', color: T.subtle, marginTop: '2px' },
  rowText: { fontSize: '13px', color: T.text },
  rowTextMuted: { fontSize: '13px', color: T.subtle },
  progressWrap: { display: 'flex', alignItems: 'center', gap: '10px' },
  progressTrack: { flex: 1, height: '5px', background: T.borderSubtle, borderRadius: '99px', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: '99px', background: `linear-gradient(90deg, ${T.brand}, ${T.brandMid})` },
  progressText: { fontSize: '12px', fontWeight: 600, color: T.text, minWidth: '32px' },
  phasePill: { fontSize: '11px', padding: '2px 8px', borderRadius: '5px', background: T.brandLight, color: T.brand, fontWeight: 600 },
}

function phasePillStyle(tone) {
  if (tone === 'warning') return { ...BASE_STYLES.phasePill, background: T.warningBg, color: T.warning }
  if (tone === 'neutral') return { ...BASE_STYLES.phasePill, background: 'var(--hover-bg)', color: T.muted }
  return BASE_STYLES.phasePill
}

export default function Dashboard({ session, userProfile, onStartOnboarding, onViewOnboarding, onNavigate, refreshKey }) {
  const { onboardings, completedCount, loading, fetchError, docStats, offToday, refetch: fetchOnboardings } = useDashboard(refreshKey)
  const { toast, hideToast } = useToast()
  const { isMobile } = useWindowSize()
  // Managers get a read-only dashboard; starting onboardings is admin-only.
  const canManage = userProfile?.role === ROLE.ADMIN || userProfile?.role === ROLE.SUPER_ADMIN

  const completingThisWeek = onboardings.filter(o => {
    const { total, pct } = calcProgress(o.task_completions)
    return total > 0 && pct >= 90
  }).length

  const p = isMobile ? '16px' : '40px'

  const styles = {
    ...BASE_STYLES,
    header: { padding: isMobile ? '16px 16px 14px' : '28px 40px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 0 var(--border)', background: 'var(--surface)' },
    statsRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: isMobile ? '8px' : '12px', padding: isMobile ? '14px 16px 4px' : '20px 40px 6px' },
    stat: { padding: isMobile ? '13px 14px' : '18px 22px', borderRadius: T.radiusLg },
    statValue: { fontSize: isMobile ? '22px' : '26px', fontWeight: 700, letterSpacing: '-0.8px', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' },
    content: { padding: isMobile ? '0' : `0 ${p}`, flex: 1 },
    emptyState: { padding: isMobile ? '60px 16px' : '80px 40px', textAlign: 'center' },
    errorState: { padding: isMobile ? '60px 16px' : '80px 40px', textAlign: 'center', fontSize: '14px' },
  }

  return (
    <Layout session={session} userProfile={userProfile} currentPage="dashboard" onNavigate={onNavigate}>
      <div className="il-header" style={styles.header}>
        <div>
          <div style={styles.title}>Dashboard</div>
          {!isMobile && <div style={styles.sub}>Overview of active employee onboardings.</div>}
        </div>
        {canManage && (
          <Button size="sm" onClick={() => onNavigate('active')}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M7 2v10M2 7h10"/></svg>
            {isMobile ? 'New' : 'New onboarding'}
          </Button>
        )}
      </div>

      <div style={styles.statsRow}>
        <div className="il-tile" style={styles.stat}>
          <div style={styles.statLabel}>Active</div>
          <AnimatedNumber value={onboardings.length} style={styles.statValue} />
        </div>
        <div className="il-tile" style={styles.stat}>
          <div style={styles.statLabel}>90%+ done</div>
          <AnimatedNumber value={completingThisWeek} style={styles.statValue} />
        </div>
        <div className="il-tile" style={styles.stat}>
          <div style={styles.statLabel}>Completed</div>
          <AnimatedNumber value={completedCount} style={styles.statValue} />
        </div>
      </div>

      {offToday.length > 0 && (
        <div style={{ background: 'var(--surface-raised)', borderBottom: '1px solid var(--border)', padding: `10px ${p}`, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="var(--success)" strokeWidth="1.5" style={{ flexShrink: 0 }}>
            <rect x="1" y="3" width="12" height="10" rx="1"/><path d="M1 6h12M4 1v4M10 1v4"/>
          </svg>
          <span style={{ fontSize: '12px', color: 'var(--success)', fontWeight: 500 }}>Off today:</span>
          <span style={{ fontSize: '12px', color: 'var(--success)' }}>
            {offToday.map(r => r.employees?.full_name).filter(Boolean).join(', ')}
          </span>
        </div>
      )}

      <div style={styles.content}>
        {loading ? (
          isMobile ? (
            [1,2,3,4].map(i => (
              <div key={i} style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ ...styles.avatarLg, background: 'var(--skeleton-base)' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ height: '13px', background: 'var(--skeleton-base)', borderRadius: '4px', width: '55%', marginBottom: '8px' }} />
                  <div style={{ height: '4px', background: 'var(--skeleton-base)', borderRadius: '2px', width: '80%' }} />
                </div>
              </div>
            ))
          ) : (
            <div className="il-card" style={{ margin: '24px 0 40px', padding: '0 20px' }}>
              <div style={{ ...styles.tableHeader, padding: '14px 0' }}>
                <div></div><div>Employee</div><div>Role</div>
                <div>Progress</div><div>Phase</div>
                <div style={{ textAlign: 'right' }}>Start date</div>
              </div>
              <SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow />
            </div>
          )
        ) : fetchError ? (
          <div style={styles.errorState}>
            <div style={{ color: '#c04040', marginBottom: '12px' }}>{fetchError}</div>
            <Button variant="ghost" onClick={fetchOnboardings} style={{ color: 'var(--brand)' }}>
              Try again
            </Button>
          </div>
        ) : onboardings.length === 0 ? (
          <EmptyState
            icon={(
              <svg width="24" height="24" viewBox="0 0 36 36" fill="none">
                <circle cx="18" cy="12" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M5 34c0-7.2 5.8-13 13-13s13 5.8 13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <circle cx="27" cy="27" r="6" fill="#f7f6f3" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M24.5 27l1.5 1.5 3-3" stroke="#1a7a4a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
            title="No active onboardings"
            message="Start a new onboarding to get someone up to speed."
            action={canManage ? <Button onClick={() => onNavigate('active')}>New onboarding</Button> : null}
          />
        ) : isMobile ? (
          onboardings.map((o, i) => {
            const { pct } = calcProgress(o.task_completions)
            const name = o.employees.full_name
            const phase = getPhase(o.employees.hire_date)
            return (
              <button type="button" key={o.id} className="il-row il-stagger" aria-label={`View ${name}'s onboarding`}
                style={{ width: '100%', padding: '14px 16px', border: 'none', borderBottom: '1px solid var(--border-subtle)', background: 'none', font: 'inherit', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', animationDelay: `${Math.min(i, 12) * 25}ms` }}
                onClick={() => onViewOnboarding(o.id)}>
                <div style={{ ...styles.avatarLg, ...avatarStyle(name) }}>{getInitials(name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text)' }}>{name}</span>
                    <span style={phasePillStyle(phase.tone)}>{phase.label}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' }}>{o.employees.roles?.name || 'Unknown role'}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={styles.progressTrack}>
                      <div className="il-progress-fill" style={{ ...styles.progressFill, width: `${pct}%`, background: pct === 100 ? 'linear-gradient(90deg, #1a7a4a, #2ea864)' : 'linear-gradient(90deg, #0066cc, #3d9eff)' }} />
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: 500, color: pct === 100 ? '#1a7a4a' : '#18181b', flexShrink: 0 }}>{pct}%</span>
                  </div>
                </div>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#d4d3cf" strokeWidth="1.5" style={{ flexShrink: 0 }}><path d="M5 3l4 4-4 4"/></svg>
              </button>
            )
          })
        ) : (
          <div className="il-card" style={{ margin: '24px 0 40px', padding: '0 20px' }}>
            <div style={styles.tableHeader}>
              <div></div><div>Employee</div><div>Role</div>
              <div>Progress</div><div>Phase</div>
              <div style={{ textAlign: 'right' }}>Start date</div>
            </div>
            {onboardings.map((o, i) => {
              const { pct } = calcProgress(o.task_completions)
              const name = o.employees.full_name
              const phase = getPhase(o.employees.hire_date)
              const uploadedDocs = docStats[o.employees.id] || 0
              return (
                <button type="button" key={o.id} className="il-row il-stagger" aria-label={`View ${name}'s onboarding`}
                  style={{ ...styles.tableRow, width: '100%', border: 'none', borderBottom: '1px solid var(--border-subtle)', background: 'none', font: 'inherit', textAlign: 'left', animationDelay: `${Math.min(i, 12) * 25}ms` }}
                  onClick={() => onViewOnboarding(o.id)}>
                  <div style={{ ...styles.avatar, ...avatarStyle(name) }}>{getInitials(name)}</div>
                  <div>
                    <div style={styles.rowName}>{name}</div>
                    <div style={styles.rowMeta}>
                      {o.employees.email || ''}
                      {uploadedDocs > 0 && (
                        <span style={{ marginLeft: '8px', color: '#1a7a4a', fontSize: '11px' }}>
                          · {uploadedDocs} doc{uploadedDocs > 1 ? 's' : ''} uploaded
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={styles.rowText}>{o.employees.roles?.name || 'Unknown role'}</div>
                  <div style={styles.progressWrap}>
                    <div style={styles.progressTrack}><div className="il-progress-fill" style={{ ...styles.progressFill, width: `${pct}%`, background: pct === 100 ? 'linear-gradient(90deg, #1a7a4a, #2ea864)' : 'linear-gradient(90deg, #0066cc, #3d9eff)' }}></div></div>
                    <div style={{ ...styles.progressText, color: pct === 100 ? '#1a7a4a' : '#18181b' }}>{pct}%</div>
                  </div>
                  <div><span style={phasePillStyle(phase.tone)}>{phase.label}</span></div>
                  <div style={{ ...styles.rowTextMuted, textAlign: 'right' }} className="il-tabular">
                    {formatDate(o.employees.hire_date, { month: 'short', day: 'numeric' })}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onClose={hideToast} />}
    </Layout>
  )
}
