import { useState, useEffect, useCallback, useRef } from 'react';
import { Cgmp_tasksService } from '../generated';
import type { Cgmp_tasks } from '../generated/models/Cgmp_tasksModel';

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

/** Fetches open (non-completed) tasks ordered by priority then due date. */
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
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [mounted]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  return { tasks, loading, error, refresh };
}
