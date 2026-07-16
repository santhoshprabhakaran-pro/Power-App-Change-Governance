/** Shared notification utilities — single canonical source for both NotificationCenter and NotificationPanel */

export const PINNED_KEY = 'cgmp-pinned-notifs2';

export function loadPinned(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function savePinned(s: Set<string>): void {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify([...s]));
  } catch {}
}

export const CAT_LABEL: Record<number, string> = {
  100000000: 'Review Request',
  100000001: 'UAT Reminder',
  100000002: 'Escalation',
  100000003: 'GIICC Handover',
  100000004: 'Closure',
  100000005: 'Emergency',
  100000006: 'System',
};

export const CAT_COLOR: Record<number, string> = {
  100000000: 'var(--primary)',
  100000001: '#d97706',
  100000002: 'var(--danger)',
  100000003: '#7c3aed',
  100000004: 'var(--success)',
  100000005: 'var(--danger)',
  100000006: 'var(--text-tertiary)',
};

export const PRIORITY_CONFIG: Record<number, { label: string; barColor: string; badgeBg: string; badgeColor: string }> =
  {
    100000000: {
      label: 'High',
      barColor: 'var(--danger)',
      badgeBg: 'var(--danger-faint, #fee2e2)',
      badgeColor: 'var(--danger)',
    },
    100000001: {
      label: 'Medium',
      barColor: '#d97706',
      badgeBg: 'var(--warning-faint, #fffbeb)',
      badgeColor: '#d97706',
    },
    100000002: {
      label: 'Low',
      barColor: 'var(--primary)',
      badgeBg: 'var(--primary-faint, #eff6ff)',
      badgeColor: 'var(--primary)',
    },
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
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This Week',
  earlier: 'Earlier',
};

export const GROUP_ORDER = ['today', 'yesterday', 'week', 'earlier'] as const;

/* ── Category code → NotificationPreferences key mapping ── */
const CAT_PREF_KEY: Record<number, string> = {
  100000000: 'reviewRequest',
  100000001: 'uatReminder',
  100000002: 'escalation',
  100000003: 'giiccHandover',
  100000004: 'closure',
  100000005: 'emergency',
  100000006: 'systemAlerts',
};

/**
 * Returns an ISO string for the end of quiet hours if the current time
 * falls within the recipient's quiet window, otherwise null.
 *
 * quietStart / quietEnd may be a 24-hour integer (0–23) as stored by
 * NotificationPreferences, or an "HH:MM" string.
 */
export function getQuietHoursSnoozedUntil(
  quietStart: number | string | null | undefined,
  quietEnd: number | string | null | undefined
): string | null {
  if (quietStart == null || quietEnd == null) return null;
  const now = new Date();

  const parseHHMM = (val: number | string): [number, number] => {
    if (typeof val === 'number') return [val, 0];
    const parts = val.split(':').map(Number);
    return [parts[0] ?? 0, parts[1] ?? 0];
  };

  const [sh, sm] = parseHHMM(quietStart);
  const [eh, em] = parseHHMM(quietEnd);

  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return null;

  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;
  const nowMins = now.getHours() * 60 + now.getMinutes();

  // Handles both same-day (e.g. 09:00–17:00) and overnight (e.g. 22:00–07:00) spans
  const inWindow =
    startMins < endMins ? nowMins >= startMins && nowMins < endMins : nowMins >= startMins || nowMins < endMins;

  if (!inWindow) return null;

  const endDate = new Date(now);
  endDate.setHours(eh, em, 0, 0);
  if (endDate <= now) endDate.setDate(endDate.getDate() + 1);
  return endDate.toISOString();
}

/**
 * Returns true if the recipient has opted into this notification category.
 * Accepts either the JSON-object format written by NotificationPreferences
 * (e.g. {"reviewRequest":true,"escalation":false}) or a legacy
 * comma-separated list of category codes.
 * If cgmp_notificationcategories is null/empty, all categories are enabled.
 */
export function isNotifCategoryEnabled(userNotifCategories: string | null | undefined, category: number): boolean {
  if (!userNotifCategories?.trim()) return true; // no preference set → all enabled

  // Try JSON object format (NotificationPreferences canonical format)
  try {
    const parsed: unknown = JSON.parse(userNotifCategories);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const prefs = parsed as Record<string, unknown>;
      const key = CAT_PREF_KEY[category];
      if (key === undefined) return true; // unknown category → allow
      // Absent key also means enabled (opt-out model)
      return prefs[key] !== false;
    }
  } catch {
    /* fall through to CSV format */
  }

  // Legacy comma-separated numeric codes
  const enabled = userNotifCategories.split(',').map((s) => parseInt(s.trim(), 10));
  return enabled.includes(category);
}
