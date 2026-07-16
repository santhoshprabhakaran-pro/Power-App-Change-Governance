import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Cgmp_projectsService, Cgmp_changesService } from '../generated';
import { useChanges as useChangesCtx } from '../context/ChangesContext';
import type { Cgmp_changes } from '../generated/models/Cgmp_changesModel';
import type { Cgmp_projects } from '../generated/models/Cgmp_projectsModel';
import { isFeatureEnabled } from '../utils/featureFlags';
import { getDisplayTimezone } from '../utils/format';

/* ── Re-export role/status/label utilities ── */
import { STATUS } from '../utils/roles';
import { calcSLA } from '../utils/business';
export {
  ROLES,
  ROLE_LABEL,
  STATUS,
  STATUS as STATUS_CODES,
  ALLOWED_TRANSITIONS,
  getAllowedTransitions,
  canTransition,
  RISK,
  TASK_PRIORITY,
  BRIDGE_STATUS,
  STATUS_LABEL_MAP,
  RISK_LABEL_MAP,
  STATUS_COLOR_MAP,
  RISK_COLOR_MAP,
  RISK_ICON_MAP,
  PRIORITY_LABEL_MAP,
  PRIORITY_COLOR_MAP,
  BRIDGE_STATUS_LABEL_MAP,
  TASK_TYPE_LABEL_MAP,
  statusLabel,
  statusColor,
  riskLabel,
  riskColor,
  riskIcon,
  priorityLabel,
  priorityColor,
  bridgeStatusLabel,
  taskTypeLabel,
} from '../utils/roles';
export {
  ismFreezeDate,
  itopsFreezeDate,
  isIsmFrozen,
  daysUntilIsmFreeze,
  formatDueDelta,
  appendHistory,
  calcSLA,
} from '../utils/business';

/* ── Re-exports from focused sub-hook files (backward-compatible barrel) ── */
export { useDebounce } from './useDebounce';
export { useCountdown } from './useCountdown';
export { useSystemUsers, useAllUserProfiles } from './useUserProfile';
export { useBridges, useAllBridges } from './useBridges';
export { useTasks } from './useTasks';
export { useNotifications } from './useNotifications';

export interface StatusBucket {
  label: string;
  value: number;
  color: string;
  pct: string;
}

/** Returns the SLA risk threshold in hours for a given change.
 *  Emergency changes with the 'emergency-fast-track' feature flag use a 4-hour threshold;
 *  all other changes use the standard 48-hour threshold. */
export function getSlaThresholdHours(isEmergency: boolean): number {
  return isFeatureEnabled('emergency-fast-track') && isEmergency ? 4 : 48;
}

export interface DashboardStats {
  total: number;
  upcoming: number;
  active: number;
  completed: number;
  failed: number;
  slaCompliance: number;
  statusBuckets: StatusBucket[];
  trendData: Array<{ date: string; created: number; completedOnDay: number; failed: number; total: number }>;
  recentChanges: Cgmp_changes[];
  vsLastWeek: { total: number; upcoming: number; active: number; completed: number; failed: number; sla: number };
}

/** Returns a ref that flips to false when the component unmounts.
 *  Use inside async callbacks: `if (!mountedRef.current) return;` */
function useMounted() {
  const ref = useRef(true);
  useEffect(
    () => () => {
      ref.current = false;
    },
    []
  );
  return ref;
}

function countStatus(arr: Cgmp_changes[], code: number): number {
  return arr.filter((c) => (c.cgmp_status as unknown as number) === code).length;
}

function pct(a: number, b: number): number {
  return b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : a > 0 ? 100 : 0;
}

