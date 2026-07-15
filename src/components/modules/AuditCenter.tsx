import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Cgmp_auditlogsService } from '../../generated';
import type { Cgmp_auditlogs } from '../../generated/models/Cgmp_auditlogsModel';
import { exportCSV } from '../../utils/csv';
import { fmtDateTimeShort as fmtDateShort, timeAgo, fmtDateTime, getDisplayTimezone } from '../../utils/format';
import { useApp } from '../../context/AppContext';

const PMO_LS_KEY = 'pmo-changelist-filters';
const FILTER_DEFAULTS = { search: '', status: '', risk: '', category: '', dateRange: 'all' };
const SAVED_VIEWS_KEY = 'cgmp-audit-views2';

const ENTITY_LABEL: Record<number, string> = {
  100000000: 'Change', 100000001: 'Project', 100000002: 'Bridge',
  100000003: 'User', 100000004: 'Notification', 100000005: 'Settings',
};
const EVENT_LABEL: Record<number, string> = {
  100000000: 'Login', 100000001: 'Logout', 100000002: 'Change Created',
  100000003: 'Change Updated', 100000004: 'Change Reviewed', 100000005: 'Change Released',
  100000006: 'Change Locked', 100000007: 'Change Completed', 100000008: 'Change Failed',
  100000009: 'Change Closed', 100000010: 'UAT Updated', 100000011: 'Bridge Created',
  100000012: 'Bridge Started', 100000013: 'Bridge Completed', 100000014: 'PIR Added',
  100000015: 'Project Updated', 100000016: 'Notification Sent', 100000017: 'Escalation',
  100000018: 'Settings Changed',
};
const ENTITY_CLASS: Record<number, string> = {
  100000000: 'status-review', 100000001: 'status-released', 100000002: 'status-uat',
  100000003: 'status-published', 100000004: 'status-inprogress', 100000005: 'status-draft',
};

type Severity = 'critical' | 'warning' | 'success' | 'info';
const SEV_ORDER: Record<Severity, number> = { critical: 0, warning: 1, success: 2, info: 3 };

function getSeverity(eventType: number): Severity {
  if ([100000006, 100000017, 100000018].includes(eventType)) return 'critical';
  if ([100000004, 100000005, 100000008, 100000011, 100000012, 100000014, 100000015].includes(eventType)) return 'warning';
  if ([100000007, 100000009, 100000013].includes(eventType)) return 'success';
  return 'info';
}

const SEV_LABEL: Record<Severity, string> = { critical: 'Critical', warning: 'Warning', success: 'Success', info: 'Info' };
const SEV_CLASS: Record<Severity, string> = {
  critical: 'audit2-sev--critical', warning: 'audit2-sev--warning', success: 'audit2-sev--success', info: 'audit2-sev--info',
};
const SEV_COLOR: Record<Severity, string> = {
  critical: 'var(--danger)', warning: '#d97706', success: 'var(--success)', info: 'var(--primary)',
};

function fmtUTC(iso: string | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}
function formatJSON(str: string | undefined): string {
  if (!str) return '—';
  try { return JSON.stringify(JSON.parse(str), null, 2); } catch { return str; }
}

function getDayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: getDisplayTimezone() });
}

