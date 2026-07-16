import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  useChanges,
  useTasks,
  statusLabel,
  statusColor,
  riskLabel,
  riskColor,
  priorityLabel,
} from '../hooks/useDataverse';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../hooks/usePermissions';
import { getDisplayTimezone } from '../utils/format';
import type { Cgmp_changes } from '../generated/models/Cgmp_changesModel';
import { Cgmp_blackoutperiodsService } from '../generated';
import type { Cgmp_blackoutperiods } from '../generated/models/Cgmp_blackoutperiodsModel';
import {
  LineChart as RLineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

const PMO_LS_KEY = 'pmo-changelist-filters';
const FILTER_DEFAULTS = { search: '', status: '', risk: '', category: '', dateRange: 'all' };

/* ── Line Chart (Recharts) ── */
const LineChart = React.memo(function LineChart({
  data,
}: {
  data: Array<{ date: string; created: number; completedOnDay: number; failed: number; total: number }>;
}) {
  return (
    <div
      role="figure"
      aria-label={`Change trend line chart — ${data.length} data points showing created, completed, and failed changes`}
    >
      <ResponsiveContainer width="100%" height={200}>
        <RLineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            contentStyle={{ background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: 6 }}
          />
          <Line
            type="monotone"
            dataKey="created"
            stroke="var(--chart-blue)"
            strokeWidth={2}
            dot={false}
            name="Created"
          />
          <Line
            type="monotone"
            dataKey="completedOnDay"
            stroke="var(--chart-green)"
            strokeWidth={2}
            dot={false}
            name="Completed"
          />
          <Line type="monotone" dataKey="failed" stroke="var(--chart-red)" strokeWidth={2} dot={false} name="Failed" />
        </RLineChart>
      </ResponsiveContainer>
    </div>
  );
});

/* ── Donut Chart (Recharts) ── */
const DonutChart = React.memo(function DonutChart({
  buckets,
}: {
  buckets: Array<{ label: string; value: number; color: string; pct: string }>;
}) {
  const total = buckets.reduce((s, b) => s + b.value, 0);
  return (
    <div className="donut-chart-wrap">
      <div
        role="figure"
        aria-label={`Donut chart: ${buckets.map((b) => `${b.label} ${b.value}`).join(', ')}`}
        style={{ position: 'relative', width: 180, height: 180, flexShrink: 0 }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={buckets} cx="50%" cy="50%" innerRadius={44} outerRadius={70} dataKey="value" nameKey="label">
              {buckets.map((b, i) => (
                <Cell key={i} fill={b.color} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
            {total.toLocaleString()}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Total</div>
        </div>
      </div>
      <div className="donut-legend">
        {buckets.map((b, i) => (
          <div key={i} className="donut-legend__item">
            <span className="donut-legend__dot" style={{ background: b.color }} />
            <span className="donut-legend__label">{b.label}</span>
            <span className="donut-legend__count">
              {b.value.toLocaleString()} ({b.pct})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});

/* ── KPI Card ── */
const KpiCard = React.memo(function KpiCard({
  icon,
  title,
  value,
  delta,
  isPercent,
  iconBg,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  value: number;
  delta: number;
  isPercent?: boolean;
  iconBg: string;
  onClick?: () => void;
}) {
  const fmt = isPercent ? `${value.toFixed(1)}%` : value.toLocaleString();
  const deltaClass =
    delta > 0 ? 'kpi-card__delta--up' : delta < 0 ? 'kpi-card__delta--down' : 'kpi-card__delta--neutral';
  const deltaArrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '—';
  return (
    <div
      className={`kpi-card${onClick ? ' kpi-card--clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className="kpi-card__icon" style={{ background: iconBg }}>
        {icon}
      </div>
      <div className="kpi-card__body">
        <div className="kpi-card__title">{title}</div>
        <div className="kpi-card__value">{fmt}</div>
        {delta !== 0 ? (
          <div className={`kpi-card__delta ${deltaClass}`}>
            {deltaArrow} {Math.abs(delta).toFixed(1)}% vs last week
          </div>
        ) : (
          <div className="kpi-card__delta kpi-card__delta--neutral">— No change vs last week</div>
        )}
        {onClick && <div className="kpi-card__drill">View details →</div>}
      </div>
    </div>
  );
});

/* ── Status Badge ── */
function StatusBadge({ code }: { code: number }) {
  return <span className={`badge badge--status ${statusColor(code)}`}>{statusLabel(code)}</span>;
}

/* ── Risk Badge ── */
function RiskBadge({ code }: { code: number }) {
  return <span className={`badge badge--risk ${riskColor(code)}`}>{riskLabel(code)}</span>;
}

/* ── Recent Change Row ── */
function ChangeRow({ c }: { c: Cgmp_changes }) {
  return (
    <tr>
      <td>
        <span className="change-number">{c.cgmp_changenumber ?? '—'}</span>
      </td>
      <td className="change-title">{c.cgmp_title ?? '—'}</td>
      <td>
        <StatusBadge code={c.cgmp_status as unknown as number} />
      </td>
      <td>
        <RiskBadge code={c.cgmp_risklevel as unknown as number} />
      </td>
      <td className="change-date">
        {c.cgmp_starttime
          ? new Date(c.cgmp_starttime).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              timeZone: getDisplayTimezone(),
            })
          : '—'}
      </td>
      <td className="change-owner">{c.owneridname ?? '—'}</td>
    </tr>
  );
}

/* ── Mini Calendar ── */
function MiniCalendar({
  changes,
  blackouts,
  onNavigate,
}: {
  changes: Cgmp_changes[];
  blackouts: Cgmp_blackoutperiods[];
  onNavigate: (page: string) => void;
}) {
  const [offset, setOffset] = useState(0);
  const today = new Date();
  const base = new Date(today);
  base.setDate(base.getDate() + offset * 7);

  const weekStart = new Date(base);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const dayChanges = (d: Date) =>
    changes.filter((c) => {
      if (!c.cgmp_starttime) return false;
      const s = new Date(c.cgmp_starttime);
      return s.toDateString() === d.toDateString();
    });

  const isToday = (d: Date) => d.toDateString() === today.toDateString();

  /** Returns true if the given day falls within any blackout period. */
  const isBlackoutDay = (d: Date) =>
    blackouts.some((bp) => {
      const bpStart = new Date(bp.cgmp_startdate);
      const bpEnd = new Date(bp.cgmp_enddate);
      const dayStart = new Date(d);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(d);
      dayEnd.setHours(23, 59, 59, 999);
      return dayStart <= bpEnd && dayEnd >= bpStart;
    });

  return (
    <div className="mini-calendar">
      <div className="mini-calendar__header">
        <span className="mini-calendar__month">
          {base.toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            timeZone: getDisplayTimezone(),
          })}
        </span>
        <div className="mini-calendar__nav">
          <button onClick={() => setOffset((o) => o - 1)} aria-label="Previous week">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
            </svg>
          </button>
          <button onClick={() => setOffset((o) => o + 1)} aria-label="Next week">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
            </svg>
          </button>
        </div>
      </div>
      <div className="mini-calendar__days-header">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <span key={d} className="mini-calendar__day-label">
            {d}
          </span>
        ))}
      </div>
      <div className="mini-calendar__days">
        {days.map((d, i) => {
          const dc = dayChanges(d);
          return (
            <div
              key={i}
              className={`mini-calendar__day ${isToday(d) ? 'mini-calendar__day--today' : ''} ${isBlackoutDay(d) ? 'mini-calendar__day--blackout' : ''}`}
              style={isBlackoutDay(d) ? { background: 'rgba(209,52,56,0.12)', color: 'var(--danger)' } : undefined}
              title={isBlackoutDay(d) ? 'Blackout period — changes should not be scheduled' : undefined}
            >
              <span>{d.getDate()}</span>
              {dc.length > 0 && <span className="mini-calendar__dot" title={`${dc.length} change(s)`} />}
            </div>
          );
        })}
      </div>
      <div className="mini-calendar__events">
        {(() => {
          const allEvents = days.flatMap((d) => dayChanges(d).slice(0, 2));
          const shown = allEvents.slice(0, 4);
          const extra = allEvents.length - shown.length;
          const weekEnd = days[6];
          return (
            <>
              {shown.map((c, i) => (
                <div key={`${c.cgmp_changeid}-${i}`} className="calendar-event">
                  <span className="calendar-event__time">
                    {c.cgmp_starttime
                      ? new Date(c.cgmp_starttime).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: getDisplayTimezone(),
                        })
                      : ''}
                  </span>
                  <span className="calendar-event__title">{c.cgmp_title}</span>
                  <span className={`calendar-event__dot ${statusColor(c.cgmp_status as unknown as number)}`} />
                </div>
              ))}
              {extra > 0 && (
                <button
                  className="calendar-more-btn"
                  onClick={() => {
                    try {
                      localStorage.setItem(
                        PMO_LS_KEY,
                        JSON.stringify({
                          ...FILTER_DEFAULTS,
                          dateRange: 'custom',
                          customFrom: weekStart.toISOString().slice(0, 10),
                          customTo: weekEnd.toISOString().slice(0, 10),
                        })
                      );
                    } catch {}
                    onNavigate('pmo');
                  }}
                >
                  +{extra} more →
                </button>
              )}
            </>
          );
        })()}
        {days.every((d) => dayChanges(d).length === 0) && (
          <div className="calendar-empty">No scheduled changes this week</div>
        )}
        <button className="calendar-add-btn" onClick={() => onNavigate('pmo')} aria-label="Create new change">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
          </svg>
          Add New Event
        </button>
      </div>
    </div>
  );
}

/* ── AI Summary ── */
function AISummary({
  stats,
  showToast,
  onNavigate,
}: {
  stats: ReturnType<typeof useChanges>['stats'];
  showToast: (type: 'info' | 'success' | 'error' | 'warning', msg: string) => void;
  onNavigate: (page: string) => void;
}) {
  if (!stats) return null;
  return (
    <div className="ai-summary">
      <div className="ai-summary__header">
        <div className="ai-summary__icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="#0078D4">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        </div>
        <span className="ai-summary__title">AI Summary</span>
        <button className="ai-summary__link" onClick={() => onNavigate('reports')}>
          View Full Summary
        </button>
      </div>
      <p className="ai-summary__text">
        Today you have {stats.active} pending actions. {stats.total - stats.completed - stats.failed} changes are active
        or in review. SLA compliance is at {stats.slaCompliance.toFixed(1)}% which is{' '}
        {stats.slaCompliance >= 95 ? 'above' : 'below'} the target.
        {stats.failed > 0
          ? ` There are ${stats.failed} failed changes requiring attention.`
          : ' No critical escalations at this time.'}
      </p>
      <div className="ai-summary__stats">
        <div className="ai-stat">
          <span className="ai-stat__value">{stats.active}</span>
          <span className="ai-stat__label">Pending Actions</span>
        </div>
        <div className="ai-stat ai-stat--danger">
          <span className="ai-stat__value">{stats.failed}</span>
          <span className="ai-stat__label">Failed Changes</span>
        </div>
        <div className="ai-stat ai-stat--success">
          <span className="ai-stat__value">{stats.slaCompliance.toFixed(1)}%</span>
          <span className="ai-stat__label">SLA Compliance</span>
        </div>
      </div>
      <button className="ai-summary__btn" onClick={() => showToast('info', 'AI Assistant coming soon')}>
        Ask AI Assistant
      </button>
    </div>
  );
}

/* ── Quick Actions ── */
function QuickActions({ onNavigate }: { onNavigate: (page: string) => void }) {
  const actions = [
    {
      label: 'Create Change',
      sub: 'New Change Request',
      color: '#0078D4',
      icon: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
      page: 'pmo',
    },
    {
      label: 'Bulk Import',
      sub: 'Import from Excel/CSV',
      color: '#107C10',
      icon: 'M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z',
      page: 'pmo',
    },
    {
      label: 'Smart Bridge',
      sub: 'Create Teams Bridge',
      color: '#8764B8',
      icon: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
      page: 'giicc',
    },
    {
      label: 'Emergency Change',
      sub: 'Fast Track Workflow',
      color: '#D13438',
      icon: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
      page: 'pmo',
    },
    {
      label: 'Reports',
      sub: 'View & Generate',
      color: '#038387',
      icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z',
      page: 'reports',
    },
  ];
  return (
    <div className="quick-actions">
      {actions.map((a) => (
        <button key={a.label} className="quick-action" onClick={() => onNavigate(a.page)}>
          <div className="quick-action__icon" style={{ background: `${a.color}15`, color: a.color }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d={a.icon} />
            </svg>
          </div>
          <div className="quick-action__text">
            <span className="quick-action__label" style={{ color: a.color }}>
              {a.label}
            </span>
            <span className="quick-action__sub">{a.sub}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

/* ── Skeleton ── */
function Skeleton({ h = 20, w = '100%' }: { h?: number; w?: number | string }) {
  return <div className="skeleton" style={{ height: h, width: w }} />;
}

/* ── Dashboard ── */
type TimeRange = '7d' | '30d' | '90d';

export default function Dashboard() {
  const { stats, allChanges, loading, error, refresh } = useChanges();
  const { tasks } = useTasks();
  const { navigate, showToast, currentUserName } = useApp();
  const { role } = usePermissions();
  const [lastRefreshed, setLastRefreshed] = React.useState<Date>(new Date());
  const [slaBannerDismissed, setSlaBannerDismissed] = React.useState(false);
  const [timeRange, setTimeRange] = React.useState<TimeRange>('7d');
  const [blackouts, setBlackouts] = React.useState<Cgmp_blackoutperiods[]>([]);

  const goToFiltered = useCallback(
    (override: Partial<typeof FILTER_DEFAULTS>) => {
      try {
        localStorage.setItem(PMO_LS_KEY, JSON.stringify({ ...FILTER_DEFAULTS, ...override }));
      } catch {}
      navigate('pmo');
    },
    [navigate]
  );

  useEffect(() => {
    refresh();
  }, []);

  /* Load blackout periods so MiniCalendar can shade frozen days (F-049) */
  useEffect(() => {
    let mounted = true;
    Cgmp_blackoutperiodsService.getAll({ top: 200 })
      .then((r) => {
        if (mounted && r.success) setBlackouts(r.data ?? []);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const handleRefresh = React.useCallback(() => {
    refresh();
    setLastRefreshed(new Date());
  }, [refresh]);

  const windowDays = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;

  const { dateLabel, windowedTrend, windowedCompleted, windowedFailed, successRateDelta, failRateDelta } =
    React.useMemo(() => {
      const now = new Date();
      const from = new Date(now.getTime() - (windowDays - 1) * 86400000);
      const fmt = (d: Date) =>
        d.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: getDisplayTimezone(),
        });
      const label = `${fmt(from)} – ${fmt(now)}`;

      const periodMs = windowDays * 86400000;
      const windowStart = new Date(now.getTime() - periodMs);

      const inWindow = (iso: string | null | undefined) => {
        if (!iso) return false;
        const d = new Date(iso).getTime();
        return d >= windowStart.getTime() && d <= now.getTime();
      };

      const wCompleted = allChanges.filter(
        (c) =>
          inWindow((c as any).cgmp_actualendtime ?? c.modifiedon) && (c.cgmp_status as unknown as number) === 100000007
      ).length;
      const wFailed = allChanges.filter(
        (c) =>
          inWindow((c as any).cgmp_actualendtime ?? c.modifiedon) && (c.cgmp_status as unknown as number) === 100000008
      ).length;

      // Build trend data — daily buckets for ≤30d, weekly for 90d
      const bucketDays = windowDays <= 30 ? 1 : 7;
      const numBuckets = Math.ceil(windowDays / bucketDays);
      const trend = Array.from({ length: numBuckets }, (_, i) => {
        const bucketStart = new Date(now);
        bucketStart.setDate(bucketStart.getDate() - (numBuckets - 1 - i) * bucketDays);
        bucketStart.setHours(0, 0, 0, 0);
        const bucketEnd = new Date(bucketStart);
        bucketEnd.setDate(bucketEnd.getDate() + bucketDays - 1);
        bucketEnd.setHours(23, 59, 59, 999);
        const inBucket = allChanges.filter((c) => {
          const d = new Date(c.createdon ?? 0).getTime();
          return d >= bucketStart.getTime() && d <= bucketEnd.getTime();
        });
        const completedBucket = allChanges.filter((c) => {
          if ((c.cgmp_status as unknown as number) !== 100000007) return false;
          const endDate = (c as any).cgmp_actualendtime ?? c.modifiedon;
          const d = new Date(endDate ?? 0).getTime();
          return d >= bucketStart.getTime() && d <= bucketEnd.getTime();
        });
        return {
          date: bucketStart.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            timeZone: getDisplayTimezone(),
          }),
          created: inBucket.length,
          completedOnDay: completedBucket.length,
          failed: inBucket.filter((c) => (c.cgmp_status as unknown as number) === 100000008).length,
          total: inBucket.length,
          completed: completedBucket.length,
        };
      });

      const prevWindowStart = new Date(windowStart.getTime() - periodMs);
      const inPrevWindow = (iso: string | null | undefined) => {
        if (!iso) return false;
        const d = new Date(iso).getTime();
        return d >= prevWindowStart.getTime() && d < windowStart.getTime();
      };
      const wTotal = allChanges.filter((c) => inWindow(c.createdon)).length;
      const prevTotal = allChanges.filter((c) => inPrevWindow(c.createdon)).length;
      const prevCompleted = allChanges.filter(
        (c) =>
          inPrevWindow((c as any).cgmp_actualendtime ?? c.modifiedon) &&
          (c.cgmp_status as unknown as number) === 100000007
      ).length;
      const prevFailed = allChanges.filter(
        (c) =>
          inPrevWindow((c as any).cgmp_actualendtime ?? c.modifiedon) &&
          (c.cgmp_status as unknown as number) === 100000008
      ).length;
      const successRateDelta =
        Math.round((wCompleted / Math.max(wTotal, 1) - prevCompleted / Math.max(prevTotal, 1)) * 1000) / 10;
      const failRateDelta =
        Math.round((wFailed / Math.max(wTotal, 1) - prevFailed / Math.max(prevTotal, 1)) * 1000) / 10;

      return {
        dateLabel: label,
        windowedTrend: trend,
        windowedCompleted: wCompleted,
        windowedFailed: wFailed,
        successRateDelta,
        failRateDelta,
      };
    }, [allChanges, windowDays]);

  /* Scheduling conflicts in next 7 days */
  const schedulingConflicts = useMemo(() => {
    if (!allChanges || allChanges.length === 0) return [];
    const now = Date.now();
    const in7d = now + 7 * 86400000;
    const INACTIVE = new Set([100000000, 100000007, 100000008, 100000009]);
    const upcoming = allChanges.filter((c) => {
      const s = c.cgmp_status as unknown as number;
      if (INACTIVE.has(s)) return false;
      if (!c.cgmp_starttime || !c.cgmp_endtime) return false;
      const st = new Date(c.cgmp_starttime).getTime();
      return st >= now && st <= in7d;
    });
    const conflicting = new Set<string>();
    for (let i = 0; i < upcoming.length; i++) {
      for (let j = i + 1; j < upcoming.length; j++) {
        const a = upcoming[i],
          b = upcoming[j];
        if (!a.cgmp_changeid || !b.cgmp_changeid) continue;
        const aStart = new Date(a.cgmp_starttime!).getTime(),
          aEnd = new Date(a.cgmp_endtime!).getTime();
        const bStart = new Date(b.cgmp_starttime!).getTime(),
          bEnd = new Date(b.cgmp_endtime!).getTime();
        if (aEnd <= bStart || bEnd <= aStart) continue;
        const aLocs = (a.cgmp_location ?? '')
          .split(',')
          .map((l) => l.trim().toLowerCase())
          .filter(Boolean);
        const bLocs = (b.cgmp_location ?? '')
          .split(',')
          .map((l) => l.trim().toLowerCase())
          .filter(Boolean);
        if (
          aLocs.length &&
          bLocs.length &&
          aLocs.some((l) => bLocs.includes(l)) &&
          a.cgmp_changeid &&
          b.cgmp_changeid
        ) {
          conflicting.add(a.cgmp_changeid);
          conflicting.add(b.cgmp_changeid);
        }
      }
    }
    return upcoming.filter((c) => conflicting.has(c.cgmp_changeid));
  }, [allChanges]);

  /* Role-based highlights */
  const roleHighlights = useMemo(() => {
    if (!allChanges || role === undefined) return [];
    const S = {
      Draft: 100000000,
      Published: 100000001,
      UnderReview: 100000002,
      Released: 100000003,
      UATUpdates: 100000004,
      Locked: 100000005,
      InProgress: 100000006,
      Completed: 100000007,
      Failed: 100000008,
    };
    const by = (s: number) => allChanges.filter((c) => (c.cgmp_status as unknown as number) === s).length;
    if (role === 100000001) {
      // PMO
      return [
        {
          label: 'Drafts awaiting publish',
          count: by(S.Draft),
          color: 'var(--primary)',
          onClick: () => goToFiltered({ status: '100000000' }),
        },
        {
          label: 'Under Review',
          count: by(S.UnderReview),
          color: 'var(--orange)',
          onClick: () => goToFiltered({ status: '100000002' }),
        },
      ];
    }
    if (role === 100000002) {
      // IT Ops
      const overdueSLA = allChanges.filter((c) => {
        const s = c.cgmp_status as unknown as number;
        return (
          (s === S.Published || s === S.UnderReview) &&
          c.createdon &&
          (Date.now() - new Date(c.createdon).getTime()) / 86400000 >= 2
        );
      }).length;
      return [
        {
          label: 'Pending IT Ops review',
          count: by(S.Published),
          color: 'var(--primary)',
          onClick: () => goToFiltered({ status: '100000001' }),
        },
        {
          label: 'SLA breaches (≥2d)',
          count: overdueSLA,
          color: 'var(--danger)',
          onClick: () => goToFiltered({ status: '100000001' }),
        },
      ];
    }
    if (role === 100000003) {
      // ISM
      const urgentUAT = allChanges.filter((c) => {
        if (!(c as any).cgmp_uatrequired) return false;
        const s = c.cgmp_status as unknown as number;
        if (s !== S.Released && s !== S.InProgress) return false;
        if (!c.cgmp_starttime) return false;
        const d = (new Date(c.cgmp_starttime).getTime() - Date.now()) / 86400000;
        return d >= 0 && d <= 7;
      }).length;
      return [
        {
          label: 'UAT freeze in ≤7d',
          count: urgentUAT,
          color: urgentUAT > 0 ? 'var(--danger)' : 'var(--success)',
          onClick: () => navigate('ism'),
        },
        {
          label: 'Changes In Progress',
          count: by(S.InProgress),
          color: 'var(--primary)',
          onClick: () => navigate('ism'),
        },
      ];
    }
    if (role === 100000004) {
      // GIICC
      return [
        {
          label: 'Pending GIICC Handover',
          count: by(S.Locked),
          color: 'var(--orange)',
          onClick: () => navigate('giicc'),
        },
        { label: 'In Progress', count: by(S.InProgress), color: 'var(--primary)', onClick: () => navigate('giicc') },
      ];
    }
    return [];
  }, [allChanges, role, goToFiltered, navigate]);

  /* Role-based KPI cards (#56) */
  const roleKpiCards = useMemo(() => {
    if (!allChanges || role === undefined) return null;
    const S = {
      Draft: 100000000,
      Published: 100000001,
      UnderReview: 100000002,
      Released: 100000003,
      UATUpdates: 100000004,
      Locked: 100000005,
      InProgress: 100000006,
      Completed: 100000007,
      Failed: 100000008,
      Closed: 100000009,
    };
    const by = (s: number) => allChanges.filter((c) => (c.cgmp_status as unknown as number) === s).length;
    if (role === 100000001) {
      // PMO
      const avgDraftAge = (() => {
        const drafts = allChanges.filter((c) => (c.cgmp_status as unknown as number) === S.Draft && c.createdon);
        if (!drafts.length) return 0;
        return Math.round(
          drafts.reduce((sum, c) => sum + (Date.now() - new Date(c.createdon!).getTime()) / 86400000, 0) / drafts.length
        );
      })();
      return {
        title: 'PMO Summary',
        cards: [
          {
            icon: '📋',
            label: 'Drafts',
            value: by(S.Draft),
            color: '#0078D4',
            onClick: () => goToFiltered({ status: '100000000' }),
          },
          {
            icon: '📤',
            label: 'Published',
            value: by(S.Published),
            color: '#038387',
            onClick: () => goToFiltered({ status: '100000001' }),
          },
          {
            icon: '🔍',
            label: 'Under Review',
            value: by(S.UnderReview),
            color: '#FF8C00',
            onClick: () => goToFiltered({ status: '100000002' }),
          },
          {
            icon: '⏱',
            label: 'Avg Draft Age (days)',
            value: avgDraftAge,
            color: avgDraftAge > 7 ? '#D13438' : '#107C10',
            onClick: () => goToFiltered({ status: '100000000' }),
          },
        ],
      };
    }
    if (role === 100000002) {
      // IT Ops
      const overdue = allChanges.filter((c) => {
        const s = c.cgmp_status as unknown as number;
        return (
          (s === S.Published || s === S.UnderReview) &&
          c.createdon &&
          (Date.now() - new Date(c.createdon).getTime()) / 86400000 >= 2
        );
      }).length;
      const releasedToday = allChanges.filter((c) => {
        if ((c.cgmp_status as unknown as number) !== S.Released) return false;
        return c.cgmp_releasedat && Date.now() - new Date(c.cgmp_releasedat).getTime() < 86400000;
      }).length;
      return {
        title: 'IT Ops Summary',
        cards: [
          {
            icon: '⏳',
            label: 'Pending Review',
            value: by(S.Published),
            color: '#0078D4',
            onClick: () => goToFiltered({ status: '100000001' }),
          },
          {
            icon: '🚨',
            label: 'SLA Breaches (≥2d)',
            value: overdue,
            color: overdue > 0 ? '#D13438' : '#107C10',
            onClick: () => navigate('itops'),
          },
          {
            icon: '✅',
            label: 'Released Today',
            value: releasedToday,
            color: '#107C10',
            onClick: () => goToFiltered({ status: '100000003' }),
          },
          {
            icon: '🔄',
            label: 'Under Review',
            value: by(S.UnderReview),
            color: '#FF8C00',
            onClick: () => goToFiltered({ status: '100000002' }),
          },
        ],
      };
    }
    if (role === 100000003) {
      // ISM
      const urgentUAT = allChanges.filter((c) => {
        const s = c.cgmp_status as unknown as number;
        if (s !== S.Released && s !== S.InProgress) return false;
        if (!c.cgmp_starttime) return false;
        const d = (new Date(c.cgmp_starttime).getTime() - Date.now()) / 86400000;
        return d >= 0 && d <= 7;
      }).length;
      return {
        title: 'ISM Summary',
        cards: [
          {
            icon: '⚡',
            label: 'In Progress',
            value: by(S.InProgress),
            color: '#8764B8',
            onClick: () => navigate('ism'),
          },
          {
            icon: '🧪',
            label: 'UAT Deadline ≤7d',
            value: urgentUAT,
            color: urgentUAT > 0 ? '#D13438' : '#107C10',
            onClick: () => navigate('ism'),
          },
          {
            icon: '🏁',
            label: 'Released',
            value: by(S.Released),
            color: '#038387',
            onClick: () => goToFiltered({ status: '100000003' }),
          },
          {
            icon: '✔',
            label: 'Completed',
            value: by(S.Completed),
            color: '#107C10',
            onClick: () => goToFiltered({ status: '100000007' }),
          },
        ],
      };
    }
    if (role === 100000004) {
      // GIICC
      return {
        title: 'GIICC Summary',
        cards: [
          {
            icon: '🔒',
            label: 'Pending Handover',
            value: by(S.Locked),
            color: '#FF8C00',
            onClick: () => navigate('giicc'),
          },
          {
            icon: '⚡',
            label: 'In Progress',
            value: by(S.InProgress),
            color: '#8764B8',
            onClick: () => navigate('giicc'),
          },
          { icon: '❌', label: 'Failed', value: by(S.Failed), color: '#D13438', onClick: () => navigate('giicc') },
          { icon: '✔', label: 'Completed', value: by(S.Completed), color: '#107C10', onClick: () => navigate('giicc') },
        ],
      };
    }
    if (role === 100000000) {
      // Admin
      const pendingReview = by(S.Published) + by(S.UnderReview);
      const failedCount = by(S.Failed);
      const totalActive = by(S.InProgress) + by(S.Released) + by(S.UATUpdates) + by(S.Locked);
      return {
        title: 'Admin Overview',
        cards: [
          {
            icon: '⏳',
            label: 'Pending Review',
            value: pendingReview,
            color: pendingReview > 10 ? '#D13438' : '#0078D4',
            onClick: () => goToFiltered({ status: '100000001' }),
          },
          {
            icon: '❌',
            label: 'Failed Changes',
            value: failedCount,
            color: failedCount > 0 ? '#D13438' : '#107C10',
            onClick: () => goToFiltered({ status: '100000008' }),
          },
          {
            icon: '⚡',
            label: 'Active (Total)',
            value: totalActive,
            color: '#8764B8',
            onClick: () => navigate('reports'),
          },
          {
            icon: '📋',
            label: 'Drafts',
            value: by(S.Draft),
            color: '#038387',
            onClick: () => goToFiltered({ status: '100000000' }),
          },
        ],
      };
    }
    return null;
  }, [allChanges, role, goToFiltered, navigate]);

  const greeting = React.useMemo(() => {
    const h = new Date().getHours();
    const name = currentUserName?.split(' ')[0] || 'there';
    if (h < 12) return `Good morning, ${name}!`;
    if (h < 17) return `Good afternoon, ${name}!`;
    return `Good evening, ${name}!`;
  }, [currentUserName]);

  const kpiCards = useMemo(
    () =>
      stats
        ? [
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                  <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z" />
                </svg>
              ),
              title: 'Total Changes',
              value: stats.total,
              delta: stats.vsLastWeek.total,
              iconBg: '#0078D4',
              onClick: () => goToFiltered({}),
            },
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                  <path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z" />
                </svg>
              ),
              title: 'Upcoming Changes',
              value: stats.upcoming,
              delta: stats.vsLastWeek.upcoming,
              iconBg: '#038387',
              onClick: () => goToFiltered({ dateRange: 'week' }),
            },
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              ),
              title: 'Active Changes',
              value: stats.active,
              delta: stats.vsLastWeek.active,
              iconBg: '#8764B8',
              onClick: () => goToFiltered({ status: '100000006' }),
            },
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                </svg>
              ),
              title: `Completed (${timeRange})`,
              value: windowedCompleted,
              delta: stats.vsLastWeek.completed,
              iconBg: '#107C10',
              onClick: () => goToFiltered({ status: '100000007' }),
            },
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                </svg>
              ),
              title: `Failed (${timeRange})`,
              value: windowedFailed,
              delta: stats.vsLastWeek.failed,
              iconBg: '#D13438',
              onClick: () => goToFiltered({ status: '100000008' }),
            },
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                  <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
                </svg>
              ),
              title: 'SLA Compliance',
              value: stats.slaCompliance,
              delta: stats.vsLastWeek.sla,
              isPercent: true,
              iconBg: '#FF8C00',
              onClick: () => navigate('reports'),
            },
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                </svg>
              ),
              title: 'Success Rate',
              value: (stats.completed / Math.max(stats.total, 1)) * 100,
              delta: successRateDelta,
              isPercent: true,
              iconBg: '#107C10',
              onClick: () => goToFiltered({ status: '100000007' }),
            },
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                  <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
                </svg>
              ),
              title: 'Failure Rate',
              value: (stats.failed / Math.max(stats.total, 1)) * 100,
              delta: failRateDelta,
              isPercent: true,
              iconBg: '#D13438',
              onClick: () => goToFiltered({ status: '100000008' }),
            },
          ]
        : [],
    [stats, windowedCompleted, windowedFailed, timeRange, goToFiltered, navigate]
  );

  // priorityLabel is imported from useDataverse
  const taskPriorityColor = (p: number) =>
    p === 100000000 ? 'var(--danger)' : p === 100000001 ? '#d97706' : 'var(--text-secondary)';

  return (
    <div className="dashboard">
      {/* SLA Breach Banner */}
      {!loading && stats && stats.slaCompliance < 80 && !slaBannerDismissed && (
        <div className="sla-breach-banner" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
          </svg>
          <span>
            SLA compliance is at <strong>{stats.slaCompliance.toFixed(1)}%</strong> — below the 80% target. Review
            failed changes to restore compliance.
          </span>
          <button className="sla-breach-banner__action" onClick={() => navigate('reports')}>
            View Report
          </button>
          <button
            className="sla-breach-banner__dismiss"
            onClick={() => setSlaBannerDismissed(true)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
      {/* Header row */}
      <div className="dashboard__header">
        <div>
          <h1 className="dashboard__title">Dashboard</h1>
          <p className="dashboard__subtitle">{greeting} Here's what's happening in your governance platform.</p>
        </div>
        <div className="dashboard__controls">
          <div className="time-range-toggle">
            {(['7d', '30d', '90d'] as TimeRange[]).map((r) => (
              <button
                key={r}
                className={`time-range-toggle__btn${timeRange === r ? ' time-range-toggle__btn--active' : ''}`}
                onClick={() => setTimeRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="date-range">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z" />
            </svg>
            <span>{dateLabel}</span>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', alignSelf: 'center' }}>
            Refreshed{' '}
            {lastRefreshed.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: getDisplayTimezone(),
            })}
          </span>
          <button
            className="btn-outline"
            onClick={handleRefresh}
            disabled={loading}
            title="Refresh dashboard data"
            style={error ? { color: 'var(--danger)', borderColor: 'var(--danger)' } : undefined}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="currentColor"
              style={loading ? { animation: 'spin 1s linear infinite' } : undefined}
            >
              <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
            </svg>
            {error ? 'Retry' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Role Highlights */}
      {!loading && roleHighlights.length > 0 && (
        <div className="role-highlights">
          {roleHighlights.map((h) => (
            <button key={h.label} className="role-highlight-chip" onClick={h.onClick} style={{ borderColor: h.color }}>
              <span className="role-highlight-chip__count" style={{ color: h.color }}>
                {h.count}
              </span>
              <span className="role-highlight-chip__label">{h.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Role-Based KPI Cards (#56) */}
      {!loading && roleKpiCards && (
        <div className="dashboard-section">
          <div className="dashboard-section__header">
            <span className="dashboard-section__title">{roleKpiCards.title}</span>
          </div>
          <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {roleKpiCards.cards.map((card) => (
              <div
                key={card.label}
                className="kpi-card kpi-card--clickable"
                onClick={card.onClick}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    card.onClick();
                  }
                }}
                style={{ borderTop: `3px solid ${card.color}` }}
              >
                <div className="kpi-card__icon" style={{ background: card.color, fontSize: 18 }}>
                  <span aria-hidden="true">{card.icon}</span>
                </div>
                <div className="kpi-card__body">
                  <div className="kpi-card__title">{card.label}</div>
                  <div className="kpi-card__value">{card.value.toLocaleString()}</div>
                  <div className="kpi-card__drill">View details →</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="kpi-row">
        {loading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="kpi-card">
                <Skeleton h={80} />
              </div>
            ))
          : kpiCards.map((c) => <KpiCard key={c.title} {...c} />)}
      </div>

      {/* Charts */}
      <div className="charts-row">
        <div className="chart-card chart-card--line">
          <div className="chart-card__header">
            <span className="chart-card__title">Change Trend — Last {timeRange}</span>
            <div className="chart-legend">
              <span className="chart-legend__item">
                <span className="chart-legend__dot" style={{ background: 'var(--chart-green)' }} />
                Completed
              </span>
              <span className="chart-legend__item">
                <span className="chart-legend__dot" style={{ background: 'var(--chart-red)' }} />
                Failed
              </span>
              <span className="chart-legend__item">
                <span className="chart-legend__dot" style={{ background: 'var(--chart-blue)' }} />
                Created
              </span>
            </div>
          </div>
          {loading ? <Skeleton h={200} /> : <LineChart data={windowedTrend} />}
        </div>
        <div className="chart-card chart-card--donut">
          <div className="chart-card__header">
            <span className="chart-card__title">Change by Status</span>
          </div>
          {loading ? <Skeleton h={200} /> : stats && <DonutChart buckets={stats.statusBuckets} />}
        </div>
      </div>

      {/* Scheduling Conflict Widget */}
      {!loading && schedulingConflicts.length > 0 && (
        <div className="sched-conflict-widget" role="alert">
          <div className="sched-conflict-widget__header">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="currentColor"
              style={{ color: 'var(--orange)', flexShrink: 0 }}
            >
              <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
            </svg>
            <strong>
              {schedulingConflicts.length} change{schedulingConflicts.length !== 1 ? 's' : ''} overlap in the next 7
              days
            </strong>
            <button
              className="card__link"
              style={{ marginLeft: 'auto' }}
              onClick={() => goToFiltered({ dateRange: 'week' })}
            >
              View in PMO →
            </button>
          </div>
          <div className="sched-conflict-widget__list">
            {schedulingConflicts.slice(0, 4).map((c) => (
              <span
                key={c.cgmp_changeid}
                className="sched-conflict-chip"
                onClick={() => goToFiltered({ dateRange: 'week' })}
              >
                {c.cgmp_changenumber ?? '—'} · {c.cgmp_location ?? 'No location'}
              </span>
            ))}
            {schedulingConflicts.length > 4 && (
              <span className="sched-conflict-chip" style={{ opacity: 0.7 }}>
                +{schedulingConflicts.length - 4} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <QuickActions onNavigate={navigate} />

      {/* Bottom Row */}
      <div className="bottom-row">
        {/* Recent Changes */}
        <div className="card recent-changes">
          <div className="card__header">
            <span className="card__title">Recent Changes</span>
            <button className="card__link" onClick={() => navigate('pmo')}>
              View All
            </button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Change ID</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Risk</th>
                  <th>Start Date</th>
                  <th>Owner</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 6 }).map((_, j) => (
                          <td key={j}>
                            <Skeleton h={14} />
                          </td>
                        ))}
                      </tr>
                    ))
                  : stats?.recentChanges.map((c) => <ChangeRow key={c.cgmp_changeid} c={c} />)}
                {!loading && !stats?.recentChanges.length && (
                  <tr>
                    <td colSpan={6} className="table-empty">
                      No changes found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Calendar */}
        <div className="card calendar-card">
          <div className="card__header">
            <span className="card__title">My Calendar</span>
          </div>
          <MiniCalendar changes={allChanges} blackouts={blackouts} onNavigate={navigate} />
        </div>

        {/* AI Summary */}
        <div className="card">
          <AISummary stats={stats} showToast={showToast} onNavigate={navigate} />
        </div>

        {/* My Tasks */}
        <div className="card my-tasks-card">
          <div className="card__header">
            <span className="card__title">My Action Items</span>
            {tasks.length > 0 && <span className="badge badge--count">{tasks.length}</span>}
          </div>
          {tasks.length === 0 ? (
            <div className="my-tasks__empty">No pending tasks</div>
          ) : (
            <ul className="my-tasks__list">
              {tasks.slice(0, 5).map((t) => (
                <li key={t.cgmp_taskid} className="my-task">
                  <span
                    className="my-task__dot"
                    style={{ background: taskPriorityColor(t.cgmp_priority as unknown as number) }}
                  />
                  <div className="my-task__body">
                    <span className="my-task__title">{t.cgmp_title}</span>
                    {t.cgmp_duedate && (
                      <span className="my-task__due">
                        Due{' '}
                        {new Date(t.cgmp_duedate).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          timeZone: getDisplayTimezone(),
                        })}
                      </span>
                    )}
                  </div>
                  <span
                    className="my-task__priority"
                    style={{ color: taskPriorityColor(t.cgmp_priority as unknown as number) }}
                  >
                    {priorityLabel(t.cgmp_priority as unknown as number)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