export function useChanges() {
  const { changes: allChanges, loading, error, refresh } = useChangesCtx();

  // SLA escalation is handled by Power Automate scheduled flow.
  // Client-side escalation removed (created duplicate records on every data refresh).

  const stats = useMemo<DashboardStats | null>(() => {
    // During the initial load (no data yet) return null so callers can show skeletons
    if (loading && allChanges.length === 0) return null;
    const all = allChanges;

    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 86400000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);
    const thisWeek = all.filter((c) => new Date(c.createdon ?? 0) >= oneWeekAgo);
    const lastWeek = all.filter((c) => {
      const d = new Date(c.createdon ?? 0);
      return d >= twoWeeksAgo && d < oneWeekAgo;
    });

    const bucketColors: Record<string, string> = {
      Draft: '#9E9E9E',
      UnderReview: '#0078D4',
      Released: '#00BCF2',
      UATUpdates: '#FF8C00',
      InProgress: '#8764B8',
      Completed: '#107C10',
      Failed: '#D13438',
      Cancelled: '#605E5C',
    };
    const bucketCodes: Record<string, number> = {
      Draft: STATUS.Draft,
      UnderReview: STATUS.UnderReview,
      Released: STATUS.Released,
      UATUpdates: STATUS.UATUpdates,
      InProgress: STATUS.InProgress,
      Completed: STATUS.Completed,
      Failed: STATUS.Failed,
      Cancelled: STATUS.Cancelled,
    };
    const bucketLabels: Record<string, string> = {
      Draft: 'Draft',
      UnderReview: 'Under Review',
      Released: 'Released',
      UATUpdates: 'Awaiting UAT',
      InProgress: 'In Progress',
      Completed: 'Completed',
      Failed: 'Failed',
      Cancelled: 'Cancelled',
    };
    const totalCount = all.length || 1;
    const statusBuckets: StatusBucket[] = Object.keys(bucketCodes)
      .map((key) => {
        const value = countStatus(all, bucketCodes[key]);
        return {
          label: bucketLabels[key],
          value,
          color: bucketColors[key],
          pct: `${((value / totalCount) * 100).toFixed(1)}%`,
        };
      })
      .filter((b) => b.value > 0);

    const trendData = Array.from({ length: 7 }, (_, i) => {
      const dayStart = new Date(now);
      dayStart.setDate(dayStart.getDate() - (6 - i));
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);
      const day = all.filter((c) => {
        const d = new Date(c.createdon ?? 0);
        return d >= dayStart && d <= dayEnd;
      });
      const completedOnDay = all.filter((c) => {
        if ((c.cgmp_status as unknown as number) !== STATUS.Completed) return false;
        const endDate = (c as any).cgmp_actualendtime ?? c.modifiedon;
        if (!endDate) return false;
        const d = new Date(endDate);
        return d >= dayStart && d <= dayEnd;
      });
      return {
        date: dayStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: getDisplayTimezone() }),
        created: day.length,
        completedOnDay: completedOnDay.length,
        failed: countStatus(day, STATUS.Failed),
        total: day.length,
        completed: completedOnDay.length,
      };
    });

    const total = all.length;
    const activeStatuses: number[] = [
      STATUS.Draft,
      STATUS.Published,
      STATUS.UnderReview,
      STATUS.Released,
      STATUS.UATUpdates,
      STATUS.Locked,
    ];
    const upcoming = all.filter(
      (c) =>
        c.cgmp_starttime &&
        new Date(c.cgmp_starttime) > now &&
        activeStatuses.includes(c.cgmp_status as unknown as number)
    ).length;
    const active = countStatus(all, STATUS.InProgress);
    const completed = countStatus(all, STATUS.Completed);
    const failed = countStatus(all, STATUS.Failed);
    const sla = calcSLA(thisWeek);
    const lastSla = calcSLA(lastWeek);

    return {
      total,
      upcoming,
      active,
      completed,
      failed,
      slaCompliance: calcSLA(all),
      statusBuckets,
      trendData,
      recentChanges: all.slice(0, 5),
      vsLastWeek: {
        total: pct(thisWeek.length, lastWeek.length),
        upcoming: pct(
          thisWeek.filter((c) => c.cgmp_starttime && new Date(c.cgmp_starttime) > now).length,
          lastWeek.filter((c) => c.cgmp_starttime && new Date(c.cgmp_starttime) > now).length
        ),
        active: pct(countStatus(thisWeek, STATUS.InProgress), countStatus(lastWeek, STATUS.InProgress)),
        completed: pct(countStatus(thisWeek, STATUS.Completed), countStatus(lastWeek, STATUS.Completed)),
        failed: pct(countStatus(thisWeek, STATUS.Failed), countStatus(lastWeek, STATUS.Failed)),
        sla: Math.round((sla - lastSla) * 10) / 10,
      },
    };
  }, [allChanges, loading]);

  return { stats, allChanges, loading, error, refresh };
}

