import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Cgmp_notificationsService } from '../../generated';
import type {
  Cgmp_notifications,
  Cgmp_notificationscgmp_priority,
} from '../../generated/models/Cgmp_notificationsModel';
import { useApp } from '../../context/AppContext';
import { useNotifications } from '../../hooks/useDataverse';
import ConfirmDialog from '../ui/ConfirmDialog';

import {
  PRIORITY_CONFIG,
  CAT_LABEL,
  CAT_COLOR,
  loadPinned,
  savePinned,
  timeAgo,
  fullDate,
  getGroup,
  GROUP_LABEL,
  GROUP_ORDER,
  isNotifCategoryEnabled,
} from '../../utils/notifications';
import { exportCSV } from '../../utils/csv';

const CAT_OPTS = [
  { value: '', label: 'All Categories' },
  { value: '100000000', label: 'Review Request' },
  { value: '100000001', label: 'UAT Reminder' },
  { value: '100000002', label: 'Escalation' },
  { value: '100000003', label: 'GIICC Handover' },
  { value: '100000004', label: 'Closure' },
  { value: '100000005', label: 'Emergency' },
  { value: '100000006', label: 'System' },
];
const PRI_OPTS = [
  { value: '', label: 'All Priorities' },
  { value: '100000000', label: 'High' },
  { value: '100000001', label: 'Medium' },
  { value: '100000002', label: 'Low' },
];

const PMO_LS_KEY = 'pmo-changelist-filters';
const CHG_RE = /\b(CHG-[A-Z0-9-]+)\b/g;

