import type { FC, ReactNode } from 'react';
import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import type { Cgmp_changes } from '../generated/models/Cgmp_changesModel';
import type { Cgmp_notificationsBase } from '../generated/models/Cgmp_notificationsModel';
import { Cgmp_changesService, Cgmp_notificationsService } from '../generated';
import { asNotifCategory, asNotifPriority } from '../utils/optionSets';
import { statusLabel } from '../utils/roles';

const CHANGES_POLL_MS = 60_000;

/* ── SLA / critical-risk constants (G2-1, G2-4) ─────────────────────── */
const SLA_DAY2_MS = 2 * 24 * 60 * 60 * 1000;
const SLA_DAY5_MS = 5 * 24 * 60 * 60 * 1000;

interface ChangesContextValue {
  changes: Cgmp_changes[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const ChangesContext = createContext<ChangesContextValue | null>(null);

export const ChangesProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [changes, setChanges] = useState<Cgmp_changes[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const initializedRef = useRef(false);
  /* G2-1 / G2-4: de-duplication set — tracks which change IDs have already
     had SLA/critical-risk notifications created this session, so we never
     fire duplicate notifications across polling cycles. */
  const escalationTracked = useRef(new Set<string>());

  /* Track mounted state — set to false on unmount so async callbacks bail early */
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  /* G2-1 + G2-4: SLA enforcement & critical-risk auto-escalation.
     Runs each time the changes array updates. Fire-and-forget notifications
     are de-duplicated via escalationTracked so each alert is created at most
     once per session. */
  useEffect(() => {
    if (changes.length === 0) return;
    for (const c of changes) {
      const statusCode = c.cgmp_status as unknown as number;
      if (statusCode !== 100000001 && statusCode !== 100000002) continue; // Published or UnderReview

      /* G2-1: 2-day SLA escalation */
      const slaKey = c.cgmp_changeid;
      if (!escalationTracked.current.has(slaKey)) {
        const age = Date.now() - new Date(c.cgmp_starttime ?? 0).getTime();
        if (age > SLA_DAY2_MS) {
          escalationTracked.current.add(slaKey);
          const dayCount = Math.floor(age / 86400000);
          Cgmp_notificationsService.create({
            cgmp_title: `SLA Breach Risk: ${c.cgmp_changenumber}`,
            cgmp_message: `Change ${c.cgmp_changenumber} has been in ${statusLabel(statusCode)} for over ${dayCount} day${dayCount !== 1 ? 's' : ''}.`,
            cgmp_category: asNotifCategory(100000002), // Escalation
            cgmp_priority: asNotifPriority(100000000), // High
            cgmp_recipientid: c.cgmp_changepoc ?? '',
            cgmp_actionurl: `#pmo?change=${c.cgmp_changenumber ?? ''}`,
            statecode: 0,
          } as unknown as Omit<Cgmp_notificationsBase, 'cgmp_notificationid'>).catch(() => {});
        }
      }

      /* G2-1: 5-day SLA critical escalation (separate key so it fires on top of the 2-day one) */
      const sla5Key = `5day:${c.cgmp_changeid}`;
      if (!escalationTracked.current.has(sla5Key)) {
        const age5 = Date.now() - new Date(c.cgmp_starttime ?? 0).getTime();
        if (age5 > SLA_DAY5_MS) {
          escalationTracked.current.add(sla5Key);
          Cgmp_notificationsService.create({
            cgmp_title: `SLA Critical Overdue: ${c.cgmp_changenumber}`,
            cgmp_message: `Change ${c.cgmp_changenumber} has been in ${statusLabel(statusCode)} for over 5 days and requires Admin attention.`,
            cgmp_category: asNotifCategory(100000002), // Escalation
            cgmp_priority: asNotifPriority(100000000), // High
            cgmp_actionurl: `#pmo?change=${c.cgmp_changenumber ?? ''}`,
            statecode: 0,
          } as unknown as Omit<Cgmp_notificationsBase, 'cgmp_notificationid'>).catch(() => {});
        }
      }

      /* G2-4: Critical risk starts in < 1 hour */
      const critKey = `crit:${c.cgmp_changeid}`;
      if (!escalationTracked.current.has(critKey)) {
        const timeUntilStart = new Date(c.cgmp_starttime ?? 0).getTime() - Date.now();
        if (
          (c.cgmp_risklevel as unknown as number) === 100000003 &&
          timeUntilStart > 0 &&
          timeUntilStart < 60 * 60 * 1000
        ) {
          escalationTracked.current.add(critKey);
          Cgmp_notificationsService.create({
            cgmp_title: `Critical Change Starts in < 1 Hour: ${c.cgmp_changenumber}`,
            cgmp_message: `Critical change ${c.cgmp_changenumber} starts in ${Math.round(timeUntilStart / 60000)} minutes.`,
            cgmp_category: asNotifCategory(100000002), // Escalation
            cgmp_priority: asNotifPriority(100000000), // High
            cgmp_actionurl: `#pmo?change=${c.cgmp_changenumber ?? ''}`,
            statecode: 0,
          } as unknown as Omit<Cgmp_notificationsBase, 'cgmp_notificationid'>).catch(() => {});
        }
      }
    }
  }, [changes]);

  const refresh = useCallback(async (): Promise<boolean> => {
    const isFirst = !initializedRef.current;
    if (isFirst) setLoading(true);
    try {
      setError(null);
      const result = await Cgmp_changesService.getAll({
        orderBy: ['createdon desc'],
        top: 1000,
        select: [
          'cgmp_changeid',
          'cgmp_changenumber',
          'cgmp_title',
          'cgmp_status',
          'cgmp_risklevel',
          'cgmp_category',
          'cgmp_changetype',
          'cgmp_impactlevel',
          'cgmp_starttime',
          'cgmp_endtime',
          'cgmp_actualendtime',
          'cgmp_location',
          'cgmp_region',
          'cgmp_country',
          'cgmp_isemergency',
          'cgmp_rollbackinitiated',
          'cgmp_createdby',
          'cgmp_projectids',
          'cgmp_uatrequired',
          'cgmp_pirstatus',
          'cgmp_parentchangeid',
          'cgmp_changepoc',
          'cgmp_versionhistory',
          'createdon',
          'modifiedon',
        ],
      });
      if (!mountedRef.current) return false;
      setChanges(result.data ?? []);
      initializedRef.current = true;
      return true;
    } catch (err) {
      if (!mountedRef.current) return false;
      if (isFirst) setError(err instanceof Error ? err.message : 'Failed to load changes');
      return false;
    } finally {
      if (mountedRef.current && isFirst) setLoading(false);
    }
  }, []);

  /* Visibility-aware polling — pauses when tab is hidden, resumes on return */
  useEffect(() => {
    let failureCount = 0;
    let timer: number | null = null;

    function scheduleNextPoll() {
      const base = CHANGES_POLL_MS;
      const backoff = Math.min(base * Math.pow(2, failureCount), 300_000); // max 5 min
      const jitter = Math.random() * 10_000 - 5_000; // ±5 s
      const delay = Math.max(base, backoff + jitter); // never faster than base
      return window.setTimeout(poll, delay);
    }

    async function poll() {
      const success = await refresh();
      if (!mountedRef.current) return; // component unmounted — do not reschedule
      if (success) failureCount = 0;
      else failureCount += 1;
      timer = scheduleNextPoll();
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // Pause polling while tab is hidden
        if (timer !== null) {
          window.clearTimeout(timer);
          timer = null;
        }
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
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  return <ChangesContext.Provider value={{ changes, loading, error, refresh }}>{children}</ChangesContext.Provider>;
};

export function useChanges(): ChangesContextValue {
  const ctx = useContext(ChangesContext);
  if (!ctx) throw new Error('useChanges must be used within ChangesProvider');
  return ctx;
}
