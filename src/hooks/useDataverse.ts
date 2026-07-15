import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Cgmp_tasksService,
  Cgmp_bridgesService,
  Cgmp_notificationsService,
  Cgmp_projectsService,
  SystemusersService,
} from '../generated';
import { useChanges as useChangesCtx } from '../context/ChangesContext';
import type { Cgmp_changes } from '../generated/models/Cgmp_changesModel';
import type { Cgmp_tasks } from '../generated/models/Cgmp_tasksModel';
import type { Cgmp_bridges } from '../generated/models/Cgmp_bridgesModel';
import type { Cgmp_projects } from '../generated/models/Cgmp_projectsModel';
import type { Cgmp_notifications } from '../generated/models/Cgmp_notificationsModel';
import type { Systemusers } from '../generated/models/SystemusersModel';
import { useUserProfiles } from '../context/UserProfilesContext';
import { isFeatureEnabled } from '../utils/featureFlags';
import { assertGuid } from '../utils/odata';
import { getDisplayTimezone } from '../utils/format';

/* ── Re-export role/status/label utilities ── */
import { STATUS } from '../utils/roles';
import { calcSLA } from '../utils/business';
export {
  ROLES, ROLE_LABEL, STATUS, STATUS as STATUS_CODES, ALLOWED_TRANSITIONS, getAllowedTransitions, canTransition,
  RISK, TASK_PRIORITY, BRIDGE_STATUS,
  STATUS_LABEL_MAP, RISK_LABEL_MAP, STATUS_COLOR_MAP, RISK_COLOR_MAP, RISK_ICON_MAP,
  PRIORITY_LABEL_MAP, PRIORITY_COLOR_MAP, BRIDGE_STATUS_LABEL_MAP, TASK_TYPE_LABEL_MAP,
  statusLabel, statusColor, riskLabel, riskColor, riskIcon,
  priorityLabel, priorityColor, bridgeStatusLabel, taskTypeLabel,
} from '../utils/roles';
export { ismFreezeDate, itopsFreezeDate, isIsmFrozen, daysUntilIsmFreeze, formatDueDelta, appendHistory, calcSLA } from '../utils/business';
export { useDebounce } from './useDebounce';

export interface StatusBucket { label: string; value: number; color: string; pct: string; }

/** Returns the SLA risk threshold in hours for a given change.
 *  Emergency changes with the 'emergency-fast-track' feature flag use a 4-hour threshold;
 *  all other changes use the standard 48-hour threshold. */
export function getSlaThresholdHours(isEmergency: boolean): number {
  return (isFeatureEnabled('emergency-fast-track') && isEmergency) ? 4 : 48;
}

export interface DashboardStats {
  total: number; upcoming: number; active: number; completed: number; failed: number;
  slaCompliance: number;
  statusBuckets: StatusBucket[];
  trendData: Array<{ date: string; created: number; completedOnDay: number; failed: number; total: number }>;
  recentChanges: Cgmp_changes[];
  vsLastWeek: { total: number; upcoming: number; active: number; completed: number; failed: number; sla: number; };
}

/** Returns a ref that flips to false when the component unmounts.
 *  Use inside async callbacks: `if (!mountedRef.current) return;` */
function useMounted() {
  const ref = useRef(true);
  useEffect(() => () => { ref.current = false; }, []);
  return ref;
}

function countStatus(arr: Cgmp_changes[], code: number): number {
  return arr.filter(c => (c.cgmp_status as unknown as number) === code).length;
}

