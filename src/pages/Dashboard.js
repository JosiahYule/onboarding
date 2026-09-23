import { useState } from 'react'
import Layout from '../components/Layout'
import { SkeletonRow } from '../components/Skeleton'
import { useWindowSize } from '../hooks/useWindowSize'
import { getInitials } from '../utils/formatUtils'
import { avatarStyle } from '../utils/avatarColor'
import { useDashboard, calcProgress } from '../hooks/useDashboard'
import Button from '../ui/Button'
import EmptyState, { EmptyIcons } from '../ui/EmptyState'
import AnimatedNumber from '../ui/AnimatedNumber'
import PageHeader from '../ui/PageHeader'
import SearchInput from '../ui/SearchInput'
import { T } from '../ui/theme'
import { formatDate } from '../utils/dates'
import { getPhase } from '../utils/onboardingPhase'
import { ROLE } from '../config'

const COLS = '32px minmax(0, 2fr) minmax(0, 1.4fr) minmax(120px, 1fr) 120px 90px'

const S = {
  statLabel: { fontSize: '11px', color: T.subtle, marginBottom: '5px', fontWeight: 600, letterSpacing: '0.4px', textTransform: 'uppercase' },
  tableHeader: { display: 'grid', gridTemplateColumns: COLS, padding: '14px 12px', margin: '0 -12px', borderBottom: `1px solid ${T.borderSubtle}`, fontSize: '11px', color: T.subtle, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', alignItems: 'center', gap: '16px' },
  tableRow: { display: 'grid', gridTemplateColumns: COLS, padding: '14px 12px', margin: '0 -12px', width: 'calc(100% + 24px)', alignItems: 'center', gap: '16px', cursor: 'pointer', borderRadius: T.radiusMd, border: 'none', borderBottom: `1px solid ${T.borderSubtle}`, background: 'none', font: 'inherit', textAlign: 'left', color: 'inherit' },
  avatar: { width: '28px', height: '28px', borderRadius: '50%', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  avatarLg: { width: '38px', height: '38px', borderRadius: '10px', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  truncate: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  progressTrack: { flex: 1, height: '5px', background: T.borderSubtle, borderRadius: '99px', overflow: 'hidden' },
  phasePill: { fontSize: '11px', padding: '2px 8px', borderRadius: '99px', background: T.brandLight, color: T.brand, fontWeight: 600, whiteSpace: 'nowrap' },
}

function phasePillStyle(tone) {
  if (tone === 'warning') return { ...S.phasePill, background: T.warningBg, color: T.warning }
  if (tone === 'neutral') return { ...S.phasePill, background: T.hoverBg, color: T.muted }
  return S.phasePill
}

function Progress({ pct }) {
  const done = pct === 100
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }} aria-label={`${pct}% complete`}>
      <div style={S.progressTrack}>
        <div className="il-progress-fill" style={{ height: '100%', width: `${pct}%`, borderRadius: '99px', background: done ? T.success : `linear-gradient(90deg, ${T.brand}, ${T.brandMid})` }} />
      </div>
      <span className="il-tabular" style={{ fontSize: '12px', fontWeight: 600, color: done ? T.success : T.text, minWidth: '34px', textAlign: 'right' }}>{pct}%</span>
    </div>
  )
}

