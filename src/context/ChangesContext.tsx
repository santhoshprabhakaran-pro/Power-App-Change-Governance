import type { FC, ReactNode } from 'react';
import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import type { Cgmp_changes } from '../generated/models/Cgmp_changesModel';
import { Cgmp_changesService } from '../generated';

const CHANGES_POLL_MS = 60_000;

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

  /* Track mounted state — set to false on unmount so async callbacks bail early */
  useEffect(() => () => { mountedRef.current = false; }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    const isFirst = !initializedRef.current;
    if (isFirst) setLoading(true);
    try {
      setError(null);
      const result = await Cgmp_changesService.getAll({
        orderBy: ['createdon desc'],
        top: 1000,
        select: [
          'cgmp_changeid', 'cgmp_changenumber', 'cgmp_title', 'cgmp_status', 'cgmp_risklevel',
          'cgmp_category', 'cgmp_changetype', 'cgmp_impactlevel',
          'cgmp_starttime', 'cgmp_endtime', 'cgmp_actualendtime',
          'cgmp_location', 'cgmp_region', 'cgmp_country',
          'cgmp_isemergency', 'cgmp_rollbackinitiated',
          'cgmp_createdby', 'cgmp_projectids',
          'cgmp_uatrequired', 'cgmp_pirstatus', 'cgmp_parentchangeid',
          'createdon', 'modifiedon',
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
  }, [refresh]);

  return (
    <ChangesContext.Provider value={{ changes, loading, error, refresh }}>
      {children}
    </ChangesContext.Provider>
  );
};

export function useChanges(): ChangesContextValue {
  const ctx = useContext(ChangesContext);
  if (!ctx) throw new Error('useChanges must be used within ChangesProvider');
  return ctx;
}
