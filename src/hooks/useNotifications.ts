import { useState, useEffect, useCallback, useRef } from 'react';
import { Cgmp_notificationsService } from '../generated';
import type { Cgmp_notifications } from '../generated/models/Cgmp_notificationsModel';
import { assertGuid, validateODataResponse } from '../utils/odata';
import { NotificationSchema } from '../schemas/entities';

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
    if (!userProfileId) {
      setLoading(false);
      setNotifications([]);
      return false;
    }
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
      let notifs: Cgmp_notifications[] = validateODataResponse(
        r.data ?? [],
        NotificationSchema,
        'cgmp_notifications'
      ) as unknown as Cgmp_notifications[];

      // Auto-clear dismissed notifications older than NOTIF_AUTO_CLEAR_DAYS days
      const cutoff = Date.now() - NOTIF_AUTO_CLEAR_DAYS * 86_400_000;
      const expired = notifs.filter(
        (n) => n.cgmp_isdismissed && n.createdon && new Date(n.createdon).getTime() < cutoff
      );
      if (expired.length > 0) {
        const expiredIds = new Set(expired.map((n) => n.cgmp_notificationid));
        notifs = notifs.filter((n) => !expiredIds.has(n.cgmp_notificationid));
        // Fire-and-forget — don't block the UI update on cleanup
        Promise.all(expired.map((n) => Cgmp_notificationsService.delete(n.cgmp_notificationid))).catch((err) => {
          if (import.meta.env.DEV) console.error('Notification cleanup failed:', err);
        });
      }

      setNotifications(notifs);
      setUnreadCount(notifs.filter((n) => !n.cgmp_isread && !n.cgmp_isdismissed).length);
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
    if (!userProfileId) {
      setLoading(false);
      return;
    }

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
  }, [refresh, userProfileId, mounted]);

  return { notifications, loading, unreadCount, error, refresh };
}
