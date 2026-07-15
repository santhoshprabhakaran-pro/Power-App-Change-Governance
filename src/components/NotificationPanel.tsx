import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { SlidePanel } from './ui/Modal';
import { Cgmp_notificationsService } from '../generated';
import type { Cgmp_notifications } from '../generated/models/Cgmp_notificationsModel';
import { useApp } from '../context/AppContext';

import { CAT_LABEL, CAT_COLOR, PRIORITY_CONFIG as PRI_CONFIG, loadPinned, savePinned, timeAgo, fullDate, getGroup, GROUP_LABEL, GROUP_ORDER } from '../utils/notifications';

const CAT_ENTRIES = [
  { value: -1, label: 'All' },
  { value: 100000000, label: 'Review' },
  { value: 100000001, label: 'UAT' },
  { value: 100000002, label: 'Escalation' },
  { value: 100000003, label: 'GIICC' },
  { value: 100000004, label: 'Closure' },
  { value: 100000005, label: 'Emergency' },
  { value: 100000006, label: 'System' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  notifications: Cgmp_notifications[];
  loading: boolean;
  unreadCount: number;
  onRefresh: () => void;
}

interface CardProps {
  n: Cgmp_notifications;
  pinned: Set<string>;
  onPin: (id: string) => void;
  onMarkRead: (id: string) => void;
  onSnooze: (id: string, h: number) => void;
  onDismiss: (id: string) => void;
  working: Set<string>;
}

function NotifCard({ n, pinned, onPin, onMarkRead, onSnooze, onDismiss, working }: CardProps) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const snoozeRef = useRef<HTMLDivElement>(null);
  const pCode = n.cgmp_priority as unknown as number;
  const cCode = n.cgmp_category as unknown as number;
  const pri = PRI_CONFIG[pCode] ?? PRI_CONFIG[100000002];
  const isPinned = pinned.has(n.cgmp_notificationid);
  const isWorking = working.has(n.cgmp_notificationid);
  const isSnoozed = !!(n.cgmp_snoozeduntil && new Date(n.cgmp_snoozeduntil) > new Date());

  useEffect(() => {
    if (!snoozeOpen) return;
    const handler = (e: MouseEvent) => {
      if (snoozeRef.current && !snoozeRef.current.contains(e.target as Node)) setSnoozeOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [snoozeOpen]);

  return (
    <div className={`np2-card${!n.cgmp_isread ? ' np2-card--unread' : ''}${isPinned ? ' np2-card--pinned' : ''}`}>
      <div className="np2-card__bar" style={{ background: pri.barColor }} />
      <div className="np2-card__body">
        <div className="np2-card__meta">
          <span className="np2-card__cat-chip" style={{ background: CAT_COLOR[cCode] + '18', color: CAT_COLOR[cCode] }}>
            {CAT_LABEL[cCode] ?? 'System'}
          </span>
          <span className="np2-card__pri-badge" style={{ background: pri.badgeBg, color: pri.badgeColor }}>{pri.label}</span>
          {!n.cgmp_isread && <span className="np2-card__dot" />}
          {isSnoozed && <span className="np2-card__snooze-tag">Snoozed</span>}
          <span className="np2-card__time" title={fullDate(n.createdon)}>{timeAgo(n.createdon)}</span>
        </div>
        <div className={`np2-card__title${!n.cgmp_isread ? ' np2-card__title--unread' : ''}`}>{n.cgmp_title}</div>
        {n.cgmp_message && <div className="np2-card__msg">{n.cgmp_message}</div>}
        {n.cgmp_acknowledgedby && (
          <div className="np2-card__ack">Acknowledged by {n.cgmp_acknowledgedby}</div>
        )}
        <div className="np2-card__actions">
          {!n.cgmp_isread && (
            <button className="np2-card__action" onClick={() => onMarkRead(n.cgmp_notificationid)} disabled={isWorking} title="Mark as read">
              Mark Read
            </button>
          )}
          <button
            className={`np2-card__action${isPinned ? ' np2-card__action--active' : ''}`}
            onClick={() => onPin(n.cgmp_notificationid)}
            title={isPinned ? 'Unpin' : 'Pin'}
          >
            {isPinned ? 'Unpin' : 'Pin'}
          </button>
          <div className="np2-snooze-wrap" ref={snoozeRef}>
            <button className="np2-card__action" onClick={() => setSnoozeOpen(o => !o)} disabled={isWorking}>Snooze</button>
            {snoozeOpen && (
              <div className="np2-snooze-menu">
                {[1, 4, 24].map(h => (
                  <button key={h} className="np2-snooze-opt" onClick={() => { onSnooze(n.cgmp_notificationid, h); setSnoozeOpen(false); }}>
                    {h === 1 ? '1 hour' : h === 4 ? '4 hours' : '24 hours'}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="np2-card__action np2-card__action--danger" onClick={() => onDismiss(n.cgmp_notificationid)} disabled={isWorking} title="Dismiss">
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NotificationPanel({ open, onClose, notifications, loading, unreadCount, onRefresh }: Props) {
  const { navigate } = useApp();
  const [tab, setTab] = useState<'all' | 'unread' | 'high' | 'pinned'>('all');
  const [catFilter, setCatFilter] = useState(-1);
  const [search, setSearch] = useState('');
  const [pinned, setPinned] = useState<Set<string>>(() => loadPinned());
  const [working, setWorking] = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);

  const setW = (id: string, on: boolean) => setWorking(prev => { const s = new Set(prev); if (on) s.add(id); else s.delete(id); return s; });

  const handlePin = useCallback((id: string) => {
    setPinned(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); savePinned(s); return s; });
  }, []);

  const handleMarkRead = useCallback(async (id: string) => {
    setW(id, true);
    try { await Cgmp_notificationsService.update(id, { cgmp_isread: true }); onRefresh(); } catch { /* non-fatal */ } finally { setW(id, false); }
  }, [onRefresh]);

  const handleSnooze = useCallback(async (id: string, hours: number) => {
    setW(id, true);
    try {
      await Cgmp_notificationsService.update(id, { cgmp_snoozeduntil: new Date(Date.now() + hours * 3600000).toISOString() });
      onRefresh();
    } catch { /* non-fatal */ } finally { setW(id, false); }
  }, [onRefresh]);

  const handleDismiss = useCallback(async (id: string) => {
    setW(id, true);
    try { await Cgmp_notificationsService.update(id, { cgmp_isdismissed: true }); onRefresh(); } catch { /* non-fatal */ } finally { setW(id, false); }
  }, [onRefresh]);

  const handleMarkAllRead = useCallback(async () => {
    setBulkWorking(true);
    try {
      await Promise.all(notifications.filter(n => !n.cgmp_isread).map(n => Cgmp_notificationsService.update(n.cgmp_notificationid, { cgmp_isread: true })));
      onRefresh();
    } catch { /* non-fatal */ } finally { setBulkWorking(false); }
  }, [notifications, onRefresh]);

  const visible = useMemo(() => {
    let list = notifications.filter(n => !n.cgmp_isdismissed);
    if (tab === 'unread') list = list.filter(n => !n.cgmp_isread && (!n.cgmp_snoozeduntil || new Date(n.cgmp_snoozeduntil) <= new Date()));
    else if (tab === 'high') list = list.filter(n => (n.cgmp_priority as unknown as number) === 100000000);
    else if (tab === 'pinned') list = list.filter(n => pinned.has(n.cgmp_notificationid));
    if (catFilter >= 0) list = list.filter(n => (n.cgmp_category as unknown as number) === catFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(n => n.cgmp_title?.toLowerCase().includes(q) || n.cgmp_message?.toLowerCase().includes(q));
    }
    return list;
  }, [notifications, tab, catFilter, search, pinned]);

  const pinnedItems = useMemo(() => visible.filter(n => pinned.has(n.cgmp_notificationid)), [visible, pinned]);
  const unpinnedItems = useMemo(() => visible.filter(n => !pinned.has(n.cgmp_notificationid)), [visible, pinned]);

  const grouped = useMemo(() => {
    const groups: Record<string, Cgmp_notifications[]> = { today: [], yesterday: [], week: [], earlier: [] };
    unpinnedItems.forEach(n => groups[getGroup(n.createdon)].push(n));
    return groups;
  }, [unpinnedItems]);

  const highCount = notifications.filter(n => !n.cgmp_isread && (n.cgmp_priority as unknown as number) === 100000000).length;
  const pinnedCount = pinned.size;

  const TAB_ITEMS = [
    { id: 'all' as const, label: `All${notifications.length > 0 ? ` (${notifications.filter(n => !n.cgmp_isdismissed).length})` : ''}` },
    { id: 'unread' as const, label: `Unread${unreadCount > 0 ? ` (${unreadCount})` : ''}` },
    { id: 'high' as const, label: `High${highCount > 0 ? ` (${highCount})` : ''}` },
    { id: 'pinned' as const, label: `Pinned${pinnedCount > 0 ? ` (${pinnedCount})` : ''}` },
  ];

  const subtitleParts = [
    unreadCount > 0 ? `${unreadCount} unread` : null,
    highCount > 0 ? `${highCount} high priority` : null,
    pinnedCount > 0 ? `${pinnedCount} pinned` : null,
  ].filter(Boolean);

  return (
    <SlidePanel
      open={open}
      onClose={onClose}
      title="Notifications"
      subtitle={subtitleParts.length > 0 ? subtitleParts.join(' · ') : 'All caught up'}
      width={480}
      footer={
        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
          {unreadCount > 0 && (
            <button className="btn btn--outline" style={{ flex: 1 }} onClick={handleMarkAllRead} disabled={bulkWorking}>
              Mark All Read
            </button>
          )}
          <button
            className="btn btn--primary"
            style={{ flex: 1 }}
            onClick={() => { navigate('notification-center'); onClose(); }}
          >
            View All
          </button>
        </div>
      }
    >
      {/* Tabs */}
      <div className="np2-tabs" role="tablist" aria-label="Notification filter">
        {TAB_ITEMS.map(t => (
          <button key={t.id} className={`np2-tab${tab === t.id ? ' np2-tab--active' : ''}`} onClick={() => setTab(t.id)} role="tab" aria-selected={tab === t.id}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ padding: '8px 16px 0' }}>
        <input
          className="np2-search-input"
          type="search"
          placeholder="Search notifications…"
          aria-label="Search notifications"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Category chips */}
      <span id="np-cat-chips-label" className="visually-hidden">Filter notifications by category</span>
      <div className="np2-cat-chips" role="group" aria-describedby="np-cat-chips-label">
        {CAT_ENTRIES.map(c => (
          <button
            key={c.value}
            className={`np2-cat-chip${catFilter === c.value ? ' np2-cat-chip--active' : ''}`}
            onClick={() => setCatFilter(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="np2-list">
        {loading ? (
          [0, 1, 2].map(i => (
            <div key={i} className="np2-loading-card">
              <div className="skeleton" style={{ height: 12, width: '40%', marginBottom: 6 }} />
              <div className="skeleton" style={{ height: 14, width: '75%', marginBottom: 4 }} />
              <div className="skeleton" style={{ height: 11, width: '55%' }} />
            </div>
          ))
        ) : visible.length === 0 ? (
          <div className="np2-empty">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>
            <p>No notifications here</p>
          </div>
        ) : (
          <>
            {pinnedItems.length > 0 && (
              <div>
                <div className="np2-group-label np2-group-label--pinned">Pinned</div>
                {pinnedItems.map(n => (
                  <NotifCard key={n.cgmp_notificationid} n={n} pinned={pinned} onPin={handlePin} onMarkRead={handleMarkRead} onSnooze={handleSnooze} onDismiss={handleDismiss} working={working} />
                ))}
              </div>
            )}
            {GROUP_ORDER.map(g => grouped[g].length > 0 && (
              <div key={g}>
                <div className="np2-group-label">{GROUP_LABEL[g]} <span className="np2-group-count">({grouped[g].length})</span></div>
                {grouped[g].map(n => (
                  <NotifCard key={n.cgmp_notificationid} n={n} pinned={pinned} onPin={handlePin} onMarkRead={handleMarkRead} onSnooze={handleSnooze} onDismiss={handleDismiss} working={working} />
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </SlidePanel>
  );
}