function StructuredDiff({ prev, next }: { prev: string | undefined; next: string | undefined }) {
  let prevObj: Record<string, unknown> | null = null;
  let nextObj: Record<string, unknown> | null = null;
  try { if (prev) prevObj = JSON.parse(prev); } catch {}
  try { if (next) nextObj = JSON.parse(next); } catch {}
  if (!prevObj && !nextObj) return null;
  const allKeys = new Set([...Object.keys(prevObj ?? {}), ...Object.keys(nextObj ?? {})]);
  const changed = [...allKeys].filter(k => JSON.stringify((prevObj ?? {})[k]) !== JSON.stringify((nextObj ?? {})[k]));
  if (changed.length === 0) return <div className="audit-diff-no-changes">No field changes detected.</div>;
  return (
    <table className="audit-diff-table">
      <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
      <tbody>
        {changed.map(k => {
          const pv = (prevObj ?? {})[k], nv = (nextObj ?? {})[k];
          return (
            <tr key={k}>
              <td className="audit-diff-field">{k}</td>
              <td className="audit-diff-prev">{pv != null ? String(pv) : <em style={{ color: 'var(--text-tertiary)' }}>—</em>}</td>
              <td className="audit-diff-next">{nv != null ? String(nv) : <em style={{ color: 'var(--text-tertiary)' }}>—</em>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

interface SavedView { name: string; entityFilter: string; eventFilter: string; severityFilter: string; dateFrom: string; dateTo: string; search: string; }
function loadViews(): SavedView[] { try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) ?? '[]') as SavedView[]; } catch { return []; } }
function saveViews(v: SavedView[]) { try { localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(v)); } catch {} }

// SVG bar chart for 7-day activity
function ActivityChart({ logs }: { logs: Cgmp_auditlogs[] }) {
  const days = useMemo(() => {
    const buckets: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      buckets[d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: getDisplayTimezone() })] = 0;
    }
    logs.forEach(l => {
      if (!l.createdon) return;
      const age = (Date.now() - new Date(l.createdon).getTime()) / 86400000;
      if (age <= 7) { const k = getDayKey(l.createdon); if (k in buckets) buckets[k]++; }
    });
    return Object.entries(buckets);
  }, [logs]);

  const max = Math.max(1, ...days.map(([, v]) => v));
  const W = 280, H = 80, barW = 28, gap = 12;

  return (
    <svg width={W} height={H + 20} viewBox={`0 0 ${W} ${H + 20}`} style={{ overflow: 'visible' }}>
      {days.map(([label, count], i) => {
        const barH = Math.max(2, (count / max) * H);
        const x = i * (barW + gap);
        const y = H - barH;
        return (
          <g key={label}>
            <rect x={x} y={y} width={barW} height={barH} rx={3} fill="var(--primary)" opacity={0.7} />
            {count > 0 && (
              <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize={9} fill="var(--text-secondary)">{count}</text>
            )}
            <text x={x + barW / 2} y={H + 14} textAnchor="middle" fontSize={8} fill="var(--text-tertiary)">
              {label.split(' ')[1]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(err => { if (import.meta.env.DEV) console.error('Clipboard write failed:', err); });
  };
  return (
    <button className="audit2-copy-btn" onClick={copy} title="Copy">
      {copied ? '✓' : '⎘'}
    </button>
  );
}

export default function AuditCenter() {
  const { navigate, isAdmin } = useApp();
  if (!isAdmin) return (
    <div className="workspace-placeholder workspace-placeholder--denied" role="alert">
      <span aria-hidden="true" style={{ fontSize: 48 }}>🔒</span>
      <h2>Access Denied</h2>
      <p>Audit Center is restricted to Administrators.</p>
    </div>
  );
  const [logs, setLogs] = useState<Cgmp_auditlogs[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityFilter, setEntityFilter] = useState('');
  const [eventFilter, setEventFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState<Severity | ''>('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showRawIds, setShowRawIds] = useState<Set<string>>(new Set());
  const PAGE_SIZE = 50;
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [loadMoreOffset, setLoadMoreOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showDashboard, setShowDashboard] = useState(true);
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => loadViews());
  const [newViewName, setNewViewName] = useState('');
  const [showSaveView, setShowSaveView] = useState(false);

  const toggleRaw = useCallback((id: string) => {
    setShowRawIds(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  }, []);

  const navigateToEntity = useCallback((entityType: number, entityName: string) => {
    if (entityType === 100000000) {
      try { localStorage.setItem(PMO_LS_KEY, JSON.stringify({ ...FILTER_DEFAULTS, search: entityName })); } catch {}
      navigate('pmo');
    } else if (entityType === 100000001) { navigate('ism');
    } else if (entityType === 100000002) { navigate('giicc'); }
  }, [navigate]);

  // Reset display count when any filter changes
  useEffect(() => { setDisplayCount(PAGE_SIZE); }, [entityFilter, eventFilter, severityFilter, search, dateFrom, dateTo, PAGE_SIZE]);

  const BATCH_SIZE = 200;

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setLoadMoreOffset(0);
    try {
      const r = await Cgmp_auditlogsService.getAll({ orderBy: ['createdon desc'], top: BATCH_SIZE });
      const data = r.data ?? [];
      setLogs(data);
      setHasMore(data.length === BATCH_SIZE);
      setLoadMoreOffset(data.length);
    } catch { setLogs([]); setHasMore(false); } finally { setLoading(false); }
  }, []);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const r = await Cgmp_auditlogsService.getAll({ orderBy: ['createdon desc'], top: BATCH_SIZE, skip: loadMoreOffset });
      const data = r.data ?? [];
      setLogs(prev => [...prev, ...data]);
      setHasMore(data.length === BATCH_SIZE);
      setLoadMoreOffset(prev => prev + data.length);
    } catch {} finally { setLoadingMore(false); }
  }, [loadMoreOffset]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const filtered = useMemo(() => {
    let list = logs;
    if (entityFilter) list = list.filter(l => (l.cgmp_entitytype as unknown as number) === parseInt(entityFilter));
    if (eventFilter) list = list.filter(l => (l.cgmp_eventtype as unknown as number) === parseInt(eventFilter));
    if (severityFilter) list = list.filter(l => getSeverity(l.cgmp_eventtype as unknown as number) === severityFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(l =>
        l.cgmp_entityname?.toLowerCase().includes(q) ||
        l.cgmp_username?.toLowerCase().includes(q) ||
        l.cgmp_useremail?.toLowerCase().includes(q) ||
        l.cgmp_auditlogname?.toLowerCase().includes(q) ||
        l.cgmp_sessionid?.toLowerCase().includes(q) ||
        l.cgmp_notes?.toLowerCase().includes(q)
      );
    }
    if (dateFrom) list = list.filter(l => l.createdon && l.createdon >= new Date(dateFrom).toISOString());
    if (dateTo) list = list.filter(l => l.createdon && l.createdon <= new Date(dateTo + 'T23:59:59').toISOString());
    return list;
  }, [logs, entityFilter, eventFilter, severityFilter, search, dateFrom, dateTo]);

  // Anomaly detection
  const anomalousIds = useMemo(() => {
    const flagged = new Set<string>();
    const userHourlyCounts = new Map<string, number[]>();
    logs.forEach(log => {
      const key = log.cgmp_useremail ?? log.cgmp_username ?? 'unknown';
      if (!userHourlyCounts.has(key)) userHourlyCounts.set(key, []);
      userHourlyCounts.get(key)!.push(new Date(log.createdon ?? 0).getTime());
    });
    const anomalousUsers = new Set<string>();
    userHourlyCounts.forEach((timestamps, key) => {
      const sorted = timestamps.sort((a, b) => a - b);
      for (let i = 0; i < sorted.length; i++) {
        const windowEnd = sorted[i] + 3600000;
        const count = sorted.filter(t => t >= sorted[i] && t <= windowEnd).length;
        if (count > 20) { anomalousUsers.add(key); break; }
      }
    });
    logs.forEach(l => {
      if (!l.cgmp_auditlogid) return;
      const key = l.cgmp_useremail ?? l.cgmp_username ?? 'unknown';
      if (anomalousUsers.has(key)) flagged.add(l.cgmp_auditlogid);
    });
    logs.forEach(l => {
      if (!l.cgmp_auditlogid) return;
      const et = l.cgmp_entitytype as unknown as number;
      const name = (l.cgmp_auditlogname ?? '').toLowerCase();
      if (et === 100000003 && name.includes('role')) flagged.add(l.cgmp_auditlogid);
      if (name.includes('bulk') || name.includes('import')) flagged.add(l.cgmp_auditlogid);
    });
    return flagged;
  }, [logs]);

  // Dashboard stats
  const dashStats = useMemo(() => {
    const total = logs.length;
    const today = logs.filter(l => l.createdon && (Date.now() - new Date(l.createdon).getTime()) < 86400000).length;
    const critical = logs.filter(l => getSeverity(l.cgmp_eventtype as unknown as number) === 'critical').length;
    const warnings = logs.filter(l => getSeverity(l.cgmp_eventtype as unknown as number) === 'warning').length;
    const anomalies = anomalousIds.size;
    const uniqueUsers = new Set(logs.map(l => l.cgmp_username).filter(Boolean)).size;

    // Top users by activity
    const userCount: Record<string, number> = {};
    logs.forEach(l => { if (l.cgmp_username) userCount[l.cgmp_username] = (userCount[l.cgmp_username] ?? 0) + 1; });
    const topUsers = Object.entries(userCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // Failed operations
    const failed = logs.filter(l => (l.cgmp_eventtype as unknown as number) === 100000008).length;

    return { total, today, critical, warnings, anomalies, uniqueUsers, topUsers, failed };
  }, [logs, anomalousIds]);

  const displayedLogs = filtered.slice(0, displayCount);

  // Related events by session
  const relatedBySession = useCallback((sessionId: string | undefined, currentId: string | undefined): Cgmp_auditlogs[] => {
    if (!sessionId) return [];
    return logs.filter(l => l.cgmp_sessionid === sessionId && l.cgmp_auditlogid !== currentId).slice(0, 5);
  }, [logs]);

  // Related events by entity
  const relatedByEntity = useCallback((entityId: string | undefined, currentId: string | undefined): Cgmp_auditlogs[] => {
    if (!entityId) return [];
    return logs.filter(l => l.cgmp_entityid === entityId && l.cgmp_auditlogid !== currentId).slice(0, 5);
  }, [logs]);

  const applyView = (v: SavedView) => {
    setEntityFilter(v.entityFilter); setEventFilter(v.eventFilter);
    setSeverityFilter(v.severityFilter as Severity | '');
    setDateFrom(v.dateFrom); setDateTo(v.dateTo); setSearch(v.search);
    setDisplayCount(PAGE_SIZE);
  };

  const saveCurrentView = () => {
    if (!newViewName.trim()) return;
    const v: SavedView = { name: newViewName.trim(), entityFilter, eventFilter, severityFilter, dateFrom, dateTo, search };
    const updated = [...savedViews.filter(x => x.name !== v.name), v];
    setSavedViews(updated); saveViews(updated);
    setNewViewName(''); setShowSaveView(false);
  };

  const deleteView = (name: string) => {
    const updated = savedViews.filter(v => v.name !== name);
    setSavedViews(updated); saveViews(updated);
  };

  const exportJSON = () => {
    const data = filtered.map(r => ({
      id: r.cgmp_auditlogid,
      timestamp: r.createdon,
      timestampUTC: r.createdon ? new Date(r.createdon).toISOString() : null,
      entityType: ENTITY_LABEL[r.cgmp_entitytype as unknown as number] ?? r.cgmp_entitytype,
      event: EVENT_LABEL[r.cgmp_eventtype as unknown as number] ?? r.cgmp_eventtype,
      severity: SEV_LABEL[getSeverity(r.cgmp_eventtype as unknown as number)],
      entityName: r.cgmp_entityname,
      entityId: r.cgmp_entityid,
      username: r.cgmp_username,
      userEmail: r.cgmp_useremail,
      browser: r.cgmp_ipaddress,
      sessionId: r.cgmp_sessionid,
      notes: r.cgmp_notes,
      previousValues: r.cgmp_previousvalues,
      newValues: r.cgmp_newvalues,
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  };

  const hasActiveFilters = entityFilter || eventFilter || severityFilter || search || dateFrom || dateTo;

  return (
    <div className="audit2-root">
      {/* Header */}
      <div className="module-header">
        <div>
          <h1 className="module-title">Audit Center</h1>
          <p className="module-subtitle">Enterprise audit trail — security, compliance, and system activity</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn--outline btn--sm" onClick={() => setShowDashboard(d => !d)}>
            {showDashboard ? 'Hide Dashboard' : 'Show Dashboard'}
          </button>
          <button className="btn btn--outline btn--sm" onClick={loadLogs}>Refresh</button>
          <button className="btn btn--outline btn--sm" onClick={exportJSON} disabled={filtered.length === 0}>JSON</button>
          <button className="btn btn--secondary btn--sm" onClick={() => exportCSV(
            `audit-log-${new Date().toISOString().slice(0, 10)}.csv`,
            ['Timestamp', 'UTC', 'Severity', 'Entity Type', 'Event', 'Entity Name', 'Entity ID', 'Username', 'Email', 'Browser', 'Session ID', 'Notes'],
            filtered.map(r => {
              const ev = r.cgmp_eventtype as unknown as number;
              const et = r.cgmp_entitytype as unknown as number;
              return [
                fmtDateTime(r.createdon),
                r.createdon ? new Date(r.createdon).toISOString() : '',
                SEV_LABEL[getSeverity(ev)],
                ENTITY_LABEL[et] ?? '',
                EVENT_LABEL[ev] ?? '',
                r.cgmp_entityname ?? '',
                r.cgmp_entityid ?? '',
                r.cgmp_username ?? '',
                r.cgmp_useremail ?? '',
                r.cgmp_ipaddress ?? '',
                r.cgmp_sessionid ?? '',
                (r.cgmp_notes ?? '').replace(/,/g, ';'),
              ];
            })
          )} disabled={filtered.length === 0}>
            Export CSV ({filtered.length})
          </button>
          <button className="btn btn--primary btn--sm" title="SOC 2 / ITIL compliance report" onClick={() => {
            const sorted = [...filtered].sort((a, b) =>
              SEV_ORDER[getSeverity(a.cgmp_eventtype as unknown as number)] - SEV_ORDER[getSeverity(b.cgmp_eventtype as unknown as number)]
            );
            exportCSV(
              `compliance-audit-${new Date().toISOString().slice(0, 10)}.csv`,
              ['Severity', 'Timestamp', 'UTC', 'Entity Type', 'Event', 'Entity Name', 'Entity ID', 'Actor (UPN)', 'Browser', 'Session ID', 'Notes'],
              sorted.map(r => {
                const ev = r.cgmp_eventtype as unknown as number;
                const et = r.cgmp_entitytype as unknown as number;
                return [
                  SEV_LABEL[getSeverity(ev)],
                  fmtDateTime(r.createdon),
                  r.createdon ? new Date(r.createdon).toISOString() : '',
                  ENTITY_LABEL[et] ?? '',
                  EVENT_LABEL[ev] ?? '',
                  r.cgmp_entityname ?? '',
                  r.cgmp_entityid ?? '',
                  r.cgmp_useremail ?? r.cgmp_username ?? '',
                  r.cgmp_ipaddress ?? '',
                  r.cgmp_sessionid ?? '',
                  (r.cgmp_notes ?? '').replace(/,/g, ';'),
                ];
              })
            );
          }} disabled={filtered.length === 0}>
            Compliance Report
          </button>
        </div>
      </div>

      {/* Dashboard */}
      {showDashboard && (
        <div className="audit2-dashboard">
          {/* Stat cards */}
          <div className="audit2-stat-cards">
            <div className="audit2-stat-card">
              <div className="audit2-stat-card__val">{dashStats.total.toLocaleString()}</div>
              <div className="audit2-stat-card__lbl">Total Records</div>
            </div>
            <div className="audit2-stat-card audit2-stat-card--info">
              <div className="audit2-stat-card__val">{dashStats.today.toLocaleString()}</div>
              <div className="audit2-stat-card__lbl">Today</div>
            </div>
            <div className="audit2-stat-card audit2-stat-card--danger">
              <div className="audit2-stat-card__val">{dashStats.critical.toLocaleString()}</div>
              <div className="audit2-stat-card__lbl">Critical Events</div>
            </div>
            <div className="audit2-stat-card audit2-stat-card--warning">
              <div className="audit2-stat-card__val">{dashStats.warnings.toLocaleString()}</div>
              <div className="audit2-stat-card__lbl">Warnings</div>
            </div>
            <div className="audit2-stat-card audit2-stat-card--anomaly">
              <div className="audit2-stat-card__val">{dashStats.anomalies.toLocaleString()}</div>
              <div className="audit2-stat-card__lbl">Anomalies</div>
            </div>
            <div className="audit2-stat-card">
              <div className="audit2-stat-card__val">{dashStats.uniqueUsers.toLocaleString()}</div>
              <div className="audit2-stat-card__lbl">Unique Users</div>
            </div>
          </div>

          {/* Chart + top users */}
          <div className="audit2-dashboard-row">
            <div className="audit2-chart-card">
              <div className="audit2-chart-title">7-Day Activity</div>
              <ActivityChart logs={logs} />
            </div>
            <div className="audit2-top-users-card">
              <div className="audit2-chart-title">Top Active Users</div>
              <table className="audit2-top-users-table">
                <thead><tr><th>User</th><th>Events</th></tr></thead>
                <tbody>
                  {dashStats.topUsers.map(([user, count]) => (
                    <tr key={user}>
                      <td className="audit2-top-user-name">{user}</td>
                      <td>
                        <div className="audit2-top-user-bar-wrap">
                          <div className="audit2-top-user-bar" style={{ width: `${Math.round(count / Math.max(1, dashStats.topUsers[0]?.[1] ?? 1) * 100)}%` }} />
                          <span className="audit2-top-user-count">{count}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {dashStats.topUsers.length === 0 && <tr><td colSpan={2} style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>No data</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="audit2-quick-stats-card">
              <div className="audit2-chart-title">Quick Stats</div>
              <div className="audit2-quick-stat">
                <span>Failed Operations</span>
                <span className="audit2-quick-stat__val audit2-quick-stat__val--danger">{dashStats.failed}</span>
              </div>
              <div className="audit2-quick-stat">
                <span>Security Events</span>
                <span className="audit2-quick-stat__val audit2-quick-stat__val--critical">{dashStats.critical}</span>
              </div>
              <div className="audit2-quick-stat">
                <span>Flagged Anomalies</span>
                <span className="audit2-quick-stat__val audit2-quick-stat__val--warning">{dashStats.anomalies}</span>
              </div>
              <div className="audit2-quick-stat">
                <span>Active Users (today)</span>
                <span className="audit2-quick-stat__val">{new Set(logs.filter(l => l.createdon && (Date.now() - new Date(l.createdon).getTime()) < 86400000).map(l => l.cgmp_username).filter(Boolean)).size}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Saved views */}
      {savedViews.length > 0 && (
        <div className="audit2-saved-views">
          <span className="audit2-saved-views__lbl">Saved Views:</span>
          {savedViews.map(v => (
            <span key={v.name} className="audit2-saved-view-chip">
              <button className="audit2-saved-view-apply" onClick={() => applyView(v)}>{v.name}</button>
              <button className="audit2-saved-view-del" onClick={() => deleteView(v.name)} title="Delete view">×</button>
            </span>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div className="filter-bar audit2-filter-bar" style={{ flexWrap: 'wrap' }}>
        <input className="filter-bar__search" placeholder="Search by entity, user, email, session…" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-bar__select" value={entityFilter} onChange={e => setEntityFilter(e.target.value)}>
          <option value="">All Entity Types</option>
          {Object.entries(ENTITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="filter-bar__select" value={eventFilter} onChange={e => setEventFilter(e.target.value)}>
          <option value="">All Events</option>
          {Object.entries(EVENT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="filter-bar__select" value={severityFilter} onChange={e => setSeverityFilter(e.target.value as Severity | '')}>
          <option value="">All Severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="success">Success</option>
          <option value="info">Info</option>
        </select>
        <input type="date" className="filter-bar__date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="From date" />
        <input type="date" className="filter-bar__date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="To date" />
        {hasActiveFilters && (
          <button className="btn btn--ghost btn--sm" onClick={() => { setEntityFilter(''); setEventFilter(''); setSeverityFilter(''); setSearch(''); setDateFrom(''); setDateTo(''); }}>
            Clear
          </button>
        )}
        <span className="filter-bar__count">{filtered.length} records</span>
        <div style={{ marginLeft: 'auto' }}>
          {showSaveView ? (
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input className="form-input form-input--sm" placeholder="View name" value={newViewName} onChange={e => setNewViewName(e.target.value)} style={{ width: 140 }} />
              <button className="btn btn--primary btn--sm" onClick={saveCurrentView}>Save</button>
              <button className="btn btn--ghost btn--sm" onClick={() => setShowSaveView(false)}>Cancel</button>
            </span>
          ) : (
            <button className="btn btn--outline btn--sm" onClick={() => setShowSaveView(true)}>Save View</button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="module-table-wrap">
        {loading ? (
          <div className="module-loading">Loading audit logs…</div>
        ) : filtered.length === 0 ? (
          <div className="module-empty">No audit log entries found.</div>
        ) : (
          <>
            <table className="ism-table audit-table audit2-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Severity</th>
                  <th>Entity</th>
                  <th>Event</th>
                  <th>Entity Name</th>
                  <th>User</th>
                  <th>
                    <span
                      title="This is the browser's user-agent string, not an actual IP address"
                      style={{ cursor: 'help', borderBottom: '1px dotted currentColor' }}
                    >
                      Browser/Client Info
                    </span>
                  </th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {displayedLogs.map((l, i) => {
                  const et = l.cgmp_entitytype as unknown as number;
                  const ev = l.cgmp_eventtype as unknown as number;
                  const isExpanded = expandedId === l.cgmp_auditlogid;
                  const sev = getSeverity(ev);
                  const isNavigable = [100000000, 100000001, 100000002].includes(et) && !!l.cgmp_entityname;
                  const isAnomaly = !!(l.cgmp_auditlogid && anomalousIds.has(l.cgmp_auditlogid));
                  const sessionRelated = relatedBySession(l.cgmp_sessionid, l.cgmp_auditlogid);
                  const entityRelated = relatedByEntity(l.cgmp_entityid, l.cgmp_auditlogid);
                  return (
                    <React.Fragment key={l.cgmp_auditlogid ?? i}>
                      <tr
                        className={`audit-row${isAnomaly ? ' audit-row--anomaly' : ''}${isExpanded ? ' audit-row--expanded' : ''}`}
                        onClick={() => setExpandedId(isExpanded ? null : (l.cgmp_auditlogid ?? null))}
                      >
                        <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                          <div>{fmtDateShort(l.createdon)}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{timeAgo(l.createdon)}</div>
                        </td>
                        <td>
                          <span className={`audit-sev-badge ${SEV_CLASS[sev]}`} style={{ borderLeft: `3px solid ${SEV_COLOR[sev]}` }}>
                            {SEV_LABEL[sev]}
                          </span>
                        </td>
                        <td>
                          <span className={`badge badge--status ${ENTITY_CLASS[et] ?? 'status-draft'}`} style={{ fontSize: 10 }}>
                            {ENTITY_LABEL[et] ?? 'Unknown'}
                          </span>
                        </td>
                        <td style={{ fontSize: 12 }}>{EVENT_LABEL[ev] ?? 'Unknown'}</td>
                        <td style={{ fontSize: 12 }}>
                          {isNavigable ? (
                            <button className="audit-entity-link" onClick={e => { e.stopPropagation(); navigateToEntity(et, l.cgmp_entityname ?? ''); }} title={`Open ${l.cgmp_entityname}`}>
                              {l.cgmp_entityname}
                            </button>
                          ) : (l.cgmp_entityname || '—')}
                        </td>
                        <td style={{ fontSize: 12 }}>
                          <div>{l.cgmp_username || '—'}</div>
                          {l.cgmp_useremail && <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{l.cgmp_useremail}</div>}
                          {isAnomaly && <span title="Anomaly: high-volume, role change, or bulk op" style={{ marginLeft: 4, color: '#d97706', fontSize: 13 }}>⚠</span>}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--text-tertiary)' }} title="This is the browser's user-agent string, not an actual IP address">{l.cgmp_ipaddress || '—'}</td>
                        <td><span className="audit-expand-icon">{isExpanded ? '▲' : '▼'}</span></td>
                      </tr>
                      {isExpanded && (
                        <tr className="audit-detail-row">
                          <td colSpan={8}>
                            <div className="audit2-detail-grid">
                              {/* Metadata */}
                              <div className="audit2-detail-section">
                                <div className="audit2-detail-section__title">Event Metadata</div>
                                <div className="audit2-meta-grid">
                                  {l.cgmp_auditlogid && (
                                    <div className="audit2-meta-row">
                                      <span className="audit2-meta-key">Event ID</span>
                                      <span className="audit2-meta-val">
                                        <code className="audit2-mono">{l.cgmp_auditlogid}</code>
                                        <CopyButton value={l.cgmp_auditlogid} />
                                      </span>
                                    </div>
                                  )}
                                  <div className="audit2-meta-row">
                                    <span className="audit2-meta-key">Timestamp (local)</span>
                                    <span className="audit2-meta-val">{fmtDateTime(l.createdon)}</span>
                                  </div>
                                  <div className="audit2-meta-row">
                                    <span className="audit2-meta-key">Timestamp (UTC)</span>
                                    <span className="audit2-meta-val">{fmtUTC(l.createdon)}</span>
                                  </div>
                                  {l.cgmp_useremail && (
                                    <div className="audit2-meta-row">
                                      <span className="audit2-meta-key">User Email</span>
                                      <span className="audit2-meta-val">
                                        {l.cgmp_useremail}
                                        <CopyButton value={l.cgmp_useremail} />
                                      </span>
                                    </div>
                                  )}
                                  {l.cgmp_sessionid && (
                                    <div className="audit2-meta-row">
                                      <span className="audit2-meta-key">Session ID</span>
                                      <span className="audit2-meta-val">
                                        <code className="audit2-mono">{l.cgmp_sessionid}</code>
                                        <CopyButton value={l.cgmp_sessionid} />
                                      </span>
                                    </div>
                                  )}
                                  {l.cgmp_entityid && (
                                    <div className="audit2-meta-row">
                                      <span className="audit2-meta-key">Entity ID</span>
                                      <span className="audit2-meta-val">
                                        <code className="audit2-mono">{l.cgmp_entityid}</code>
                                        <CopyButton value={l.cgmp_entityid} />
                                      </span>
                                    </div>
                                  )}
                                  {l.cgmp_ipaddress && (
                                    <div className="audit2-meta-row">
                                      <span className="audit2-meta-key" title="This is the browser's user-agent string, not an actual IP address">Browser/Client Info</span>
                                      <span className="audit2-meta-val">{l.cgmp_ipaddress}</span>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Diff */}
                              {(l.cgmp_previousvalues || l.cgmp_newvalues) && (
                                <div className="audit2-detail-section">
                                  <div className="audit2-detail-section__title" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    Field Changes
                                    <button className="audit-toggle-raw" onClick={() => toggleRaw(l.cgmp_auditlogid ?? '')}>
                                      {showRawIds.has(l.cgmp_auditlogid ?? '') ? 'Show Diff' : 'Show Raw JSON'}
                                    </button>
                                  </div>
                                  {showRawIds.has(l.cgmp_auditlogid ?? '') ? (
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                      {l.cgmp_previousvalues && (
                                        <div className="audit-diff-col">
                                          <div className="audit-diff-label">Previous</div>
                                          <pre className="audit-json audit-json--prev">{formatJSON(l.cgmp_previousvalues)}</pre>
                                        </div>
                                      )}
                                      {l.cgmp_newvalues && (
                                        <div className="audit-diff-col">
                                          <div className="audit-diff-label">New</div>
                                          <pre className="audit-json audit-json--new">{formatJSON(l.cgmp_newvalues)}</pre>
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <StructuredDiff prev={l.cgmp_previousvalues} next={l.cgmp_newvalues} />
                                  )}
                                </div>
                              )}

                              {/* Notes */}
                              {l.cgmp_notes && (
                                <div className="audit2-detail-section">
                                  <div className="audit2-detail-section__title">Notes</div>
                                  <p className="audit-notes">{l.cgmp_notes}</p>
                                </div>
                              )}

                              {/* Session timeline */}
                              {sessionRelated.length > 0 && (
                                <div className="audit2-detail-section">
                                  <div className="audit2-detail-section__title">Session Activity ({sessionRelated.length + 1} events)</div>
                                  <div className="audit2-timeline">
                                    {/* Current event */}
                                    <div className="audit2-timeline-item audit2-timeline-item--current">
                                      <div className="audit2-timeline-dot" style={{ background: SEV_COLOR[getSeverity(ev)] }} />
                                      <div className="audit2-timeline-body">
                                        <span className="audit2-timeline-event">{EVENT_LABEL[ev] ?? 'Event'}</span>
                                        <span className="audit2-timeline-time">{fmtDateShort(l.createdon)} · (this event)</span>
                                      </div>
                                    </div>
                                    {sessionRelated.map(r => {
                                      const rev = r.cgmp_eventtype as unknown as number;
                                      return (
                                        <div key={r.cgmp_auditlogid} className="audit2-timeline-item">
                                          <div className="audit2-timeline-dot" style={{ background: SEV_COLOR[getSeverity(rev)] }} />
                                          <div className="audit2-timeline-body">
                                            <span className="audit2-timeline-event">{EVENT_LABEL[rev] ?? 'Event'}</span>
                                            <span className="audit2-timeline-time">{fmtDateShort(r.createdon)}</span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* Related entity events */}
                              {entityRelated.length > 0 && (
                                <div className="audit2-detail-section">
                                  <div className="audit2-detail-section__title">Related Events for "{l.cgmp_entityname}"</div>
                                  <div className="audit2-timeline">
                                    {entityRelated.map(r => {
                                      const rev = r.cgmp_eventtype as unknown as number;
                                      return (
                                        <div key={r.cgmp_auditlogid} className="audit2-timeline-item">
                                          <div className="audit2-timeline-dot" style={{ background: SEV_COLOR[getSeverity(rev)] }} />
                                          <div className="audit2-timeline-body">
                                            <span className="audit2-timeline-event">{EVENT_LABEL[rev] ?? 'Event'}</span>
                                            <span className="audit2-timeline-time">{fmtDateShort(r.createdon)} · {r.cgmp_username || 'System'}</span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>

            {/* Load More — display count (client-side) */}
            {displayCount < filtered.length && (
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <button className="btn btn--outline btn--sm" onClick={() => setDisplayCount(n => n + PAGE_SIZE)}>
                  Load more ({filtered.length - displayCount} remaining)
                </button>
              </div>
            )}

            {/* Load More — server-side (fetch next batch from Dataverse) */}
            {hasMore && (
              <div style={{ padding: '12px 16px', background: 'var(--surface-alt)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Showing {logs.length} records — more records exist in the audit log.
                </span>
                <button className="btn btn--sm btn--outline" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