function pct(a: number, b: number): number {
  return b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : (a > 0 ? 100 : 0);
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
    const oneWeekAgo  = new Date(now.getTime() - 7  * 86400000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);
    const thisWeek = all.filter(c => new Date(c.createdon ?? 0) >= oneWeekAgo);
    const lastWeek = all.filter(c => { const d = new Date(c.createdon ?? 0); return d >= twoWeeksAgo && d < oneWeekAgo; });

    const bucketColors: Record<string, string> = {
      Draft: '#9E9E9E', UnderReview: '#0078D4', Released: '#00BCF2',
      UATUpdates: '#FF8C00', InProgress: '#8764B8', Completed: '#107C10',
      Failed: '#D13438', Cancelled: '#605E5C',
    };
    const bucketCodes: Record<string, number> = {
      Draft: STATUS.Draft, UnderReview: STATUS.UnderReview, Released: STATUS.Released,
      UATUpdates: STATUS.UATUpdates, InProgress: STATUS.InProgress,
      Completed: STATUS.Completed, Failed: STATUS.Failed, Cancelled: STATUS.Cancelled,
    };
    const bucketLabels: Record<string, string> = {
      Draft: 'Draft', UnderReview: 'Under Review', Released: 'Released',
      UATUpdates: 'Awaiting UAT', InProgress: 'In Progress',
      Completed: 'Completed', Failed: 'Failed', Cancelled: 'Cancelled',
    };
    const totalCount = all.length || 1;
    const statusBuckets: StatusBucket[] = Object.keys(bucketCodes).map(key => {
      const value = countStatus(all, bucketCodes[key]);
      return { label: bucketLabels[key], value, color: bucketColors[key], pct: `${((value / totalCount) * 100).toFixed(1)}%` };
    }).filter(b => b.value > 0);

    const trendData = Array.from({ length: 7 }, (_, i) => {
      const dayStart = new Date(now);
      dayStart.setDate(dayStart.getDate() - (6 - i));
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);
      const day = all.filter(c => { const d = new Date(c.createdon ?? 0); return d >= dayStart && d <= dayEnd; });
      const completedOnDay = all.filter(c => {
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
    const activeStatuses: number[] = [STATUS.Draft, STATUS.Published, STATUS.UnderReview,
      STATUS.Released, STATUS.UATUpdates, STATUS.Locked];
    const upcoming = all.filter(c =>
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
      total, upcoming, active, completed, failed,
      slaCompliance: calcSLA(all),
      statusBuckets, trendData,
      recentChanges: all.slice(0, 5),
      vsLastWeek: {
        total: pct(thisWeek.length, lastWeek.length),
        upcoming: pct(
          thisWeek.filter(c => c.cgmp_starttime && new Date(c.cgmp_starttime) > now).length,
          lastWeek.filter(c => c.cgmp_starttime && new Date(c.cgmp_starttime) > now).length,
        ),
        active:    pct(countStatus(thisWeek, STATUS.InProgress),  countStatus(lastWeek, STATUS.InProgress)),
        completed: pct(countStatus(thisWeek, STATUS.Completed),   countStatus(lastWeek, STATUS.Completed)),
        failed:    pct(countStatus(thisWeek, STATUS.Failed),      countStatus(lastWeek, STATUS.Failed)),
        sla: Math.round((sla - lastSla) * 10) / 10,
      },
    };
  }, [allChanges, loading]);

  return { stats, allChanges, loading, error, refresh };
}

export function useTasks() {
  const [tasks, setTasks] = useState<Cgmp_tasks[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useMounted();

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const r = await Cgmp_tasksService.getAll({
        filter: 'cgmp_iscompleted eq false',
        orderBy: ['cgmp_priority asc', 'cgmp_duedate asc'],
        top: 10,
      });
      if (!mounted.current) return;
      setTasks(r.data ?? []);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
      setTasks([]);
    } finally { if (mounted.current) setLoading(false); }
  }, [mounted]);

  useEffect(() => { refresh(); }, [refresh]);
  return { tasks, loading, error, refresh };
}

export function useBridges() {
  const [bridges, setBridges] = useState<Cgmp_bridges[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useMounted();

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const r = await Cgmp_bridgesService.getAll({
        filter: 'cgmp_status eq 100000000 or cgmp_status eq 100000004',
        orderBy: ['cgmp_schedstart asc'],
        top: 10,
      });
      if (!mounted.current) return;
      setBridges(r.data ?? []);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load bridges');
      setBridges([]);
    } finally { if (mounted.current) setLoading(false); }
  }, [mounted]);

  useEffect(() => { refresh(); }, [refresh]);
  return { bridges, loading, error, refresh };
}

const NOTIF_POLL_MS = 30_000;
const NOTIF_AUTO_CLEAR_DAYS = 30;

export function useNotifications(userProfileId?: string) {
  const [notifications, setNotifications] = useState<Cgmp_notifications[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mounted = useMounted();
  const initialized = useRef(false);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!userProfileId) { setLoading(false); setNotifications([]); return false; }
    const isFirst = !initialized.current;
    if (isFirst) setLoading(true);
    try {
      setError(null);
      const r = await Cgmp_notificationsService.getAll({
        orderBy: ['createdon desc'],
        top: 200,
        filter: `cgmp_recipientid eq '${assertGuid(userProfileId, 'cgmp_recipientid')}'`,
      });
      if (!mounted.current) return false;
      let notifs = r.data ?? [];

      // Auto-clear dismissed notifications older than NOTIF_AUTO_CLEAR_DAYS days
      const cutoff = Date.now() - NOTIF_AUTO_CLEAR_DAYS * 86_400_000;
      const expired = notifs.filter(
        n => n.cgmp_isdismissed && n.createdon && new Date(n.createdon).getTime() < cutoff
      );
      if (expired.length > 0) {
        const expiredIds = new Set(expired.map(n => n.cgmp_notificationid));
        notifs = notifs.filter(n => !expiredIds.has(n.cgmp_notificationid));
        // Fire-and-forget — don't block the UI update on cleanup
        Promise.all(expired.map(n => Cgmp_notificationsService.delete(n.cgmp_notificationid))).catch(err => { if (import.meta.env.DEV) console.error('Notification cleanup failed:', err); });
      }

      setNotifications(notifs);
      setUnreadCount(notifs.filter(n => !n.cgmp_isread && !n.cgmp_isdismissed).length);
      initialized.current = true;
      return true;
    } catch (err) {
      if (!mounted.current) return false;
      if (isFirst) setError(err instanceof Error ? err.message : 'Failed to load notifications');
      return false;
    } finally {
      if (mounted.current && isFirst) setLoading(false);
    }
  }, [mounted, userProfileId]);

  useEffect(() => {
    if (!userProfileId) { setLoading(false); return; }

    // Closure-local state for this effect instance — semantically equivalent to useRef
    // but keeps TypeScript 5.9 noUnusedLocals happy (refs only used in nested fns trigger
    // a false positive when declared at hook scope).
    let failureCount = 0;
    let timer: number | null = null;

    // Schedules the next poll with exponential backoff and ±5 s jitter.
    // Never fires faster than the base interval regardless of jitter.
    function scheduleNextPoll() {
      const base = NOTIF_POLL_MS; // 30_000
      const backoff = Math.min(base * Math.pow(2, failureCount), 300_000); // max 5 min
      const jitter = Math.random() * 10_000 - 5_000; // ±5 s
      const delay = Math.max(base, backoff + jitter); // never faster than base
      return window.setTimeout(poll, delay);
    }

    async function poll() {
      const success = await refresh();
      if (!mounted.current) return; // component unmounted — do not reschedule
      if (success) failureCount = 0;
      else failureCount += 1;
      timer = scheduleNextPoll();
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // Pause polling while tab is hidden
        if (timer !== null) { window.clearTimeout(timer); timer = null; }
      } else {
        // User returned — reset backoff and poll immediately
        failureCount = 0;
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(poll, 0);
      }
    };

    poll(); // initial fetch
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (timer !== null) { window.clearTimeout(timer); timer = null; }
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh, userProfileId, mounted]);

  return { notifications, loading, unreadCount, error, refresh };
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
    } finally { if (mounted.current) setLoading(false); }
  }, [mounted]);

  useEffect(() => { refresh(); }, [refresh]);
  return { projects, loading, error, refresh };
}

