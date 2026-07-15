/** Shared notification utilities — single canonical source for both NotificationCenter and NotificationPanel */

export const PINNED_KEY = 'cgmp-pinned-notifs2';

export function loadPinned(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}

export function savePinned(s: Set<string>): void {
  try { localStorage.setItem(PINNED_KEY, JSON.stringify([...s])); } catch {}
}

export const CAT_LABEL: Record<number, string> = {
  100000000: 'Review Request', 100000001: 'UAT Reminder', 100000002: 'Escalation',
  100000003: 'GIICC Handover', 100000004: 'Closure', 100000005: 'Emergency', 100000006: 'System',
};

export const CAT_COLOR: Record<number, string> = {
  100000000: 'var(--primary)',        100000001: '#d97706',
  100000002: 'var(--danger)',         100000003: '#7c3aed',
  100000004: 'var(--success)',        100000005: 'var(--danger)',
  100000006: 'var(--text-tertiary)',
};

export const PRIORITY_CONFIG: Record<number, { label: string; barColor: string; badgeBg: string; badgeColor: string }> = {
  100000000: { label: 'High',   barColor: 'var(--danger)',  badgeBg: 'var(--danger-faint, #fee2e2)',   badgeColor: 'var(--danger)'  },
  100000001: { label: 'Medium', barColor: '#d97706',        badgeBg: 'var(--warning-faint, #fffbeb)', badgeColor: '#d97706'        },
  100000002: { label: 'Low',    barColor: 'var(--primary)', badgeBg: 'var(--primary-faint, #eff6ff)', badgeColor: 'var(--primary)' },
};

export { timeAgo, fmtDateTime as fullDate } from './format';

export function getGroup(iso: string | undefined): 'today' | 'yesterday' | 'week' | 'earlier' {
  if (!iso) return 'earlier';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return 'week';
  return 'earlier';
}

export const GROUP_LABEL: Record<string, string> = {
  today: 'Today', yesterday: 'Yesterday', week: 'This Week', earlier: 'Earlier',
};

export const GROUP_ORDER = ['today', 'yesterday', 'week', 'earlier'] as const;
