import { useState, useEffect, useCallback, useRef } from 'react';
import { Cgmp_bridgesService } from '../generated';
import type { Cgmp_bridges } from '../generated/models/Cgmp_bridgesModel';
import { validateODataResponse } from '../utils/odata';
import { BridgeSchema } from '../schemas/entities';

/** Returns a ref that flips to false when the component unmounts. */
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

/** Fetches a small set of active/upcoming bridges (top 10). */
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
      setBridges(validateODataResponse(r.data ?? [], BridgeSchema, 'cgmp_bridges') as unknown as Cgmp_bridges[]);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load bridges');
      setBridges([]);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [mounted]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  return { bridges, loading, error, refresh };
}

/** Fetches all bridges with auto-refresh and visibility-aware polling. */
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
      setBridges(validateODataResponse(r.data ?? [], BridgeSchema, 'cgmp_bridges') as unknown as Cgmp_bridges[]);
      setError(null);
      initialized.current = true;
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load bridges');
    } finally {
      if (mounted.current) setLoading(false);
    }
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
        if (timer !== null) {
          window.clearTimeout(timer);
          timer = null;
        }
      } else {
        // User returned — poll immediately
        poll();
      }
    }

    if (!document.hidden) poll(); // initial fetch (skip if tab already hidden)
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
  }, [refresh, autoRefreshMs, mounted]);

  return { bridges, loading, error, refresh };
}