export function useAllBridges(autoRefreshMs = 30000) {
  const [bridges, setBridges] = useState<Cgmp_bridges[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useMounted();
  const initialized = useRef(false);

  const refresh = useCallback(async () => {
    if (!initialized.current) setLoading(true);
    try {
      const r = await Cgmp_bridgesService.getAll({ orderBy: ['cgmp_schedstart desc'], top: 200 });
      if (!mounted.current) return;
      setBridges(r.data ?? []);
      setError(null);
      initialized.current = true;
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load bridges');
    } finally { if (mounted.current) setLoading(false); }
  }, [mounted]);

  useEffect(() => {
    // Closure-local timer — stops polling when tab is hidden, restarts on return.
    let timer: number | null = null;

    async function poll() {
      await refresh();
      if (!mounted.current) return; // unmounted — do not reschedule
      // Guard against 0 or negative intervals — treat as "no auto-refresh"
      if (autoRefreshMs > 0) {
        timer = window.setTimeout(poll, autoRefreshMs);
      }
    }

    function onVisibility() {
      if (document.hidden) {
        // Pause polling while tab is hidden
        if (timer !== null) { window.clearTimeout(timer); timer = null; }
      } else {
        // User returned — poll immediately
        poll();
      }
    }

    if (!document.hidden) poll(); // initial fetch (skip if tab already hidden)
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer !== null) { window.clearTimeout(timer); timer = null; }
    };
  }, [refresh, autoRefreshMs, mounted]);

  return { bridges, loading, error, refresh };
}

/* Fetch active O365/AAD system users for Tech POC picker */
export function useSystemUsers() {
  const [users, setUsers] = useState<Systemusers[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useMounted();

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const r = await SystemusersService.getAll({
        filter: 'isdisabled eq false',
        orderBy: ['fullname asc'],
        // Covers typical deployment sizes; expand if user picker shows incomplete results
        top: 200,
        select: ['systemuserid', 'fullname', 'internalemailaddress', 'isdisabled'],
      });
      if (!mounted.current) return;
      setUsers((r.data ?? []).filter(u => u.fullname));
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load users');
      setUsers([]);
    } finally { if (mounted.current) setLoading(false); }
  }, [mounted]);

  useEffect(() => { fetch(); }, [fetch]);
  return { users, loading, error };
}

export function useCountdown(targetDate: string | undefined) {
  const [remaining, setRemaining] = useState('--:--:--');

  useEffect(() => {
    if (!targetDate) { setRemaining('N/A'); return; }
    const target = new Date(targetDate).getTime();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const formatDiff = (diff: number) => {
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
    };
    const diff0 = target - Date.now();
    if (diff0 <= 0) { setRemaining('Now'); return; }
    setRemaining(formatDiff(diff0));
    const id = setInterval(() => {
      const diff = target - Date.now();
      if (diff <= 0) { setRemaining('Now'); clearInterval(id); return; }
      setRemaining(formatDiff(diff));
    }, 1000);
    return () => clearInterval(id);
  }, [targetDate]);

  return remaining;
}


export function useAllUserProfiles() {
  // Delegates to shared context — prevents N independent 500-record fetches.
  const { userProfiles: profiles, loading } = useUserProfiles();
  return { profiles, loading };
}
