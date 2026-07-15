import { useMemo, useState } from 'react';
import { useChangeList, useAllBridges, STATUS, BRIDGE_STATUS } from '../../hooks/useDataverse';
import { useApp } from '../../context/AppContext';
import { SlidePanel } from '../ui/Modal';
import { ROLES } from '../../utils/roles';

const MEDAL = ['🥇', '🥈', '🥉'];
const MEDAL_LABEL = ['Gold medal — 1st place', 'Silver medal — 2nd place', 'Bronze medal — 3rd place'];

type TimeRange = '7d' | '30d' | '90d' | 'all';

function RankRow({ rank, name, value, sub, pct, maxPct, atRisk, highlight, onClick }: {
  rank: number; name: string; value: string | number; sub?: string; pct: number; maxPct: number; atRisk?: boolean; highlight?: boolean; onClick?: () => void;
}) {
  return (
    <div
      className={`lb-row${onClick ? ' lb-row--clickable' : ''}${highlight ? ' lb-row--highlight' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? e => e.key === 'Enter' && onClick() : undefined}
      style={{ cursor: onClick ? 'pointer' : undefined, background: highlight ? 'var(--primary-faint, rgba(0,120,212,0.07))' : undefined }}
    >
      <span className="lb-rank">
        {MEDAL[rank]
          ? <span aria-label={MEDAL_LABEL[rank]} role="img"><span aria-hidden="true">{MEDAL[rank]}</span></span>
          : `#${rank + 1}`}
      </span>
      <div className="lb-info">
        <span className="lb-name">
          {name}
          {atRisk && <span className="lb-at-risk-badge" aria-label="At risk — approaching SLA breach">At risk</span>}
        </span>
        {sub && <span className="lb-sub">{sub}</span>}
      </div>
      <div className="lb-bar-wrap">
        <div className="lb-bar" style={{ width: maxPct > 0 ? `${(pct / maxPct) * 100}%` : '0%' }} />
      </div>
      <span className="lb-value">{value}</span>
    </div>
  );
}

function LeaderboardSkeleton() {
  return (
    <div aria-label="Loading leaderboard" aria-busy="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ width: 24, height: 16, background: 'var(--border)', borderRadius: 4 }} />
          <div style={{ flex: 1, height: 16, background: 'var(--border)', borderRadius: 4 }} />
          <div style={{ width: 40, height: 16, background: 'var(--border)', borderRadius: 4 }} />
        </div>
      ))}
    </div>
  );
}