export function useChangeList() {
  // Delegates to the shared ChangesContext — no independent Dataverse query.
  const { changes, loading, error, refresh } = useChangesCtx();
  return { changes, loading, error, refresh };
}

export function useProjects() {
  const [projects, setProjects] = useState<Cgmp_projects[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useMounted();

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const r = await Cgmp_projectsService.getAll({ orderBy: ['cgmp_name asc'] });
      if (!mounted.current) return;
      setProjects(r.data ?? []);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load projects');
      setProjects([]);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [mounted]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  return { projects, loading, error, refresh };
}

/* ── Server-side paginated changes hook (G3-9) ── */

export interface PaginatedChangesResult {
  changes: Cgmp_changes[];
  loading: boolean;
  page: number;
  hasNextPage: boolean;
  goNext: () => void;
  goPrev: () => void;
  pageSize: number;
}

/**
 * Fetches changes page-by-page using OData $skipToken cursor pagination.
 * Each page is cached so navigating back does not re-fetch.
 *
 * Usage:
 *   const { changes, loading, page, hasNextPage, goNext, goPrev, pageSize } =
 *     usePaginatedChanges(50);
 *
 * Wire `changes` into DataTable `rows` and pass a `serverPagination` descriptor
 * built from the returned values to opt out of DataTable's client-side paging.
 */
export function usePaginatedChanges(pageSize = 50): PaginatedChangesResult {
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState<Cgmp_changes[][]>([]);
  const [skipTokens, setSkipTokens] = useState<(string | undefined)[]>([]);
  const [loading, setLoading] = useState(false);
  const mounted = useMounted();

  // Refs mirror state so the fetchPage callback can read current cached values
  // without including them in its dependency array (avoids re-creating the fn
  // after every page load, which would re-trigger the useEffect).
  const pagesCache = useRef<Cgmp_changes[][]>([]);
  const tokensCache = useRef<(string | undefined)[]>([]);

  const fetchPage = useCallback(
    async (pageIndex: number) => {
      // Short-circuit if this page is already cached
      if (pagesCache.current[pageIndex] !== undefined) return;

      // Page N > 0 requires the skipToken stored after fetching page N-1
      const token = pageIndex > 0 ? tokensCache.current[pageIndex - 1] : undefined;
      if (pageIndex > 0 && !token) return; // navigated too far forward without a token

      setLoading(true);
      try {
        const result = await Cgmp_changesService.getAll({
          top: pageSize,
          orderBy: ['cgmp_starttime desc'],
          ...(token !== undefined ? { skipToken: token } : {}),
        });
        if (!mounted.current) return;

        const records: Cgmp_changes[] = result.data ?? [];
        const nextToken: string | undefined = result.skipToken;

        const newPages = [...pagesCache.current];
        newPages[pageIndex] = records;
        pagesCache.current = newPages;

        const newTokens = [...tokensCache.current];
        newTokens[pageIndex] = nextToken;
        tokensCache.current = newTokens;

        setPages(newPages);
        setSkipTokens(newTokens);
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [mounted, pageSize]
  );

  useEffect(() => {
    void fetchPage(page);
  }, [page, fetchPage]);

  return {
    changes: pages[page] ?? [],
    loading,
    page,
    hasNextPage: !!skipTokens[page],
    goNext: () => setPage((p) => p + 1),
    goPrev: () => setPage((p) => Math.max(0, p - 1)),
    pageSize,
  };
}
