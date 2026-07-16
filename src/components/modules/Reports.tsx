import { useMemo, useState } from 'react';
import { useChangeList, useProjects, useAllBridges, BRIDGE_STATUS } from '../../hooks/useDataverse';
import { STATUS, statusLabel, statusColor, riskLabel } from '../../hooks/useDataverse';
import { CATEGORY_OPTIONS } from '../pmo/options';
import { exportCSV } from '../../utils/csv';
import { parseChangeUATData } from '../giicc/GIICCCommandCenter';
import { useApp } from '../../context/AppContext';
import { ROLES } from '../../utils/roles';
import { isValidPowerBIUrl } from '../../utils/powerbi';
import { fmtDateTime, getDisplayTimezone } from '../../utils/format';
import { BarChart as RBarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const CAT_LABEL: Record<number, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((o) => [parseInt(o.value), o.label])
) as Record<number, string>;

const REGION_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
];

type DatePreset = '7d' | '30d' | '90d' | 'ytd' | 'all' | 'custom';

interface DateRange {
  from: Date | null;
  to: Date | null;
}

function getPresetRange(preset: DatePreset, customFrom: string, customTo: string): DateRange {
  const now = new Date();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  switch (preset) {
    case '7d': {
      const from = new Date(todayEnd);
      from.setDate(from.getDate() - 6);
      from.setHours(0, 0, 0, 0);
      return { from, to: todayEnd };
    }
    case '30d': {
      const from = new Date(todayEnd);
      from.setDate(from.getDate() - 29);
      from.setHours(0, 0, 0, 0);
      return { from, to: todayEnd };
    }
    case '90d': {
      const from = new Date(todayEnd);
      from.setDate(from.getDate() - 89);
      from.setHours(0, 0, 0, 0);
      return { from, to: todayEnd };
    }
    case 'ytd': {
      const from = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      return { from, to: todayEnd };
    }
    case 'custom': {
      return {
        from: customFrom ? new Date(customFrom + 'T00:00:00') : null,
        to: customTo ? new Date(customTo + 'T23:59:59') : null,
      };
    }
    default:
      return { from: null, to: null };
  }
}

function BarChart({
  data,
  color = '#0078D4',
  ariaLabel,
}: {
  data: { label: string; value: number }[];
  maxVal: number;
  color?: string;
  ariaLabel?: string;
}) {
  return (
    <div role="figure" aria-label={ariaLabel ?? 'Bar chart'}>
      <ResponsiveContainer width="100%" height={240}>
        <RBarChart data={data} margin={{ top: 8, right: 8, bottom: 32, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            contentStyle={{ background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: 6 }}
          />
          <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
        </RBarChart>
      </ResponsiveContainer>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="report-stat">
      <span className="report-stat__value" style={{ color }}>
        {value}
      </span>
      <span className="report-stat__label">{label}</span>
      {sub && <span className="report-stat__sub">{sub}</span>}
    </div>
  );
}

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: '7d', label: 'Last 7 Days' },
  { key: '30d', label: 'Last 30 Days' },
  { key: '90d', label: 'Last 90 Days' },
  { key: 'ytd', label: 'Year to Date' },
  { key: 'all', label: 'All Time' },
  { key: 'custom', label: 'Custom' },
];