function renderWithLinks(text: string | undefined, navigate: (page: string) => void): React.ReactNode {
  if (!text) return null;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(CHG_RE.source, 'g');
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const chg = m[1];
    parts.push(
      <button
        key={m.index}
        className="notif-chg-link"
        onClick={(e) => {
          e.stopPropagation();
          try {
            localStorage.setItem(
              PMO_LS_KEY,
              JSON.stringify({ search: chg, status: '', risk: '', category: '', dateRange: 'all' })
            );
          } catch {}
          navigate('pmo');
        }}
      >
        {chg}
      </button>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

type TabType = 'all' | 'unread' | 'high' | 'pinned' | 'snoozed' | 'dismissed';

interface ExportItem {
  id: string;
  title: string;
  message: string;
  priority: string;
  category: string;
  created: string;
  read: boolean;
  dismissed: boolean;
}

function exportJSON(items: ExportItem[]) {
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'notifications.json';
  a.click();
}

interface CardProps {
  n: Cgmp_notifications;
  pinned: Set<string>;
  onPin: (id: string) => void;
  onMarkRead: (id: string) => void;
  onSnooze: (id: string, h: number) => void;
  onDismiss: (id: string) => void;
  onDelete: (id: string) => void;
  onEscalate: (id: string) => void;
  working: Set<string>;
  navigate: (page: string) => void;
}

function NotifCard({
  n,
  pinned,
  onPin,
  onMarkRead,
  onSnooze,
  onDismiss,
  onDelete,
  onEscalate,
  working,
  navigate,
}: CardProps) {
  const [expanded, setExpanded] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const snoozeRef = useRef<HTMLDivElement>(null);
  const pCode = n.cgmp_priority as unknown as number;
  const cCode = n.cgmp_category as unknown as number;
  const pri = PRIORITY_CONFIG[pCode] ?? PRIORITY_CONFIG[100000002];
  const isPinned = pinned.has(n.cgmp_notificationid);
  const isWorking = working.has(n.cgmp_notificationid);
  const isSnoozed = !!(n.cgmp_snoozeduntil && new Date(n.cgmp_snoozeduntil) > new Date());

  useEffect(() => {
    if (!snoozeOpen) return;
    const h = (e: MouseEvent) => {
      if (snoozeRef.current && !snoozeRef.current.contains(e.target as Node)) setSnoozeOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [snoozeOpen]);

  return (
    <div className={`nc2-card${!n.cgmp_isread ? ' nc2-card--unread' : ''}${isPinned ? ' nc2-card--pinned' : ''}`}>
      <div className="nc2-card__bar" style={{ background: pri.barColor }} />
      <div className="nc2-card__content">
        <div className="nc2-card__header">
          <div className="nc2-card__chips">
            <span className="nc2-chip" style={{ background: CAT_COLOR[cCode] + '18', color: CAT_COLOR[cCode] }}>
              {CAT_LABEL[cCode] ?? 'System'}
            </span>
            <span className="nc2-chip" style={{ background: pri.badgeBg, color: pri.badgeColor }}>
              {pri.label}
            </span>
            {!n.cgmp_isread && <span className="nc2-dot" />}
            {isSnoozed && <span className="nc2-chip nc2-chip--muted">Snoozed</span>}
            {isPinned && <span className="nc2-chip nc2-chip--pin">Pinned</span>}
          </div>
          <span className="nc2-card__time" title={fullDate(n.createdon)}>
            {timeAgo(n.createdon)}
          </span>
        </div>
        <div className={`nc2-card__title${!n.cgmp_isread ? ' nc2-card__title--bold' : ''}`}>{n.cgmp_title}</div>
        {n.cgmp_message && (
          <div className={`nc2-card__msg${expanded ? '' : ' nc2-card__msg--clamped'}`}>
            {renderWithLinks(n.cgmp_message, navigate)}
          </div>
        )}
        {n.cgmp_message && n.cgmp_message.length > 120 && (
          <button className="nc2-expand-btn" onClick={() => setExpanded((e) => !e)}>
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
        {n.cgmp_actionurl && (
          <a
            href={n.cgmp_actionurl}
            className="notif-center__action-link"
            onClick={(e) => {
              e.preventDefault();
              // Navigate via hash routing: strip leading '#' if present
              window.location.hash = n.cgmp_actionurl!.replace(/^#/, '');
            }}
          >
            View Change →
          </a>
        )}
        {n.cgmp_acknowledgedby && (
          <div className="nc2-ack">
            <span className="notif-center__ack-label">Acknowledged by:</span>
            <span className="notif-center__ack-user">{n.cgmp_acknowledgedby}</span>
            {n.cgmp_acknowledgedat && (
              <span className="notif-center__ack-time" title={fullDate(n.cgmp_acknowledgedat)}>
                {timeAgo(n.cgmp_acknowledgedat)}
              </span>
            )}
          </div>
        )}
        <div className="nc2-card__actions">
          {!n.cgmp_isread && (
            <button className="nc2-action" onClick={() => onMarkRead(n.cgmp_notificationid)} disabled={isWorking}>
              Mark Read
            </button>
          )}
          <button
            className={`nc2-action${isPinned ? ' nc2-action--active' : ''}`}
            onClick={() => onPin(n.cgmp_notificationid)}
          >
            {isPinned ? 'Unpin' : 'Pin'}
          </button>
          <div className="nc2-snooze-wrap" ref={snoozeRef}>
            <button className="nc2-action" onClick={() => setSnoozeOpen((o) => !o)} disabled={isWorking}>
              Snooze
            </button>
            {snoozeOpen && (
              <div className="nc2-snooze-menu">
                {[1, 4, 24].map((h) => (
                  <button
                    key={h}
                    className="nc2-snooze-opt"
                    onClick={() => {
                      onSnooze(n.cgmp_notificationid, h);
                      setSnoozeOpen(false);
                    }}
                  >
                    {h === 1 ? '1 hour' : h === 4 ? '4 hours' : '24 hours'}
                  </button>
                ))}
              </div>
            )}
          </div>
          {pCode === 100000002 && (
            <button className="nc2-action" onClick={() => onEscalate(n.cgmp_notificationid)} disabled={isWorking}>
              Escalate
            </button>
          )}
          {!n.cgmp_isdismissed && (
            <button
              className="nc2-action nc2-action--danger"
              onClick={() => onDismiss(n.cgmp_notificationid)}
              disabled={isWorking}
            >
              Dismiss
            </button>
          )}
          {n.cgmp_isdismissed && (
            <button
              className="nc2-action nc2-action--danger"
              onClick={() => onDelete(n.cgmp_notificationid)}
              disabled={isWorking}
              title="Permanently delete this notification"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function NotificationCenter() {
  const { navigate, userProfile, showToast } = useApp();
  const { notifications: rawNotifications, loading, refresh } = useNotifications(userProfile?.cgmp_userprofileid);
  const [tab, setTab] = useState<TabType>('all');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [priFilter, setPriFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [pinned, setPinned] = useState<Set<string>>(() => loadPinned());
  const [working, setWorking] = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);
  const [dismissConfirmItems, setDismissConfirmItems] = useState<Cgmp_notifications[]>([]);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  // G2-15: Local optimistic overrides layered on top of server data
  const [localOverrides, setLocalOverrides] = useState<Record<string, Partial<Cgmp_notifications>>>({});

  // G2-13: Undo toast state
  const [undoState, setUndoState] = useState<{ label: string; snapshot: any } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Merged notifications: server data with optimistic overrides applied
  const notifications = useMemo(
    () =>
      rawNotifications.map((n) =>
        localOverrides[n.cgmp_notificationid]
          ? ({ ...n, ...localOverrides[n.cgmp_notificationid] } as Cgmp_notifications)
          : n
      ),
    [rawNotifications, localOverrides]
  );

  const setW = (id: string, on: boolean) =>
    setWorking((prev) => {
      const s = new Set(prev);
      if (on) s.add(id);
      else s.delete(id);
      return s;
    });

  // G2-13: Show undo toast for 5 seconds
  const showUndo = useCallback((label: string, snapshot: any) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoState({ label, snapshot });
    undoTimerRef.current = setTimeout(() => setUndoState(null), 5000);
  }, []);

  const handlePin = useCallback((id: string) => {
    setPinned((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      savePinned(s);
      return s;
    });
  }, []);

  // G2-15: Optimistic mark-as-read
  const handleMarkRead = useCallback(
    async (id: string) => {
      setLocalOverrides((prev) => ({ ...prev, [id]: { cgmp_isread: true } }));
      setW(id, true);
      try {
        await Cgmp_notificationsService.update(id, { cgmp_isread: true });
        refresh();
      } catch {
        // Revert on error
        setLocalOverrides((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        showToast('error', 'Failed to mark notification as read');
      } finally {
        setW(id, false);
      }
    },
    [refresh, showToast]
  );

  const handleSnooze = useCallback(
    async (id: string, hours: number) => {
      setW(id, true);
      try {
        await Cgmp_notificationsService.update(id, {
          cgmp_snoozeduntil: new Date(Date.now() + hours * 3600000).toISOString(),
        });
        refresh();
      } catch {
        showToast('error', 'Failed to snooze notification');
      } finally {
        setW(id, false);
      }
    },
    [refresh, showToast]
  );

  const handleDismiss = useCallback(
    async (id: string) => {
      setW(id, true);
      try {
        await Cgmp_notificationsService.update(id, { cgmp_isdismissed: true });
        refresh();
      } catch {
        showToast('error', 'Failed to dismiss notification');
      } finally {
        setW(id, false);
      }
    },
    [refresh, showToast]
  );

  const handleEscalate = useCallback(
    async (id: string) => {
      setW(id, true);
      try {
        await Cgmp_notificationsService.update(id, {
          cgmp_priority: 100000000 as unknown as Cgmp_notificationscgmp_priority,
        });
        refresh();
      } catch {
        showToast('error', 'Failed to escalate notification');
      } finally {
        setW(id, false);
      }
    },
    [refresh, showToast]
  );

  // G2-15: Optimistic mark-all-read
  const handleMarkAllRead = useCallback(async () => {
    const toMark = notifications.filter((n) => !n.cgmp_isread && !n.cgmp_isdismissed);
    if (toMark.length === 0) return;
    // Optimistic: immediately mark all as read in local state
    const overrides: Record<string, Partial<Cgmp_notifications>> = {};
    toMark.forEach((n) => {
      overrides[n.cgmp_notificationid] = { cgmp_isread: true };
    });
    setLocalOverrides((prev) => ({ ...prev, ...overrides }));
    setBulkWorking(true);
    try {
      // Process in batches of 20 to avoid overwhelming the API
      for (let i = 0; i < toMark.length; i += 20) {
        await Promise.all(
          toMark
            .slice(i, i + 20)
            .map((n) => Cgmp_notificationsService.update(n.cgmp_notificationid, { cgmp_isread: true }))
        );
      }
      refresh();
    } catch {
      // Revert all on error
      setLocalOverrides((prev) => {
        const next = { ...prev };
        toMark.forEach((n) => {
          delete next[n.cgmp_notificationid];
        });
        return next;
      });
      showToast('error', 'Failed to mark all notifications as read');
    } finally {
      setBulkWorking(false);
    }
  }, [notifications, refresh, showToast]);

  // G2-13: Dismiss-all with undo support
  const handleDismissAll = useCallback(
    async (toProcess: Cgmp_notifications[]) => {
      setBulkWorking(true);
      try {
        await Promise.all(
          toProcess.map((n) => Cgmp_notificationsService.update(n.cgmp_notificationid, { cgmp_isdismissed: true }))
        );
        refresh();
        showUndo(
          `${toProcess.length} notification${toProcess.length !== 1 ? 's' : ''} dismissed`,
          toProcess.map((n) => n.cgmp_notificationid)
        );
      } catch {
        showToast('error', 'Failed to dismiss notifications');
      } finally {
        setBulkWorking(false);
      }
    },
    [refresh, showToast, showUndo]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setW(id, true);
      try {
        await Cgmp_notificationsService.delete(id);
        refresh();
      } catch {
        showToast('error', 'Failed to delete notification');
      } finally {
        setW(id, false);
      }
    },
    [refresh, showToast]
  );

  const handleDeleteAllDismissed = useCallback(async () => {
    const dismissed = notifications.filter((n) => n.cgmp_isdismissed);
    if (dismissed.length === 0) return;
    setBulkWorking(true);
    try {
      await Promise.all(dismissed.map((n) => Cgmp_notificationsService.delete(n.cgmp_notificationid)));
      refresh();
    } catch {
      showToast('error', 'Failed to delete dismissed notifications');
    } finally {
      setBulkWorking(false);
    }
  }, [notifications, refresh, showToast]);

  // G2-13: Undo handler — restores dismissed notifications
  const handleUndoDismiss = useCallback(async () => {
    if (!undoState) return;
    const ids = undoState.snapshot as string[];
    setUndoState(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    // Optimistically un-dismiss in local state
    setLocalOverrides((prev) => {
      const next = { ...prev };
      ids.forEach((id) => {
        next[id] = { ...(next[id] ?? {}), cgmp_isdismissed: false };
      });
      return next;
    });
    // Fire-and-forget API restore
    Promise.all(ids.map((id) => Cgmp_notificationsService.update(id, { cgmp_isdismissed: false })))
      .then(() => {
        setLocalOverrides({});
        refresh();
      })
      .catch(() => showToast('error', 'Failed to restore notifications'));
  }, [undoState, refresh, showToast]);

  const filtered = useMemo(() => {
    let list = [...notifications];
    if (tab === 'unread') list = list.filter((n) => !n.cgmp_isread && !n.cgmp_isdismissed);
    else if (tab === 'high')
      list = list.filter((n) => (n.cgmp_priority as unknown as number) === 100000000 && !n.cgmp_isdismissed);
    else if (tab === 'pinned') list = list.filter((n) => pinned.has(n.cgmp_notificationid));
    else if (tab === 'snoozed')
      list = list.filter((n) => n.cgmp_snoozeduntil && new Date(n.cgmp_snoozeduntil) > new Date());
    else if (tab === 'dismissed') list = list.filter((n) => n.cgmp_isdismissed);
    else list = list.filter((n) => !n.cgmp_isdismissed);

    // G2-7: hide notifications from categories the user has opted out of
    const userCatPrefs = userProfile?.cgmp_notificationcategories;
    list = list.filter((n) => isNotifCategoryEnabled(userCatPrefs, n.cgmp_category as unknown as number));

    if (catFilter) list = list.filter((n) => String(n.cgmp_category as unknown as number) === catFilter);
    if (priFilter) list = list.filter((n) => String(n.cgmp_priority as unknown as number) === priFilter);
    if (dateFrom) list = list.filter((n) => n.createdon && new Date(n.createdon) >= new Date(dateFrom));
    if (dateTo) list = list.filter((n) => n.createdon && new Date(n.createdon) <= new Date(dateTo + 'T23:59:59'));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((n) => n.cgmp_title?.toLowerCase().includes(q) || n.cgmp_message?.toLowerCase().includes(q));
    }
    return list;
  }, [notifications, tab, catFilter, priFilter, dateFrom, dateTo, search, pinned, userProfile]);

  const pinnedItems = useMemo(() => filtered.filter((n) => pinned.has(n.cgmp_notificationid)), [filtered, pinned]);
  const unpinnedItems = useMemo(() => filtered.filter((n) => !pinned.has(n.cgmp_notificationid)), [filtered, pinned]);

  const grouped = useMemo(() => {
    const groups: Record<string, Cgmp_notifications[]> = { today: [], yesterday: [], week: [], earlier: [] };
    unpinnedItems.slice(0, page * PAGE_SIZE).forEach((n) => groups[getGroup(n.createdon)].push(n));
    return groups;
  }, [unpinnedItems, page]);

  const hasMore = unpinnedItems.length > page * PAGE_SIZE;

  // Stats
  const stats = useMemo(() => {
    const active = notifications.filter((n) => !n.cgmp_isdismissed);
    return {
      total: active.length,
      unread: active.filter((n) => !n.cgmp_isread).length,
      high: active.filter((n) => (n.cgmp_priority as unknown as number) === 100000000).length,
      snoozed: active.filter((n) => n.cgmp_snoozeduntil && new Date(n.cgmp_snoozeduntil) > new Date()).length,
      pinned: pinned.size,
      dismissed: notifications.filter((n) => n.cgmp_isdismissed).length,
    };
  }, [notifications, pinned]);

  const exportItems: ExportItem[] = filtered.map((n) => ({
    id: n.cgmp_notificationid,
    title: n.cgmp_title ?? '',
    message: n.cgmp_message ?? '',
    priority: PRIORITY_CONFIG[n.cgmp_priority as unknown as number]?.label ?? '',
    category: CAT_LABEL[n.cgmp_category as unknown as number] ?? '',
    created: fullDate(n.createdon),
    read: !!n.cgmp_isread,
    dismissed: !!n.cgmp_isdismissed,
  }));

  const TABS: { id: TabType; label: string; count?: number }[] = [
    { id: 'all', label: 'All', count: stats.total },
    { id: 'unread', label: 'Unread', count: stats.unread },
    { id: 'high', label: 'High Priority', count: stats.high },
    { id: 'pinned', label: 'Pinned', count: stats.pinned },
    { id: 'snoozed', label: 'Snoozed', count: stats.snoozed },
    { id: 'dismissed', label: 'Dismissed', count: stats.dismissed },
  ];

  const activeFiltersCount = [catFilter, priFilter, dateFrom, dateTo].filter(Boolean).length;

  return (
    <div className="nc2-root">
      {/* Header */}
      <div className="nc2-header">
        <div className="nc2-header__left">
          <h1 className="nc2-header__title">Notification Center</h1>
          <p className="nc2-header__sub">Manage and review all your notifications</p>
        </div>
        <div className="nc2-header__actions">
          <button
            className="btn btn--outline btn--sm"
            onClick={() =>
              exportCSV(
                'notifications.csv',
                ['ID', 'Title', 'Message', 'Priority', 'Category', 'Created', 'Read', 'Dismissed'],
                exportItems.map((i) => [
                  i.id,
                  i.title,
                  i.message,
                  i.priority,
                  i.category,
                  i.created,
                  String(i.read),
                  String(i.dismissed),
                ])
              )
            }
          >
            Export CSV
          </button>
          <button className="btn btn--outline btn--sm" onClick={() => exportJSON(exportItems)}>
            Export JSON
          </button>
          <button className="btn btn--outline btn--sm" onClick={refresh}>
            Refresh
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="nc2-stats-bar">
        <div className="nc2-stat">
          <span className="nc2-stat__val">{stats.total}</span>
          <span className="nc2-stat__lbl">Total</span>
        </div>
        <div className="nc2-stat nc2-stat--accent">
          <span className="nc2-stat__val">{stats.unread}</span>
          <span className="nc2-stat__lbl">Unread</span>
        </div>
        <div className="nc2-stat nc2-stat--danger">
          <span className="nc2-stat__val">{stats.high}</span>
          <span className="nc2-stat__lbl">High Priority</span>
        </div>
        <div className="nc2-stat">
          <span className="nc2-stat__val">{stats.pinned}</span>
          <span className="nc2-stat__lbl">Pinned</span>
        </div>
        <div className="nc2-stat">
          <span className="nc2-stat__val">{stats.snoozed}</span>
          <span className="nc2-stat__lbl">Snoozed</span>
        </div>
        <div className="nc2-stat">
          <span className="nc2-stat__val">{stats.dismissed}</span>
          <span className="nc2-stat__lbl">Dismissed</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="nc2-toolbar">
        <div className="nc2-toolbar__tabs" role="tablist" aria-label="Filter notifications by status">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`nc2-tab${tab === t.id ? ' nc2-tab--active' : ''}`}
              onClick={() => {
                setTab(t.id);
                setPage(1);
              }}
              role="tab"
              aria-selected={tab === t.id}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && <span className="nc2-tab__badge">{t.count}</span>}
            </button>
          ))}
        </div>
        <div className="nc2-toolbar__right">
          <div className="nc2-search-wrap">
            <svg className="nc2-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
            </svg>
            <input
              className="nc2-search"
              type="search"
              placeholder="Search notifications…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <button
            className={`btn btn--outline btn--sm${showFilters ? ' btn--active' : ''}`}
            onClick={() => setShowFilters((f) => !f)}
          >
            Filters{activeFiltersCount > 0 ? ` (${activeFiltersCount})` : ''}
          </button>
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <div className="nc2-filter-bar">
          <select
            className="form-select form-select--sm"
            value={catFilter}
            onChange={(e) => {
              setCatFilter(e.target.value);
              setPage(1);
            }}
          >
            {CAT_OPTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            className="form-select form-select--sm"
            value={priFilter}
            onChange={(e) => {
              setPriFilter(e.target.value);
              setPage(1);
            }}
          >
            {PRI_OPTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            className="form-input form-input--sm"
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            title="From date"
          />
          <input
            className="form-input form-input--sm"
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            title="To date"
          />
          {(catFilter || priFilter || dateFrom || dateTo) && (
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setCatFilter('');
                setPriFilter('');
                setDateFrom('');
                setDateTo('');
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Bulk actions */}
      {stats.unread > 0 && tab !== 'dismissed' && (
        <div className="nc2-bulk-bar">
          <button className="btn btn--outline btn--sm" onClick={handleMarkAllRead} disabled={bulkWorking}>
            Mark All Read
          </button>
          <button
            className="btn btn--outline btn--sm"
            onClick={() => setDismissConfirmItems(filtered.filter((n) => !n.cgmp_isdismissed))}
            disabled={bulkWorking}
          >
            Dismiss All
          </button>
          <span className="nc2-bulk-info">
            {filtered.length} notification{filtered.length !== 1 ? 's' : ''} visible
          </span>
        </div>
      )}
      {tab === 'dismissed' && stats.dismissed > 0 && (
        <div className="nc2-bulk-bar nc2-bulk-bar--danger">
          <button className="btn btn--danger btn--sm" onClick={() => setDeleteAllConfirm(true)} disabled={bulkWorking}>
            Delete All Dismissed ({stats.dismissed})
          </button>
          <span className="nc2-bulk-info">Permanently removes from Dataverse · Auto-cleared after 30 days</span>
        </div>
      )}

      {/* Content */}
      <div className="nc2-list">
        {loading ? (
          [0, 1, 2, 3].map((i) => (
            <div key={i} className="nc2-loading-card">
              <div className="skeleton" style={{ height: 10, width: '35%', marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 15, width: '70%', marginBottom: 6 }} />
              <div className="skeleton" style={{ height: 11, width: '55%' }} />
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="nc2-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
            </svg>
            <p className="nc2-empty__title">No notifications found</p>
            <p className="nc2-empty__sub">
              {search || catFilter || priFilter ? 'Try adjusting your filters' : "You're all caught up"}
            </p>
          </div>
        ) : (
          <>
            {pinnedItems.length > 0 && (
              <section>
                <div className="nc2-group-header nc2-group-header--pinned">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                  </svg>
                  Pinned <span className="nc2-group-count">({pinnedItems.length})</span>
                </div>
                {pinnedItems.map((n) => (
                  <NotifCard
                    key={n.cgmp_notificationid}
                    n={n}
                    pinned={pinned}
                    onPin={handlePin}
                    onMarkRead={handleMarkRead}
                    onSnooze={handleSnooze}
                    onDismiss={handleDismiss}
                    onDelete={handleDelete}
                    onEscalate={handleEscalate}
                    working={working}
                    navigate={navigate}
                  />
                ))}
              </section>
            )}
            {GROUP_ORDER.map(
              (g) =>
                grouped[g].length > 0 && (
                  <section key={g}>
                    <div className="nc2-group-header">
                      {GROUP_LABEL[g]} <span className="nc2-group-count">({grouped[g].length})</span>
                    </div>
                    {grouped[g].map((n) => (
                      <NotifCard
                        key={n.cgmp_notificationid}
                        n={n}
                        pinned={pinned}
                        onPin={handlePin}
                        onMarkRead={handleMarkRead}
                        onSnooze={handleSnooze}
                        onDismiss={handleDismiss}
                        onDelete={handleDelete}
                        onEscalate={handleEscalate}
                        working={working}
                        navigate={navigate}
                      />
                    ))}
                  </section>
                )
            )}
            {hasMore && (
              <div className="nc2-load-more">
                <button className="btn btn--outline" onClick={() => setPage((p) => p + 1)}>
                  Load More ({unpinnedItems.length - page * PAGE_SIZE} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={dismissConfirmItems.length > 0}
        onClose={() => setDismissConfirmItems([])}
        onConfirm={() => {
          handleDismissAll(dismissConfirmItems);
          setDismissConfirmItems([]);
        }}
        title="Dismiss All Visible"
        message={`Dismiss ${dismissConfirmItems.length} visible notification${dismissConfirmItems.length !== 1 ? 's' : ''}? They will be hidden from your active views.`}
        confirmLabel="Dismiss All"
        loading={bulkWorking}
      />
      <ConfirmDialog
        open={deleteAllConfirm}
        onClose={() => setDeleteAllConfirm(false)}
        onConfirm={() => {
          setDeleteAllConfirm(false);
          handleDeleteAllDismissed();
        }}
        title="Delete All Dismissed"
        message="Permanently delete all dismissed notifications? This cannot be undone."
        confirmLabel="Delete All"
        variant="destructive"
        loading={bulkWorking}
      />

      {/* G2-13: Undo toast — shown for 5 seconds after dismiss-all */}
      {undoState && (
        <div
          className="undo-toast"
          role="status"
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--surface-alt)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '10px 20px',
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            zIndex: 9999,
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          }}
        >
          <span style={{ fontSize: 14 }}>{undoState.label}</span>
          <button className="btn btn--sm btn--primary" onClick={handleUndoDismiss}>
            Undo
          </button>
          <button
            className="btn btn--sm btn--ghost"
            onClick={() => {
              setUndoState(null);
              if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
            }}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