export default function Leaderboard() {
  const { isAdmin, userProfile, currentUserName } = useApp();
  const { changes, loading: changesLoading } = useChangeList();
  const { bridges, loading: bridgesLoading } = useAllBridges(0);
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [selectedISM, setSelectedISM] = useState<string | null>(null);

  const filteredChanges = useMemo(() => {
    if (timeRange === 'all') return changes;
    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return changes.filter(c => c.createdon && new Date(c.createdon) >= cutoff);
  }, [changes, timeRange]);

  const filteredBridges = useMemo(() => {
    if (timeRange === 'all') return bridges;
    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return bridges.filter(b => b.createdon && new Date(b.createdon) >= cutoff);
  }, [bridges, timeRange]);

  const isISM = Number(userProfile?.cgmp_role) === ROLES.ISM;

  /* Top ISMs, locations, and reviewers — single pass over changes */
  const { ismLeaders, locationLeaders, reviewLeaders } = useMemo(() => {
    if (!isAdmin && !isISM) return { ismLeaders: [], locationLeaders: [], reviewLeaders: [] };

    const ismMap: Record<string, { completed: number; failed: number; total: number }> = {};
    const locMap: Record<string, { completed: number; failed: number; total: number }> = {};
    const revMap: Record<string, { totalDays: number; count: number }> = {};

    filteredChanges.forEach(c => {
      const status = c.cgmp_status as unknown as number;

      // ISM leaders
      const ism = c.owneridname || 'Unknown';
      if (!ismMap[ism]) ismMap[ism] = { completed: 0, failed: 0, total: 0 };
      ismMap[ism].total++;
      if (status === STATUS.Completed) ismMap[ism].completed++;
      if (status === STATUS.Failed) ismMap[ism].failed++;

      // Location leaders
      const loc = c.cgmp_location || c.cgmp_region || 'Unknown';
      if (!locMap[loc]) locMap[loc] = { completed: 0, failed: 0, total: 0 };
      locMap[loc].total++;
      if (status === STATUS.Completed) locMap[loc].completed++;
      if (status === STATUS.Failed) locMap[loc].failed++;

      // Reviewer leaders
      if (c.cgmp_reviewedby && c.cgmp_reviewedat && c.createdon) {
        const reviewer = c.cgmp_reviewedby;
        const days = (new Date(c.cgmp_reviewedat).getTime() - new Date(c.createdon).getTime()) / 86400000;
        if (!revMap[reviewer]) revMap[reviewer] = { totalDays: 0, count: 0 };
        revMap[reviewer].totalDays += days;
        revMap[reviewer].count++;
      }
    });

    return {
      ismLeaders: Object.entries(ismMap)
        .map(([name, { completed, failed, total }]) => {
          const rate = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;
          return {
            name, completed, failed, total, rate,
            atRisk: rate < 70 || failed > 3,
          };
        })
        .filter(r => r.total >= 2)
        .sort((a, b) => b.rate - a.rate)
        .slice(0, 10),

      locationLeaders: Object.entries(locMap)
        .map(([name, { completed, failed, total }]) => {
          const cf = completed + failed;
          return { name, completed, total, failed, sla: cf > 0 ? Math.round((completed / cf) * 1000) / 10 : 100 };
        })
        .filter(r => r.total >= 2)
        .sort((a, b) => b.sla - a.sla)
        .slice(0, 10),

      reviewLeaders: Object.entries(revMap)
        .map(([name, { totalDays, count }]) => ({
          name, count,
          avgDays: Math.round((totalDays / count) * 10) / 10,
        }))
        .filter(r => r.count >= 1)
        .sort((a, b) => a.avgDays - b.avgDays)
        .slice(0, 10),
    };
  }, [filteredChanges, isAdmin, isISM]);

  /* Bridge completion leaders */
  const bridgeLeaders = useMemo(() => {
    if (!isAdmin) return [];
    const map: Record<string, { completed: number; total: number }> = {};
    filteredBridges.forEach(b => {
      const owner = b.owneridname || 'Unknown';
      if (!map[owner]) map[owner] = { completed: 0, total: 0 };
      map[owner].total++;
      if ((b.cgmp_status as unknown as number) === BRIDGE_STATUS.Completed) map[owner].completed++;
    });
    return Object.entries(map)
      .map(([name, { completed, total }]) => ({
        name, completed, total,
        rate: total > 0 ? Math.round((completed / total) * 1000) / 10 : 0,
      }))
      .filter(r => r.total >= 1)
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 10);
  }, [filteredBridges, isAdmin]);

  const loading = changesLoading || bridgesLoading;
  const maxISM = Math.max(...ismLeaders.map(r => r.rate), 1);
  const maxLoc = Math.max(...locationLeaders.map(r => r.sla), 1);
  const maxReview = Math.max(...reviewLeaders.map(r => r.avgDays), 1);
  const maxBridge = Math.max(...bridgeLeaders.map(r => r.rate), 1);
  const atRiskCount = ismLeaders.filter(r => r.atRisk).length;

  /* Drill-down data for selected ISM (#120) */
  const drillData = useMemo(() => {
    if (!selectedISM) return null;
    const ismChanges = filteredChanges.filter(c => (c.owneridname || 'Unknown') === selectedISM);
    const completed = ismChanges.filter(c => (c.cgmp_status as unknown as number) === STATUS.Completed).length;
    const failed = ismChanges.filter(c => (c.cgmp_status as unknown as number) === STATUS.Failed).length;
    const inProgress = ismChanges.filter(c => (c.cgmp_status as unknown as number) === STATUS.InProgress).length;
    const sla = ismChanges.length > 0 ? Math.round((completed / (completed + failed || 1)) * 1000) / 10 : 100;
    return { total: ismChanges.length, completed, failed, inProgress, sla, changes: ismChanges };
  }, [selectedISM, filteredChanges]);
  void drillData; // suppress warning — used in JSX below

  /* Peer comparison mode (#122): current user's ISM rank vs top */
  const myISMName = currentUserName || '';
  const myRankEntry = isISM && !isAdmin ? ismLeaders.find(r => r.name === myISMName || r.name.includes(myISMName.split(' ')[0] ?? '')) : null;
  const myRankIdx = myRankEntry ? ismLeaders.indexOf(myRankEntry) : -1;
  const topEntry = ismLeaders[0] ?? null;
  const gap = myRankEntry && topEntry && myRankEntry.name !== topEntry.name
    ? topEntry.rate - myRankEntry.rate
    : 0;

  if (!isAdmin && !isISM) {
    return (
      <div className="module-workspace">
        <div className="module-header">
          <div>
            <h1 className="module-title">Leaderboards</h1>
            <p className="module-subtitle">Top ISMs, fastest reviewers, and best locations</p>
          </div>
        </div>
        <div className="access-denied">
          <div className="access-denied__icon">🔒</div>
          <div className="access-denied__title">Admin Access Required</div>
          <p className="access-denied__msg">Leaderboards are restricted to platform administrators.</p>
        </div>
      </div>
    );
  }

  /* Peer Comparison view for ISM non-admin users (#122) */
  if (!isAdmin && isISM) {
    return (
      <div className="module-workspace">
        <div className="module-header">
          <div>
            <h1 className="module-title">My Performance</h1>
            <p className="module-subtitle">Your completion rate compared to peers</p>
          </div>
          <div className="lb-time-range" role="group" aria-label="Time range">
            {(['7d', '30d', '90d', 'all'] as TimeRange[]).map(tr => (
              <button key={tr} className={`btn btn--sm ${timeRange === tr ? 'btn--primary' : 'btn--outline'}`} onClick={() => setTimeRange(tr)}>
                {tr === 'all' ? 'All Time' : tr === '7d' ? 'Last 7D' : tr === '30d' ? 'Last 30D' : 'Last 90D'}
              </button>
            ))}
          </div>
        </div>
        {loading ? <LeaderboardSkeleton /> : (
          <div className="lb-grid" style={{ gridTemplateColumns: '1fr' }}>
            <div className="lb-card">
              <div className="lb-card__title">🏆 ISM Completion Rate — Your Rank</div>
              {myRankEntry ? (
                <>
                  <RankRow
                    rank={myRankIdx}
                    name={myRankEntry.name}
                    value={`${myRankEntry.rate}%`}
                    sub={`${myRankEntry.completed}/${myRankEntry.total} changes`}
                    pct={myRankEntry.rate}
                    maxPct={Math.max(...ismLeaders.map(r => r.rate), 1)}
                    atRisk={myRankEntry.atRisk}
                    highlight
                  />
                  {gap > 0 && (
                    <div style={{ margin: '10px 0 4px', padding: '8px 12px', background: 'var(--surface-alt)', borderRadius: 6, fontSize: 13 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Gap to #1 ({topEntry?.name}): </span>
                      <span style={{ fontWeight: 700, color: gap > 10 ? 'var(--danger)' : 'var(--orange)' }}>−{gap.toFixed(1)}%</span>
                    </div>
                  )}
                  {gap === 0 && myRankIdx === 0 && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--success)' }}>🥇 You are the top performer!</div>}
                </>
              ) : (
                <div className="lb-empty" role="status">No changes recorded in this period yet.</div>
              )}
              <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>FULL BOARD (top 5)</div>
                {ismLeaders.slice(0, 5).map((r, i) => (
                  <RankRow key={r.name} rank={i} name={r.name} value={`${r.rate}%`} sub={`${r.completed}/${r.total} changes`}
                    pct={r.rate} maxPct={Math.max(...ismLeaders.map(x => x.rate), 1)} atRisk={r.atRisk}
                    highlight={r.name === myRankEntry?.name}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!isAdmin && !isISM) return (
    <div className="workspace-placeholder workspace-placeholder--denied" role="alert">
      <span aria-hidden="true" style={{ fontSize: 48 }}>🔒</span>
      <h2>Access Denied</h2>
      <p>Leaderboard is restricted to Admin and ISM roles.</p>
    </div>
  );

  return (
    <div className="module-workspace">
      <div className="module-header">
        <div>
          <h1 className="module-title">Leaderboards</h1>
          <p className="module-subtitle">
            Top ISMs, fastest reviewers, and best locations (Admin only)
            {atRiskCount > 0 && (
              <span className="lb-at-risk-summary"> · {atRiskCount} ISM{atRiskCount > 1 ? 's' : ''} at risk</span>
            )}
          </p>
        </div>
        <div className="lb-time-range" role="group" aria-label="Time range">
          {(['7d', '30d', '90d', 'all'] as TimeRange[]).map(tr => (
            <button
              key={tr}
              className={`btn btn--sm ${timeRange === tr ? 'btn--primary' : 'btn--outline'}`}
              onClick={() => setTimeRange(tr)}
            >
              {tr === 'all' ? 'All Time' : tr === '7d' ? 'Last 7D' : tr === '30d' ? 'Last 30D' : 'Last 90D'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LeaderboardSkeleton />
      ) : (
        <div className="lb-grid">
          <div className="lb-card">
            <div className="lb-card__title">
              <span>🏆</span> Top ISMs by Completion Rate
            </div>
            {ismLeaders.map((r, i) => (
              <RankRow key={r.name} rank={i} name={r.name}
                value={`${r.rate}%`} sub={`${r.completed}/${r.total} changes`}
                pct={r.rate} maxPct={maxISM} atRisk={r.atRisk}
                onClick={() => setSelectedISM(r.name)} />
            ))}
            {!loading && ismLeaders.length === 0 && (
              <div
                style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-secondary)' }}
                aria-live="polite"
              >
                <div style={{ fontSize: 32, marginBottom: 8 }} aria-hidden="true">🏆</div>
                <p style={{ fontWeight: 600, marginBottom: 4 }}>No activity in this period</p>
                <p style={{ fontSize: 13 }}>No completed changes found for the selected time range.</p>
              </div>
            )}
          </div>

          <div className="lb-card">
            <div className="lb-card__title">
              <span>📍</span> Top Locations by SLA
            </div>
            {locationLeaders.map((r, i) => (
              <RankRow key={r.name} rank={i} name={r.name}
                value={`${r.sla}%`} sub={`${r.total} changes`}
                pct={r.sla} maxPct={maxLoc} />
            ))}
            {!loading && locationLeaders.length === 0 && (
              <div
                style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-secondary)' }}
                aria-live="polite"
              >
                <div style={{ fontSize: 32, marginBottom: 8 }} aria-hidden="true">📍</div>
                <p style={{ fontWeight: 600, marginBottom: 4 }}>No activity in this period</p>
                <p style={{ fontSize: 13 }}>No completed changes found for the selected time range.</p>
              </div>
            )}
          </div>

          <div className="lb-card">
            <div className="lb-card__title">
              <span>⚡</span> Fastest Reviewers (avg days)
            </div>
            {reviewLeaders.map((r, i) => (
              <RankRow key={r.name} rank={i} name={r.name}
                value={`${r.avgDays}d`} sub={`${r.count} review${r.count !== 1 ? 's' : ''}`}
                pct={maxReview - r.avgDays + 0.1} maxPct={maxReview} />
            ))}
            {!loading && reviewLeaders.length === 0 && (
              <div
                style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-secondary)' }}
                aria-live="polite"
              >
                <div style={{ fontSize: 32, marginBottom: 8 }} aria-hidden="true">⚡</div>
                <p style={{ fontWeight: 600, marginBottom: 4 }}>No activity in this period</p>
                <p style={{ fontSize: 13 }}>No completed changes found for the selected time range.</p>
              </div>
            )}
          </div>

          <div className="lb-card">
            <div className="lb-card__title">
              <span>🌉</span> Bridge Completion Leaders
            </div>
            {bridgeLeaders.map((r, i) => (
              <RankRow key={r.name} rank={i} name={r.name}
                value={`${r.rate}%`} sub={`${r.completed}/${r.total} bridges`}
                pct={r.rate} maxPct={maxBridge} />
            ))}
            {!loading && bridgeLeaders.length === 0 && (
              <div
                style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-secondary)' }}
                aria-live="polite"
              >
                <div style={{ fontSize: 32, marginBottom: 8 }} aria-hidden="true">🌉</div>
                <p style={{ fontWeight: 600, marginBottom: 4 }}>No activity in this period</p>
                <p style={{ fontSize: 13 }}>No completed changes found for the selected time range.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ISM Drill-Down Panel (#120) */}
      <SlidePanel
        open={!!selectedISM}
        onClose={() => setSelectedISM(null)}
        title={selectedISM ?? ''}
        subtitle="ISM Individual Breakdown"
        width={480}
      >
        {selectedISM && (() => {
          const ismChanges = filteredChanges.filter(c => (c.owneridname || 'Unknown') === selectedISM);
          const completed = ismChanges.filter(c => (c.cgmp_status as unknown as number) === STATUS.Completed).length;
          const failed = ismChanges.filter(c => (c.cgmp_status as unknown as number) === STATUS.Failed).length;
          const inProgress = ismChanges.filter(c => (c.cgmp_status as unknown as number) === STATUS.InProgress).length;
          const sla = completed + failed > 0 ? Math.round((completed / (completed + failed)) * 1000) / 10 : 100;
          const pairs: [string, string | number][] = [
            ['Total Changes', ismChanges.length],
            ['Completed', completed],
            ['Failed', failed],
            ['In Progress', inProgress],
            ['SLA Compliance', `${sla}%`],
          ];
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="rv-grid">
                {pairs.map(([label, value]) => (
                  <div key={String(label)} className="rv-field">
                    <span className="rv-field__label">{label}</span>
                    <span className="rv-field__value">{value}</span>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>RECENT CHANGES</div>
                {ismChanges.slice(0, 8).map(c => (
                  <div key={c.cgmp_changeid} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <span style={{ fontWeight: 600 }}>{c.cgmp_changenumber}</span>
                    <span style={{ flex: 1, margin: '0 8px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.cgmp_title}</span>
                    <span style={{ color: 'var(--text-tertiary)' }}>{c.cgmp_statusname}</span>
                  </div>
                ))}
                {ismChanges.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>No changes in this period.</div>}
              </div>
            </div>
          );
        })()}
      </SlidePanel>
    </div>
  );
}