export default function Dashboard({ session, userProfile, onViewOnboarding, onNavigate, refreshKey }) {
  const { onboardings, completedCount, loading, fetchError, docStats, offToday, refetch: fetchOnboardings } = useDashboard(refreshKey)
  const { isMobile } = useWindowSize()
  const [query, setQuery] = useState('')
  // Managers get a read-only dashboard; starting onboardings is admin-only.
  const canManage = userProfile?.role === ROLE.ADMIN || userProfile?.role === ROLE.SUPER_ADMIN

  const rows = onboardings.map(o => ({ o, ...calcProgress(o.task_completions), phase: getPhase(o.employees.hire_date) }))
  const nearlyDone = rows.filter(r => r.total > 0 && r.pct >= 90).length

  const q = query.trim().toLowerCase()
  const visible = q
    ? rows.filter(({ o }) => [o.employees.full_name, o.employees.email, o.employees.roles?.name].some(v => (v || '').toLowerCase().includes(q)))
    : rows

  const px = isMobile ? '16px' : '40px'
  const offNames = offToday.map(r => r.employees?.full_name).filter(Boolean)

  return (
    <Layout session={session} userProfile={userProfile} currentPage="dashboard" onNavigate={onNavigate}>
      <PageHeader
        title="Dashboard"
        subtitle={isMobile ? null : 'Everyone currently onboarding, at a glance.'}
        actions={canManage && (
          <Button size="sm" onClick={() => onNavigate('active')}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M7 2v10M2 7h10" /></svg>
            {isMobile ? 'New' : 'New onboarding'}
          </Button>
        )}
      />

      <section aria-label="Summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: isMobile ? '8px' : '12px', padding: isMobile ? '14px 16px 4px' : `20px ${px} 6px` }}>
        {[
          { label: 'Active', value: onboardings.length },
          { label: isMobile ? '90%+ done' : 'Nearly done (90%+)', value: nearlyDone },
          { label: 'Completed', value: completedCount },
        ].map(stat => (
          <div key={stat.label} className="il-tile" style={{ padding: isMobile ? '13px 14px' : '18px 22px' }}>
            <div style={S.statLabel}>{stat.label}</div>
            <AnimatedNumber value={loading ? 0 : stat.value} style={{ fontSize: isMobile ? '22px' : '26px', fontWeight: 700, letterSpacing: '-0.8px', color: T.text }} />
          </div>
        ))}
      </section>

      {offNames.length > 0 && (
        <div role="status" style={{ margin: isMobile ? '10px 16px 0' : `14px ${px} 0`, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', background: T.successBg, border: `1px solid ${T.successBorder}`, borderRadius: T.radiusMd, fontSize: '12px', color: T.success }}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" style={{ flexShrink: 0 }}>
            <rect x="1" y="3" width="12" height="10" rx="1" /><path d="M1 6h12M4 1v4M10 1v4" />
          </svg>
          <span style={{ fontWeight: 600 }}>Off today:</span>
          <span>{offNames.join(', ')}</span>
        </div>
      )}

      <div style={{ padding: isMobile ? '0' : `0 ${px}`, flex: 1 }}>
        {!loading && !fetchError && onboardings.length > 3 && (
          <div style={{ padding: isMobile ? '14px 16px 4px' : '20px 0 0', maxWidth: isMobile ? 'none' : '320px' }}>
            <SearchInput value={query} onChange={setQuery} placeholder="Search by name, email or role" label="Search onboardings" />
          </div>
        )}

        {loading ? (
          isMobile ? (
            [1, 2, 3, 4].map(i => (
              <div key={i} style={{ padding: '14px 16px', borderBottom: `1px solid ${T.borderSubtle}`, display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ ...S.avatarLg, background: 'var(--skeleton-base)' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ height: '13px', background: 'var(--skeleton-base)', borderRadius: '4px', width: '55%', marginBottom: '8px' }} />
                  <div style={{ height: '4px', background: 'var(--skeleton-base)', borderRadius: '2px', width: '80%' }} />
                </div>
              </div>
            ))
          ) : (
            <div className="il-card" style={{ margin: '20px 0 40px', padding: '0 20px' }} aria-busy="true">
              <SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow />
            </div>
          )
        ) : fetchError ? (
          <EmptyState
            icon={EmptyIcons.alert}
            title="Couldn't load onboardings"
            message={fetchError}
            action={<Button variant="secondary" onClick={fetchOnboardings}>Try again</Button>}
          />
        ) : onboardings.length === 0 ? (
          <EmptyState
            icon={EmptyIcons.people}
            title="No active onboardings"
            message={canManage ? 'Start a new onboarding to build someone’s first-90-days plan.' : 'When HR starts an onboarding, it will appear here.'}
            action={canManage ? <Button onClick={() => onNavigate('active')}>New onboarding</Button> : null}
          />
        ) : visible.length === 0 ? (
          <EmptyState compact icon={EmptyIcons.search} title="No matches" message={`Nobody matches “${query}”.`}
            action={<Button variant="secondary" size="sm" onClick={() => setQuery('')}>Clear search</Button>} />
        ) : isMobile ? (
          <div style={{ paddingTop: '6px' }}>
            {visible.map(({ o, pct, phase }, i) => {
              const name = o.employees.full_name
              return (
                <button type="button" key={o.id} className="il-row il-stagger" aria-label={`${name}, ${o.employees.roles?.name || 'no role'}, ${pct}% complete`}
                  style={{ width: '100%', padding: '14px 16px', border: 'none', borderBottom: `1px solid ${T.borderSubtle}`, background: 'none', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', animationDelay: `${Math.min(i, 12) * 25}ms` }}
                  onClick={() => onViewOnboarding(o.id)}>
                  <div aria-hidden="true" style={{ ...S.avatarLg, ...avatarStyle(name) }}>{getInitials(name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                      <span style={{ ...S.truncate, fontSize: '14px', fontWeight: 500, color: T.text }}>{name}</span>
                      <span style={{ ...phasePillStyle(phase.tone), flexShrink: 0 }}>{phase.label}</span>
                    </div>
                    <div style={{ ...S.truncate, fontSize: '12px', color: T.muted, marginBottom: '8px' }}>{o.employees.roles?.name || 'No role'}</div>
                    <Progress pct={pct} />
                  </div>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" style={{ flexShrink: 0, color: T.subtle }}><path d="M5 3l4 4-4 4" /></svg>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="il-card" style={{ margin: '20px 0 40px', padding: '0 20px' }}>
            <div style={S.tableHeader} aria-hidden="true">
              <div></div><div>Employee</div><div>Role</div>
              <div>Progress</div><div>Phase</div>
              <div style={{ textAlign: 'right' }}>Start date</div>
            </div>
            {visible.map(({ o, pct, phase }, i) => {
              const name = o.employees.full_name
              const uploadedDocs = docStats[o.employees.id] || 0
              return (
                <button type="button" key={o.id} className="il-row il-stagger"
                  aria-label={`${name}, ${o.employees.roles?.name || 'no role'}, ${pct}% complete, ${phase.label}`}
                  style={{ ...S.tableRow, animationDelay: `${Math.min(i, 12) * 25}ms` }}
                  onClick={() => onViewOnboarding(o.id)}>
                  <div aria-hidden="true" style={{ ...S.avatar, ...avatarStyle(name) }}>{getInitials(name)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ ...S.truncate, fontSize: '13px', fontWeight: 500, color: T.text }}>{name}</div>
                    <div style={{ ...S.truncate, fontSize: '12px', color: T.subtle, marginTop: '2px' }}>
                      {o.employees.email || 'No email on file'}
                      {uploadedDocs > 0 && (
                        <span style={{ color: T.success }}> · {uploadedDocs} doc{uploadedDocs > 1 ? 's' : ''} uploaded</span>
                      )}
                    </div>
                  </div>
                  <div style={{ ...S.truncate, fontSize: '13px', color: T.text }}>{o.employees.roles?.name || '—'}</div>
                  <Progress pct={pct} />
                  <div><span style={phasePillStyle(phase.tone)}>{phase.label}</span></div>
                  <div className="il-tabular" style={{ fontSize: '13px', color: T.subtle, textAlign: 'right' }}>
                    {formatDate(o.employees.hire_date, { month: 'short', day: 'numeric' })}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </Layout>
  )
}