export default function Reports() {
  const { userProfile, isAdmin } = useApp();
  const isPMO = Number(userProfile?.cgmp_role) === ROLES.PMO;
  const isISM = Number(userProfile?.cgmp_role) === ROLES.ISM;
  const { changes, loading } = useChangeList();
  const { projects } = useProjects();
  const { bridges } = useAllBridges(0);
  const [preset, setPreset] = useState<DatePreset>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const range = useMemo(() => getPresetRange(preset, customFrom, customTo), [preset, customFrom, customTo]);
  const [showPrevPeriod, setShowPrevPeriod] = useState(false);
  const [drillStatus, setDrillStatus] = useState<number | null>(null);
  const [reportTab, setReportTab] = useState<'overview' | 'rollback' | 'itops' | 'bridge'>('overview');
  // G2-25: Category filter and saved views
  const [categoryFilter, setCategoryFilter] = useState('');
  const [savedViews, setSavedViews] = useState<Array<{ name: string; config: object }>>(() => {
    try {
      return JSON.parse(localStorage.getItem('cgmp-report-views') ?? '[]');
    } catch {
      return [];
    }
  });

  /* Previous period window (same duration, shifted back) (#68) */
  const prevRange = useMemo((): DateRange => {
    if (!range.from || !range.to) return { from: null, to: null };
    const len = range.to.getTime() - range.from.getTime();
    return { from: new Date(range.from.getTime() - len), to: new Date(range.from.getTime() - 1) };
  }, [range]);

  const filtered = useMemo(() => {
    if (!range.from && !range.to) return changes;
    return changes.filter((c) => {
      if (!c.createdon) return false;
      const d = new Date(c.createdon);
      if (range.from && d < range.from) return false;
      if (range.to && d > range.to) return false;
      return true;
    });
  }, [changes, range]);

  const prevFiltered = useMemo(() => {
    if (!showPrevPeriod || !prevRange.from || !prevRange.to) return [];
    return changes.filter((c) => {
      if (!c.createdon) return false;
      const d = new Date(c.createdon);
      return d >= prevRange.from! && d <= prevRange.to!;
    });
  }, [changes, showPrevPeriod, prevRange]);

  // G2-25: Category-filtered view for overview tab (category filter applies on top of date range)
  const overviewFiltered = useMemo(() => {
    if (!categoryFilter) return filtered;
    return filtered.filter((c) => String(c.cgmp_category as unknown as number) === categoryFilter);
  }, [filtered, categoryFilter]);

  /* KPIs */
  const total = overviewFiltered.length;
  const completed = overviewFiltered.filter((c) => (c.cgmp_status as unknown as number) === STATUS.Completed).length;
  const failed = overviewFiltered.filter((c) => (c.cgmp_status as unknown as number) === STATUS.Failed).length;
  const inProgress = overviewFiltered.filter((c) => (c.cgmp_status as unknown as number) === STATUS.InProgress).length;
  const sla = completed + failed > 0 ? Math.round((completed / (completed + failed)) * 1000) / 10 : 100;

  /* Prev period KPIs for delta display (#68) */
  const prevTotal = prevFiltered.length;
  const prevCompleted = prevFiltered.filter((c) => (c.cgmp_status as unknown as number) === STATUS.Completed).length;
  const prevFailed = prevFiltered.filter((c) => (c.cgmp_status as unknown as number) === STATUS.Failed).length;
  const prevSla =
    prevCompleted + prevFailed > 0 ? Math.round((prevCompleted / (prevCompleted + prevFailed)) * 1000) / 10 : 100;

  /* MTTR (approx): avg hours from execution start to when failure was recorded (modifiedon).
   * True MTTR would require audit log transition timestamps; modifiedon is the best proxy here. */
  const mttr = useMemo(() => {
    const failedChanges = filtered.filter(
      (c) => (c.cgmp_status as unknown as number) === STATUS.Failed && c.cgmp_starttime && c.modifiedon
    );
    if (!failedChanges.length) return null;
    const avgHrs =
      failedChanges.reduce((sum, c) => {
        const hrs = (new Date(c.modifiedon!).getTime() - new Date(c.cgmp_starttime!).getTime()) / 3600000;
        return sum + Math.max(0, hrs);
      }, 0) / failedChanges.length;
    return Math.round(avgHrs * 10) / 10;
  }, [filtered]);

  const avgDuration = useMemo(() => {
    const withBoth = filtered.filter((c) => c.cgmp_starttime && ((c as any).cgmp_actualendtime || c.cgmp_endtime));
    if (withBoth.length === 0) return 0;
    const totalHrs = withBoth.reduce((sum, c) => {
      const end = (c as any).cgmp_actualendtime ?? c.cgmp_endtime;
      const diff = new Date(end).getTime() - new Date(c.cgmp_starttime!).getTime();
      return sum + diff / 3600000;
    }, 0);
    return Math.round((totalHrs / withBoth.length) * 10) / 10;
  }, [filtered]);

  /* #74 Scheduled vs Actual Duration — avg overrun in hours across completed bridges */
  const avgOverrunHours = useMemo(() => {
    const completed = bridges.filter(
      (b) =>
        (b.cgmp_status as unknown as number) === BRIDGE_STATUS.Completed &&
        b.cgmp_actualstart &&
        b.cgmp_actualend &&
        b.cgmp_schedstart &&
        b.cgmp_schedend
    );
    if (completed.length === 0) return null;
    const total = completed.reduce((sum, b) => {
      const planned = (new Date(b.cgmp_schedend!).getTime() - new Date(b.cgmp_schedstart!).getTime()) / 3600000;
      const actual = (new Date(b.cgmp_actualend!).getTime() - new Date(b.cgmp_actualstart!).getTime()) / 3600000;
      return sum + (actual - planned);
    }, 0);
    return Math.round((total / completed.length) * 10) / 10;
  }, [bridges]);

  const avgApprovalDays = useMemo(() => {
    const withReview = filtered.filter((c) => c.cgmp_reviewedat && c.createdon);
    if (withReview.length === 0) return null;
    const totalDays = withReview.reduce((sum, c) => {
      const diff = new Date(c.cgmp_reviewedat!).getTime() - new Date(c.createdon!).getTime();
      return sum + diff / 86400000;
    }, 0);
    return Math.round((totalDays / withReview.length) * 10) / 10;
  }, [filtered]);

  /* By status */
  const byStatus = useMemo(() => {
    const map: Record<number, number> = {};
    overviewFiltered.forEach((c) => {
      const s = c.cgmp_status as unknown as number;
      map[s] = (map[s] ?? 0) + 1;
    });
    return Object.entries(map)
      .map(([k, v]) => ({ label: statusLabel(parseInt(k)), value: v, code: parseInt(k) }))
      .sort((a, b) => b.value - a.value);
  }, [overviewFiltered]);

  /* By risk */
  const byRisk = useMemo(() => {
    const map: Record<number, number> = {};
    overviewFiltered.forEach((c) => {
      const r = c.cgmp_risklevel as unknown as number;
      if (r != null) map[r] = (map[r] ?? 0) + 1;
    });
    return Object.entries(map)
      .map(([k, v]) => ({ label: riskLabel(parseInt(k)), value: v, idx: parseInt(k) }))
      .sort((a, b) => a.idx - b.idx);
  }, [overviewFiltered]);

  /* By category */
  const byCategory = useMemo(() => {
    const map: Record<number, number> = {};
    overviewFiltered.forEach((c) => {
      const cat = c.cgmp_category as unknown as number;
      if (cat != null) map[cat] = (map[cat] ?? 0) + 1;
    });
    return Object.entries(map)
      .map(([k, v]) => ({ label: CAT_LABEL[parseInt(k)] ?? `Cat ${k}`, value: v }))
      .sort((a, b) => b.value - a.value);
  }, [overviewFiltered]);

  /* Rollback rate by category */
  const rollbackByCategory = useMemo(() => {
    const catTotal: Record<string, number> = {};
    const catRollback: Record<string, number> = {};
    filtered.forEach((c) => {
      const cat = c.cgmp_category as unknown as number;
      const label = CAT_LABEL[cat] ?? `Cat ${cat ?? '—'}`;
      catTotal[label] = (catTotal[label] ?? 0) + 1;
      if ((c as any).cgmp_uatrequired) {
        const uatData = parseChangeUATData(c.cgmp_uatusers);
        const hasRollback = Object.values(uatData).some((e) => e.postStatus === 'Rollback');
        if (hasRollback) catRollback[label] = (catRollback[label] ?? 0) + 1;
      }
    });
    return Object.entries(catTotal)
      .map(([label, total]) => ({
        label,
        total,
        rollback: catRollback[label] ?? 0,
        rate: Math.round(((catRollback[label] ?? 0) / total) * 100),
      }))
      .sort((a, b) => b.rate - a.rate);
  }, [filtered]);

  /* ISM performance */
  const ismPerformance = useMemo(() => {
    const map: Record<string, { total: number; completed: number; failed: number; uatContacts: number }> = {};
    filtered.forEach((c) => {
      const projIds = (c.cgmp_projectids ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const isms = new Set<string>();
      projIds.forEach((pid) => {
        const proj = projects.find((p) => p.cgmp_projectid === pid);
        if (proj?.cgmp_primaryism) isms.add(proj.cgmp_primaryism);
      });
      if (isms.size === 0) isms.add('Unassigned');
      const s = c.cgmp_status as unknown as number;
      const uatData = parseChangeUATData(c.cgmp_uatusers);
      const totalContacts = Object.values(uatData).reduce((n, e) => n + (e.contacts?.length ?? 0), 0);
      isms.forEach((ism) => {
        const row = map[ism] ?? { total: 0, completed: 0, failed: 0, uatContacts: 0 };
        row.total++;
        if (s === STATUS.Completed) row.completed++;
        if (s === STATUS.Failed) row.failed++;
        row.uatContacts += totalContacts;
        map[ism] = row;
      });
    });
    return Object.entries(map)
      .map(([ism, d]) => {
        const tot = d.completed + d.failed;
        return {
          ism,
          total: d.total,
          completed: d.completed,
          failed: d.failed,
          sla: tot > 0 ? Math.round((d.completed / tot) * 1000) / 10 : 100,
          avgUatContacts: d.total > 0 ? Math.round((d.uatContacts / d.total) * 10) / 10 : 0,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [filtered, projects]);

  /* By region */
  const byRegion = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((c) => {
      const r = c.cgmp_region ?? 'Unknown';
      map[r] = (map[r] ?? 0) + 1;
    });
    return Object.entries(map)
      .sort(([, a], [, b]) => b - a)
      .map(([label, value]) => ({ label, value }));
  }, [filtered]);

  /* Trend: adapt bucket size to date range */
  const trendData = useMemo(() => {
    const now = new Date();
    const days =
      preset === '90d'
        ? 90
        : preset === 'ytd'
          ? Math.ceil((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000)
          : preset === '30d'
            ? 30
            : preset === '7d'
              ? 7
              : preset === 'custom' && customFrom && customTo
                ? Math.max(1, Math.ceil((new Date(customTo).getTime() - new Date(customFrom).getTime()) / 86400000))
                : 30;
    const buckets =
      preset === '90d' || preset === 'ytd' || (preset === 'custom' && days > 30) ? 12 : preset === '30d' ? 10 : 7;
    const bucketDays = Math.max(1, Math.ceil(days / buckets));

    return Array.from({ length: Math.min(buckets, days) }, (_, i) => {
      const bucketEnd = new Date(now);
      bucketEnd.setDate(bucketEnd.getDate() - i * bucketDays);
      bucketEnd.setHours(23, 59, 59, 999);
      const bucketStart = new Date(bucketEnd);
      bucketStart.setDate(bucketStart.getDate() - (bucketDays - 1));
      bucketStart.setHours(0, 0, 0, 0);

      const label =
        bucketDays <= 1
          ? bucketStart.toLocaleDateString('en-US', { weekday: 'short', timeZone: getDisplayTimezone() })
          : bucketStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: getDisplayTimezone() });

      const bucket = filtered.filter((c) => {
        if (!c.createdon) return false;
        const d = new Date(c.createdon);
        return d >= bucketStart && d <= bucketEnd;
      });

      return {
        label,
        value: bucket.length,
        completed: bucket.filter((c) => (c.cgmp_status as unknown as number) === STATUS.Completed).length,
        failed: bucket.filter((c) => (c.cgmp_status as unknown as number) === STATUS.Failed).length,
      };
    }).reverse();
  }, [filtered, preset, customFrom, customTo]);

  /* SLA by region */
  const slaByRegion = useMemo(() => {
    const regions = [...new Set(filtered.map((c) => c.cgmp_region).filter(Boolean) as string[])];
    return regions
      .map((region) => {
        const rc = filtered.filter((c) => c.cgmp_region === region);
        const comp = rc.filter((c) => (c.cgmp_status as unknown as number) === STATUS.Completed).length;
        const fail = rc.filter((c) => (c.cgmp_status as unknown as number) === STATUS.Failed).length;
        const tot = comp + fail;
        return { region, total: rc.length, comp, fail, sla: tot > 0 ? Math.round((comp / tot) * 1000) / 10 : 100 };
      })
      .sort((a, b) => b.total - a.total);
  }, [filtered]);

  const maxTrend = Math.max(...trendData.map((d) => d.value), 1);
  const maxStatus = Math.max(...byStatus.map((d) => d.value), 1);
  const maxCat = Math.max(...byCategory.map((d) => d.value), 1);

  /* ── G2-9: Rollback Analysis (uses cgmp_rollbackinitiated field) ───────── */
  const rollbackChanges = useMemo(() => changes.filter((c) => (c as any).cgmp_rollbackinitiated === true), [changes]);
  const totalClosed = useMemo(
    () => changes.filter((c) => (c.cgmp_status as unknown as number) === 100000007).length,
    [changes]
  );
  const rollbackRate = totalClosed > 0 ? ((rollbackChanges.length / totalClosed) * 100).toFixed(1) : '0.0';
  const rollbackByCat = useMemo(() => {
    const map: Record<string, number> = {};
    rollbackChanges.forEach((c) => {
      const cat = c.cgmp_category as unknown as number;
      const label = CAT_LABEL[cat] ?? `Cat ${cat ?? '—'}`;
      map[label] = (map[label] ?? 0) + 1;
    });
    return Object.entries(map)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [rollbackChanges]);
  const rollbackByLoc = useMemo(() => {
    const map: Record<string, number> = {};
    rollbackChanges.forEach((c) => {
      const loc = c.cgmp_location ?? c.cgmp_region ?? 'Unknown';
      map[loc] = (map[loc] ?? 0) + 1;
    });
    return Object.entries(map)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [rollbackChanges]);
  const rollbackTrend = useMemo(() => {
    const now = Date.now();
    const msPerDay = 86400000;
    const last30 = rollbackChanges.filter(
      (c) => c.createdon && now - new Date(c.createdon).getTime() <= 30 * msPerDay
    ).length;
    const prev30 = rollbackChanges.filter((c) => {
      if (!c.createdon) return false;
      const age = now - new Date(c.createdon).getTime();
      return age > 30 * msPerDay && age <= 60 * msPerDay;
    }).length;
    return { last30, prev30 };
  }, [rollbackChanges]);

  /* ── G2-10: IT Ops Performance ──────────────────────────────────────── */
  const itOpsWorkload = useMemo(() => {
    const map: Record<string, number> = {};
    changes.forEach((c) => {
      const reviewer = (c as any).cgmp_reviewedby as string | undefined;
      if (reviewer) map[reviewer] = (map[reviewer] ?? 0) + 1;
    });
    return Object.entries(map)
      .map(([user, count]) => ({ user, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }, [changes]);
  const avgItOpsReviewHours = useMemo(() => {
    const reviewed = changes.filter((c) => c.cgmp_reviewedat && c.createdon);
    if (!reviewed.length) return null;
    const avg =
      reviewed.reduce((sum, c) => {
        return sum + (new Date(c.cgmp_reviewedat!).getTime() - new Date(c.createdon!).getTime()) / 3600000;
      }, 0) / reviewed.length;
    return Math.round(avg * 10) / 10;
  }, [changes]);
  const itOpsSlaByLoc = useMemo(() => {
    const locMap: Record<string, { total: number; reviewed: number }> = {};
    changes.forEach((c) => {
      const loc = c.cgmp_location ?? c.cgmp_region ?? 'Unknown';
      const row = locMap[loc] ?? { total: 0, reviewed: 0 };
      row.total++;
      if (c.cgmp_reviewedat) row.reviewed++;
      locMap[loc] = row;
    });
    return Object.entries(locMap)
      .map(([loc, d]) => ({
        loc,
        total: d.total,
        reviewed: d.reviewed,
        pct: d.total > 0 ? Math.round((d.reviewed / d.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [changes]);

  /* ── G2-10: Bridge Execution (GIICC) ────────────────────────────────── */
  const bridgeSuccessData = useMemo(() => {
    const completedBridges = bridges.filter((b) => (b.cgmp_status as unknown as number) === BRIDGE_STATUS.Completed);
    if (!completedBridges.length) return null;
    const successCount = completedBridges.filter((b) => !(b as any).cgmp_rollbackinitiated).length;
    return {
      total: completedBridges.length,
      success: successCount,
      rate: Math.round((successCount / completedBridges.length) * 100),
    };
  }, [bridges]);
  const uatFailureAnalysis = useMemo(() => {
    const withUat = changes.filter((c) => (c as any).cgmp_uatrequired && c.cgmp_uatusers);
    const failedUat = withUat.filter((c) => {
      const uatData = parseChangeUATData(c.cgmp_uatusers);
      return Object.values(uatData).some((e) => e.postStatus === 'Rollback' || e.postStatus === 'Failed');
    });
    return {
      submitted: withUat.length,
      returned: failedUat.length,
      rate: withUat.length > 0 ? Math.round((failedUat.length / withUat.length) * 100) : 0,
    };
  }, [changes]);

  const exportSummary = () =>
    exportCSV(
      `sla-compliance-report-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Region', 'Total Changes', 'Completed', 'Failed', 'SLA %'],
      slaByRegion.map((r) => [r.region, String(r.total), String(r.comp), String(r.fail), String(r.sla)])
    );

  const exportAllChanges = () =>
    exportCSV(
      `changes-export-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        'Change Number',
        'Title',
        'Status',
        'Risk',
        'Category',
        'Start Time',
        'End Time',
        'Region',
        'Country',
        'Location',
        'Facility',
        'Owner',
        'Change POC',
        'Emergency',
        'Weekend',
        'Created On',
      ],
      overviewFiltered.map((c) => [
        c.cgmp_changenumber ?? '',
        c.cgmp_title ?? '',
        statusLabel(c.cgmp_status as unknown as number),
        riskLabel(c.cgmp_risklevel as unknown as number),
        CAT_LABEL[c.cgmp_category as unknown as number] ?? '',
        fmtDateTime(c.cgmp_starttime),
        fmtDateTime(c.cgmp_endtime),
        c.cgmp_region ?? '',
        c.cgmp_country ?? '',
        c.cgmp_location ?? '',
        c.cgmp_facility ?? '',
        c.cgmp_createdby ?? '',
        c.cgmp_changepoc ?? '',
        c.cgmp_isemergency ? 'Yes' : 'No',
        c.cgmp_isweekend ? 'Yes' : 'No',
        fmtDateTime(c.createdon),
      ])
    );

  const exportIsmReport = () =>
    exportCSV(
      `ism-performance-report-${new Date().toISOString().slice(0, 10)}.csv`,
      ['ISM', 'Total Changes', 'Completed', 'Failed', 'SLA %', 'Avg UAT Contacts'],
      ismPerformance.map((r) => [
        r.ism,
        String(r.total),
        String(r.completed),
        String(r.failed),
        String(r.sla),
        String(r.avgUatContacts),
      ])
    );

  const powerBIUrl = userProfile?.cgmp_powerbiurl || localStorage.getItem('cgmp-powerbi-url') || '';

  // G2-25: Save and load named report views
  const saveView = () => {
    const name = prompt('Enter view name:');
    if (!name) return;
    const config = { reportTab, preset, customFrom, customTo, categoryFilter };
    const updated = [...savedViews, { name, config }];
    setSavedViews(updated);
    localStorage.setItem('cgmp-report-views', JSON.stringify(updated));
  };

  const loadView = (view: { name: string; config: any }) => {
    if (view.config.reportTab) setReportTab(view.config.reportTab);
    if (view.config.preset) setPreset(view.config.preset);
    if (view.config.customFrom !== undefined) setCustomFrom(view.config.customFrom ?? '');
    if (view.config.customTo !== undefined) setCustomTo(view.config.customTo ?? '');
    if (view.config.categoryFilter !== undefined) setCategoryFilter(view.config.categoryFilter ?? '');
  };

  if (!isAdmin && !isPMO && !isISM)
    return (
      <div className="workspace-placeholder workspace-placeholder--denied" role="alert">
        <span aria-hidden="true" style={{ fontSize: 48 }}>
          🔒
        </span>
        <h2>Access Denied</h2>
        <p>Reports are restricted to Admin, PMO, and ISM roles.</p>
      </div>
    );

  return (
    <div className="module-workspace">
      <div className="module-header">
        <div>
          <h1 className="module-title">Reports</h1>
          <p className="module-subtitle">Operational summaries, resolution success rates, and KPI analytics</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn--outline btn--sm"
            onClick={() => window.print()}
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z" />
            </svg>
            Print
          </button>
          <button className="btn btn--outline btn--sm" onClick={exportSummary} disabled={loading || total === 0}>
            Export SLA Report
          </button>
          <button className="btn btn--secondary btn--sm" onClick={exportAllChanges} disabled={loading || total === 0}>
            Export All Changes ({total})
          </button>
        </div>
      </div>

      {loading ? (
        <div className="module-loading">Loading report data…</div>
      ) : (
        <div className="reports-body">
          <div className="ism-tabs" role="tablist" aria-label="Report views" style={{ marginBottom: 20 }}>
            <button
              role="tab"
              aria-selected={reportTab === 'overview'}
              tabIndex={reportTab === 'overview' ? 0 : -1}
              className={`ism-tab${reportTab === 'overview' ? ' ism-tab--active' : ''}`}
              onClick={() => setReportTab('overview')}
            >
              Overview
            </button>
            <button
              role="tab"
              aria-selected={reportTab === 'rollback'}
              tabIndex={reportTab === 'rollback' ? 0 : -1}
              className={`ism-tab${reportTab === 'rollback' ? ' ism-tab--active' : ''}`}
              onClick={() => setReportTab('rollback')}
            >
              Rollback Analysis
            </button>
            <button
              role="tab"
              aria-selected={reportTab === 'itops'}
              tabIndex={reportTab === 'itops' ? 0 : -1}
              className={`ism-tab${reportTab === 'itops' ? ' ism-tab--active' : ''}`}
              onClick={() => setReportTab('itops')}
            >
              IT Ops Performance
            </button>
            <button
              role="tab"
              aria-selected={reportTab === 'bridge'}
              tabIndex={reportTab === 'bridge' ? 0 : -1}
              className={`ism-tab${reportTab === 'bridge' ? ' ism-tab--active' : ''}`}
              onClick={() => setReportTab('bridge')}
            >
              Bridge Execution
            </button>
          </div>

          {reportTab === 'overview' && (
            <>
              {/* Date range selector */}
              <div className="report-date-bar">
                {PRESETS.map((p) => (
                  <button
                    key={p.key}
                    className={`report-date-btn${preset === p.key ? ' report-date-btn--active' : ''}`}
                    onClick={() => setPreset(p.key)}
                  >
                    {p.label}
                  </button>
                ))}
                {preset === 'custom' && (
                  <div className="report-date-custom">
                    <input
                      type="date"
                      className="report-date-input"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      aria-label="From date"
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>to</span>
                    <input
                      type="date"
                      className="report-date-input"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      aria-label="To date"
                    />
                  </div>
                )}
                {preset !== 'all' && (
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 4 }}>
                    {total} change{total !== 1 ? 's' : ''} in period
                  </span>
                )}
                {preset !== 'all' && (
                  <button
                    className={`report-date-btn${showPrevPeriod ? ' report-date-btn--active' : ''}`}
                    onClick={() => setShowPrevPeriod((p) => !p)}
                    style={{ marginLeft: 'auto' }}
                    title="Show comparison to the previous equivalent period"
                  >
                    vs Prev Period
                  </button>
                )}
                {/* G2-25: Category filter + Save View */}
                <select
                  className="report-date-btn"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  style={{ height: 28, padding: '0 8px', fontSize: 12, cursor: 'pointer' }}
                  aria-label="Filter by category"
                >
                  <option value="">All Categories</option>
                  {CATEGORY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button
                  className="report-date-btn"
                  onClick={saveView}
                  title="Save the current filter configuration as a named view"
                  style={{ whiteSpace: 'nowrap' }}
                >
                  💾 Save View
                </button>
              </div>
              {/* G2-25: Saved views list */}
              {savedViews.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>Saved views:</span>
                  {savedViews.map((view, idx) => (
                    <button
                      key={idx}
                      className="report-date-btn"
                      onClick={() => loadView(view)}
                      title={`Load saved view: ${view.name}`}
                      style={{ fontSize: 11 }}
                    >
                      {view.name}
                    </button>
                  ))}
                </div>
              )}

              {/* KPI row (#68 period-over-period deltas) */}
              <div className="report-kpis">
                <StatCard
                  label="Total Changes"
                  value={total}
                  sub={
                    showPrevPeriod && prevTotal
                      ? `prev: ${prevTotal} (${total - prevTotal >= 0 ? '+' : ''}${total - prevTotal})`
                      : undefined
                  }
                />
                <StatCard
                  label="Completed"
                  value={completed}
                  color={completed > 0 ? 'var(--success)' : undefined}
                  sub={showPrevPeriod && prevCompleted ? `prev: ${prevCompleted}` : undefined}
                />
                <StatCard
                  label="In Progress"
                  value={inProgress}
                  color={inProgress > 0 ? 'var(--primary)' : undefined}
                />
                <StatCard
                  label="Failed"
                  value={failed}
                  color={failed > 0 ? 'var(--danger)' : undefined}
                  sub={showPrevPeriod && prevFailed ? `prev: ${prevFailed}` : undefined}
                />
                <StatCard
                  label="Resolution Success Rate"
                  value={`${sla}%`}
                  color={sla >= 95 ? 'var(--success)' : sla >= 80 ? 'var(--orange)' : 'var(--danger)'}
                  sub={
                    showPrevPeriod
                      ? `prev: ${prevSla}% (${sla - prevSla >= 0 ? '+' : ''}${(sla - prevSla).toFixed(1)}%)`
                      : undefined
                  }
                />
                <StatCard label="Avg Duration (h)" value={avgDuration} sub="per change" />
                {mttr !== null && (
                  <StatCard
                    label="MTTR (h)"
                    value={mttr}
                    sub="start → failure recorded"
                    color={mttr > 24 ? 'var(--danger)' : 'var(--success)'}
                  />
                )}
                {avgOverrunHours !== null && (
                  <StatCard
                    label="Avg Bridge Overrun"
                    value={avgOverrunHours >= 0 ? `+${avgOverrunHours}h` : `${avgOverrunHours}h`}
                    sub="sched vs actual"
                    color={
                      avgOverrunHours > 2 ? 'var(--danger)' : avgOverrunHours > 0 ? 'var(--orange)' : 'var(--success)'
                    }
                  />
                )}
                {avgApprovalDays !== null && (
                  <StatCard
                    label="Avg Approval Time"
                    value={`${avgApprovalDays}d`}
                    sub={`${filtered.filter((c) => c.cgmp_reviewedat).length} reviewed`}
                    color={
                      avgApprovalDays <= 2 ? 'var(--success)' : avgApprovalDays <= 5 ? 'var(--orange)' : 'var(--danger)'
                    }
                  />
                )}
              </div>

              <div className="report-charts-row">
                {/* Trend chart */}
                <div className="report-chart-card">
                  <div className="report-chart-title">
                    {preset === '7d'
                      ? '7-Day'
                      : preset === '30d'
                        ? '30-Day'
                        : preset === '90d'
                          ? '90-Day'
                          : preset === 'ytd'
                            ? 'Year-to-Date'
                            : 'Custom'}{' '}
                    Change Trend
                  </div>
                  {trendData.every((d) => d.value === 0) ? (
                    <div
                      style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}
                    >
                      No changes in this period
                    </div>
                  ) : (
                    <BarChart data={trendData} maxVal={maxTrend} color="#0078D4" ariaLabel="Change trend bar chart" />
                  )}
                </div>

                {/* By status */}
                <div className="report-chart-card">
                  <div className="report-chart-title">By Status</div>
                  {byStatus.length === 0 ? (
                    <div
                      style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}
                    >
                      No data
                    </div>
                  ) : (
                    <div className="report-stat-list">
                      {byStatus.map(({ label, value, code }) => (
                        <div
                          key={code}
                          className="report-stat-row"
                          style={{ cursor: 'pointer' }}
                          onClick={() => setDrillStatus(drillStatus === code ? null : code)}
                          title={`Click to ${drillStatus === code ? 'close' : 'view'} ${label} changes`}
                        >
                          <span
                            className={`badge badge--status ${statusColor(code)}`}
                            style={{
                              fontSize: 10,
                              outline: drillStatus === code ? '2px solid var(--primary)' : undefined,
                            }}
                          >
                            {label}
                          </span>
                          <div className="report-bar-inline">
                            <div
                              className="report-bar-fill"
                              style={{
                                width: `${(value / maxStatus) * 100}%`,
                                background: drillStatus === code ? 'var(--primary)' : undefined,
                              }}
                            />
                          </div>
                          <span className="report-stat-row__val">{value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {drillStatus !== null &&
                    (() => {
                      const drillChanges = filtered.filter((c) => (c.cgmp_status as unknown as number) === drillStatus);
                      return (
                        <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                          <div
                            style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}
                          >
                            {statusLabel(drillStatus)} CHANGES ({drillChanges.length})
                            <button
                              onClick={() => setDrillStatus(null)}
                              style={{
                                float: 'right',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: 12,
                              }}
                            >
                              ✕
                            </button>
                          </div>
                          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                            {drillChanges.slice(0, 20).map((c) => (
                              <div
                                key={c.cgmp_changeid}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  fontSize: 11,
                                  padding: '3px 0',
                                  borderBottom: '1px solid var(--border-subtle)',
                                }}
                              >
                                <span style={{ fontWeight: 600, minWidth: 80 }}>{c.cgmp_changenumber}</span>
                                <span
                                  style={{
                                    flex: 1,
                                    margin: '0 6px',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    color: 'var(--text-secondary)',
                                  }}
                                >
                                  {c.cgmp_title}
                                </span>
                                <span style={{ color: 'var(--text-tertiary)' }}>{c.cgmp_region}</span>
                              </div>
                            ))}
                            {drillChanges.length > 20 && (
                              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '4px 0' }}>
                                ...and {drillChanges.length - 20} more
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                </div>

                {/* By risk */}
                <div className="report-chart-card">
                  <div className="report-chart-title">By Risk Level</div>
                  {byRisk.length === 0 ? (
                    <div
                      style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}
                    >
                      No data
                    </div>
                  ) : (
                    <div className="report-stat-list">
                      {byRisk.map(({ label, value, idx }) => {
                        const maxR = Math.max(...byRisk.map((r) => r.value), 1);
                        const rc = ['risk-low', 'risk-medium', 'risk-high', 'risk-critical'][idx] ?? 'risk-low';
                        const barColor =
                          ['var(--success)', 'var(--orange)', 'var(--danger)', '#8B0000'][idx] ?? 'var(--primary)';
                        return (
                          <div key={label} className="report-stat-row">
                            <span className={`badge badge--risk ${rc}`} style={{ fontSize: 10 }}>
                              {label}
                            </span>
                            <div className="report-bar-inline">
                              <div
                                className="report-bar-fill"
                                style={{ width: `${(value / maxR) * 100}%`, background: barColor }}
                              />
                            </div>
                            <span className="report-stat-row__val">{value}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Category + Region row */}
              <div className="report-charts-row">
                <div className="report-chart-card" style={{ flex: 1 }}>
                  <div className="report-chart-title">By Category</div>
                  {byCategory.length === 0 ? (
                    <div
                      style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}
                    >
                      No data
                    </div>
                  ) : (
                    <BarChart
                      data={byCategory.slice(0, 8)}
                      maxVal={maxCat}
                      color="#8764B8"
                      ariaLabel="Changes by category bar chart"
                    />
                  )}
                </div>

                <div className="report-chart-card" style={{ flex: 1 }}>
                  <div className="report-chart-title">By Region</div>
                  {byRegion.length === 0 ? (
                    <div
                      style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}
                    >
                      No data
                    </div>
                  ) : (
                    <div className="report-stat-list">
                      {byRegion.slice(0, 8).map(({ label, value }, i) => {
                        const maxR = Math.max(...byRegion.map((r) => r.value), 1);
                        return (
                          <div key={label} className="report-stat-row">
                            <span style={{ fontSize: 12, minWidth: 80, color: 'var(--text-secondary)' }}>{label}</span>
                            <div className="report-bar-inline">
                              <div
                                className="report-bar-fill"
                                style={{
                                  width: `${(value / maxR) * 100}%`,
                                  background: REGION_COLORS[i % REGION_COLORS.length],
                                }}
                              />
                            </div>
                            <span className="report-stat-row__val">{value}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* SLA Compliance Table */}
              <div className="report-section">
                <div className="report-section__title">SLA Compliance by Region</div>
                <div className="ism-table-wrap">
                  <table className="ism-table">
                    <thead>
                      <tr>
                        <th>Region</th>
                        <th>Total Changes</th>
                        <th>Completed</th>
                        <th>Failed</th>
                        <th>SLA %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {slaByRegion.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="ism-table__empty">
                            No regional data for this period
                          </td>
                        </tr>
                      ) : (
                        slaByRegion.map((r) => (
                          <tr key={r.region}>
                            <td>{r.region}</td>
                            <td>{r.total}</td>
                            <td style={{ color: r.comp > 0 ? 'var(--success)' : 'var(--text-tertiary)' }}>{r.comp}</td>
                            <td style={{ color: r.fail > 0 ? 'var(--danger)' : 'var(--text-tertiary)' }}>{r.fail}</td>
                            <td>
                              <span
                                className={`sla-badge ${r.sla >= 95 ? 'sla-badge--green' : r.sla >= 80 ? 'sla-badge--orange' : 'sla-badge--red'}`}
                              >
                                {r.sla}%
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Rollback Rate by Category */}
              <div className="report-section">
                <div className="report-section__title">Rollback Rate by Change Category</div>
                <div className="ism-table-wrap">
                  <table className="ism-table">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Total Changes</th>
                        <th>Rollbacks</th>
                        <th>Rollback Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rollbackByCategory.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="ism-table__empty">
                            No data for this period
                          </td>
                        </tr>
                      ) : (
                        rollbackByCategory.map((r) => (
                          <tr key={r.label}>
                            <td>{r.label}</td>
                            <td>{r.total}</td>
                            <td style={{ color: r.rollback > 0 ? 'var(--danger)' : 'var(--text-tertiary)' }}>
                              {r.rollback}
                            </td>
                            <td>
                              <span
                                className={`sla-badge ${r.rate === 0 ? 'sla-badge--green' : r.rate <= 15 ? 'sla-badge--orange' : 'sla-badge--red'}`}
                              >
                                {r.rate}%
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ISM Performance */}
              <div className="report-section">
                <div
                  className="report-section__title"
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <span>ISM Performance</span>
                  <button
                    className="btn btn--outline btn--sm"
                    onClick={exportIsmReport}
                    disabled={ismPerformance.length === 0}
                  >
                    Export ISM Report
                  </button>
                </div>
                <div className="ism-table-wrap">
                  <table className="ism-table">
                    <thead>
                      <tr>
                        <th>ISM</th>
                        <th>Total</th>
                        <th>Completed</th>
                        <th>Failed</th>
                        <th>SLA %</th>
                        <th>Avg UAT Contacts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ismPerformance.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="ism-table__empty">
                            No ISM data for this period
                          </td>
                        </tr>
                      ) : (
                        ismPerformance.map((r) => (
                          <tr key={r.ism}>
                            <td style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{r.ism}</td>
                            <td>{r.total}</td>
                            <td style={{ color: r.completed > 0 ? 'var(--success)' : 'var(--text-tertiary)' }}>
                              {r.completed}
                            </td>
                            <td style={{ color: r.failed > 0 ? 'var(--danger)' : 'var(--text-tertiary)' }}>
                              {r.failed}
                            </td>
                            <td>
                              <span
                                className={`sla-badge ${r.sla >= 95 ? 'sla-badge--green' : r.sla >= 80 ? 'sla-badge--orange' : 'sla-badge--red'}`}
                              >
                                {r.sla}%
                              </span>
                            </td>
                            <td>{r.avgUatContacts}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Power BI */}
              <div className="report-section">
                <div className="report-section__title">Power BI Analytics</div>
                {powerBIUrl && isValidPowerBIUrl(powerBIUrl) ? (
                  <iframe
                    src={powerBIUrl}
                    style={{ width: '100%', height: 600, border: 'none', borderRadius: 'var(--radius-lg)' }}
                    title="Power BI Analytics"
                    allowFullScreen
                  />
                ) : (
                  <div className="powerbi-placeholder">
                    <svg
                      width="48"
                      height="48"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      style={{ color: 'var(--powerbi-yellow, #F2C811)', opacity: 0.5 }}
                    >
                      <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" />
                    </svg>
                    <div className="powerbi-placeholder__text">
                      <strong className="powerbi-placeholder__title">Power BI Workspace</strong>
                      <span className="powerbi-placeholder__msg">
                        Configure a Power BI embed URL in Settings to display live dashboards here
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── G2-9: Rollback Analysis tab ──────────────────────────── */}
          {reportTab === 'rollback' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* KPI cards */}
              <div className="report-kpis">
                <StatCard
                  label="Total Rollbacks"
                  value={rollbackChanges.length}
                  color={rollbackChanges.length > 0 ? 'var(--danger)' : undefined}
                />
                <StatCard
                  label="Rollback Rate"
                  value={`${rollbackRate}%`}
                  sub="of closed changes"
                  color={
                    parseFloat(rollbackRate) > 10
                      ? 'var(--danger)'
                      : parseFloat(rollbackRate) > 5
                        ? 'var(--orange)'
                        : 'var(--success)'
                  }
                />
                <StatCard
                  label="Last 30 Days"
                  value={rollbackTrend.last30}
                  sub={`prev 30d: ${rollbackTrend.prev30}`}
                  color={rollbackTrend.last30 > rollbackTrend.prev30 ? 'var(--danger)' : 'var(--success)'}
                />
                <StatCard label="Total Closed" value={totalClosed} sub="denominator" />
              </div>

              {/* 30-day trend table */}
              <div className="report-section">
                <div className="report-section__title">30-Day Rollback Trend</div>
                <div className="ism-table-wrap">
                  <table className="ism-table">
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th>Rollbacks</th>
                        <th>Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Last 30 days</td>
                        <td style={{ fontWeight: 600 }}>{rollbackTrend.last30}</td>
                        <td
                          style={{
                            color:
                              rollbackTrend.last30 > rollbackTrend.prev30
                                ? 'var(--danger)'
                                : rollbackTrend.last30 < rollbackTrend.prev30
                                  ? 'var(--success)'
                                  : 'var(--text-tertiary)',
                          }}
                        >
                          {rollbackTrend.prev30 === 0
                            ? '—'
                            : rollbackTrend.last30 > rollbackTrend.prev30
                              ? `+${rollbackTrend.last30 - rollbackTrend.prev30}`
                              : `${rollbackTrend.last30 - rollbackTrend.prev30}`}
                        </td>
                      </tr>
                      <tr>
                        <td>Previous 30 days</td>
                        <td>{rollbackTrend.prev30}</td>
                        <td>—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* By category */}
              <div className="report-section">
                <div className="report-section__title">Rollbacks by Category</div>
                {rollbackByCat.length === 0 ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                    No rollback data available
                  </div>
                ) : (
                  <div className="ism-table-wrap">
                    <table className="ism-table">
                      <thead>
                        <tr>
                          <th>Category</th>
                          <th>Rollback Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rollbackByCat.map((r) => (
                          <tr key={r.label}>
                            <td>{r.label}</td>
                            <td
                              style={{ color: r.value > 0 ? 'var(--danger)' : 'var(--text-tertiary)', fontWeight: 600 }}
                            >
                              {r.value}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* By location */}
              <div className="report-section">
                <div className="report-section__title">Rollbacks by Location / Region</div>
                {rollbackByLoc.length === 0 ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                    No rollback data available
                  </div>
                ) : (
                  <div className="ism-table-wrap">
                    <table className="ism-table">
                      <thead>
                        <tr>
                          <th>Location / Region</th>
                          <th>Rollback Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rollbackByLoc.map((r) => (
                          <tr key={r.label}>
                            <td>{r.label}</td>
                            <td
                              style={{ color: r.value > 0 ? 'var(--danger)' : 'var(--text-tertiary)', fontWeight: 600 }}
                            >
                              {r.value}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── G2-10: IT Ops Performance tab ───────────────────────── */}
          {reportTab === 'itops' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className="report-kpis">
                <StatCard
                  label="Avg Review Time"
                  value={avgItOpsReviewHours !== null ? `${avgItOpsReviewHours}h` : '—'}
                  sub="created → reviewed"
                  color={
                    avgItOpsReviewHours !== null && avgItOpsReviewHours > 48
                      ? 'var(--danger)'
                      : avgItOpsReviewHours !== null && avgItOpsReviewHours > 24
                        ? 'var(--orange)'
                        : 'var(--success)'
                  }
                />
                <StatCard label="Reviewers Active" value={itOpsWorkload.length} sub="distinct IT Ops POCs" />
              </div>

              {/* IT Ops POC workload */}
              <div className="report-section">
                <div className="report-section__title">IT Ops POC Workload (Reviews per User)</div>
                {itOpsWorkload.length === 0 ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                    No data available — cgmp_reviewedby field not populated
                  </div>
                ) : (
                  <div className="ism-table-wrap">
                    <table className="ism-table">
                      <thead>
                        <tr>
                          <th>IT Ops Reviewer</th>
                          <th>Changes Reviewed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itOpsWorkload.map((r) => (
                          <tr key={r.user}>
                            <td style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{r.user}</td>
                            <td style={{ fontWeight: 600 }}>{r.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* SLA compliance by location */}
              <div className="report-section">
                <div className="report-section__title">SLA Compliance by Location (Review Rate)</div>
                {itOpsSlaByLoc.length === 0 ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                    No data available
                  </div>
                ) : (
                  <div className="ism-table-wrap">
                    <table className="ism-table">
                      <thead>
                        <tr>
                          <th>Location</th>
                          <th>Total Changes</th>
                          <th>Reviewed</th>
                          <th>Review Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itOpsSlaByLoc.map((r) => (
                          <tr key={r.loc}>
                            <td>{r.loc}</td>
                            <td>{r.total}</td>
                            <td style={{ color: r.reviewed > 0 ? 'var(--success)' : 'var(--text-tertiary)' }}>
                              {r.reviewed}
                            </td>
                            <td>
                              <span
                                className={`sla-badge ${r.pct >= 80 ? 'sla-badge--green' : r.pct >= 50 ? 'sla-badge--orange' : 'sla-badge--red'}`}
                              >
                                {r.pct}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── G2-10: Bridge Execution tab ─────────────────────────── */}
          {reportTab === 'bridge' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className="report-kpis">
                {bridgeSuccessData ? (
                  <>
                    <StatCard
                      label="Bridge Success Rate"
                      value={`${bridgeSuccessData.rate}%`}
                      sub={`${bridgeSuccessData.success} of ${bridgeSuccessData.total} completed bridges`}
                      color={
                        bridgeSuccessData.rate >= 90
                          ? 'var(--success)'
                          : bridgeSuccessData.rate >= 75
                            ? 'var(--orange)'
                            : 'var(--danger)'
                      }
                    />
                    <StatCard label="Bridges Completed" value={bridgeSuccessData.total} />
                    <StatCard
                      label="Bridges w/ Rollback"
                      value={bridgeSuccessData.total - bridgeSuccessData.success}
                      color={bridgeSuccessData.total - bridgeSuccessData.success > 0 ? 'var(--danger)' : undefined}
                    />
                  </>
                ) : (
                  <StatCard label="Bridge Success Rate" value="No data" sub="No completed bridges found" />
                )}
                <StatCard
                  label="UAT Failure Rate"
                  value={`${uatFailureAnalysis.rate}%`}
                  sub={`${uatFailureAnalysis.returned} of ${uatFailureAnalysis.submitted} UAT submissions`}
                  color={
                    uatFailureAnalysis.rate > 20
                      ? 'var(--danger)'
                      : uatFailureAnalysis.rate > 10
                        ? 'var(--orange)'
                        : 'var(--success)'
                  }
                />
              </div>

              {/* Bridge success detail */}
              <div className="report-section">
                <div className="report-section__title">Bridge Execution Summary</div>
                {bridgeSuccessData === null ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                    No completed bridge data available
                  </div>
                ) : (
                  <div className="ism-table-wrap">
                    <table className="ism-table">
                      <thead>
                        <tr>
                          <th>Metric</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Bridges completed without rollback</td>
                          <td style={{ color: 'var(--success)', fontWeight: 600 }}>{bridgeSuccessData.success}</td>
                        </tr>
                        <tr>
                          <td>Bridges completed with rollback</td>
                          <td
                            style={{
                              color:
                                bridgeSuccessData.total - bridgeSuccessData.success > 0
                                  ? 'var(--danger)'
                                  : 'var(--text-tertiary)',
                              fontWeight: 600,
                            }}
                          >
                            {bridgeSuccessData.total - bridgeSuccessData.success}
                          </td>
                        </tr>
                        <tr>
                          <td>Total completed bridges</td>
                          <td style={{ fontWeight: 600 }}>{bridgeSuccessData.total}</td>
                        </tr>
                        <tr>
                          <td>Success rate</td>
                          <td>
                            <span
                              className={`sla-badge ${bridgeSuccessData.rate >= 90 ? 'sla-badge--green' : bridgeSuccessData.rate >= 75 ? 'sla-badge--orange' : 'sla-badge--red'}`}
                            >
                              {bridgeSuccessData.rate}%
                            </span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* UAT failure detail */}
              <div className="report-section">
                <div className="report-section__title">UAT Failure Analysis</div>
                {uatFailureAnalysis.submitted === 0 ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                    No UAT submission data available
                  </div>
                ) : (
                  <div className="ism-table-wrap">
                    <table className="ism-table">
                      <thead>
                        <tr>
                          <th>Metric</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Changes submitted through UAT</td>
                          <td style={{ fontWeight: 600 }}>{uatFailureAnalysis.submitted}</td>
                        </tr>
                        <tr>
                          <td>Changes with UAT rollback / failure</td>
                          <td
                            style={{
                              color: uatFailureAnalysis.returned > 0 ? 'var(--danger)' : 'var(--text-tertiary)',
                              fontWeight: 600,
                            }}
                          >
                            {uatFailureAnalysis.returned}
                          </td>
                        </tr>
                        <tr>
                          <td>UAT failure rate</td>
                          <td>
                            <span
                              className={`sla-badge ${uatFailureAnalysis.rate <= 10 ? 'sla-badge--green' : uatFailureAnalysis.rate <= 20 ? 'sla-badge--orange' : 'sla-badge--red'}`}
                            >
                              {uatFailureAnalysis.rate}%
                            </span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
