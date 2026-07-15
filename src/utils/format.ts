/** Shared formatting utilities — single canonical source for all date/number formatting */

const TZ_KEY = 'cgmp-display-tz';

let _tzCache: string | null = null;

export function getDisplayTimezone(): string {
  if (_tzCache !== null) return _tzCache;
  try {
    const stored = localStorage.getItem(TZ_KEY);
    _tzCache = stored || Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    _tzCache = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
  return _tzCache;
}

export function setDisplayTimezone(tz: string): void {
  _tzCache = tz;
  try { localStorage.setItem(TZ_KEY, tz); } catch { /* ignore */ }
}

/** Format an ISO datetime in the user's selected display timezone */
export function formatInTz(iso: string | undefined | null, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const tz = getDisplayTimezone();
  try {
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
      timeZone: tz, timeZoneName: 'short',
      ...opts,
    });
  } catch {
    const fallbackTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
      timeZone: fallbackTz, timeZoneName: 'short',
      ...opts,
    });
  }
}

export function fmtDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const tz = getDisplayTimezone();
  try {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz });
  } catch {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

export function fmtDateTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const tz = getDisplayTimezone();
  try {
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz });
  } catch {
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
}

export function fmtDateTimeShort(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const tz = getDisplayTimezone();
  try {
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz });
  } catch {
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
}

export function fmtDuration(minutes: number | undefined | null): string {
  if (minutes == null || isNaN(minutes) || minutes < 0) return '—';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function fmtPercent(value: number, decimals = 1): string {
  if (isNaN(value)) return '—';
  return `${value.toFixed(decimals)}%`;
}

export function fmtNumber(value: number | undefined | null): string {
  if (value == null || isNaN(value)) return '—';
  return value.toLocaleString('en-US');
}

/** Parse a datetime-local string to a Date; returns null on invalid input */
export function parseDatetimeLocal(s: string | undefined | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** True if ISO string represents a date in the future */
export function isFuture(iso: string | undefined | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return !isNaN(d.getTime()) && d > new Date();
}

/** Returns browser + OS identifier derived from navigator.userAgent */
export function getBrowserInfo(): string {
  const ua = navigator.userAgent;
  let browser = 'Browser';
  if (ua.includes('Edg')) browser = 'Edge';
  else if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Safari')) browser = 'Safari';
  let os = '';
  if (ua.includes('Windows NT')) os = 'Windows';
  else if (ua.includes('Mac OS X')) os = 'macOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';
  else if (ua.includes('Linux')) os = 'Linux';
  return os ? `${browser} / ${os}` : browser;
}

export function fmtShortDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const tz = getDisplayTimezone();
  try {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: tz });
  } catch {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  }
}

export function isToday(iso: string | undefined | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export function timeAgo(iso: string | undefined): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  const h = Math.floor(ms / 3600000);
  const d = Math.floor(ms / 86400000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: getDisplayTimezone() });
}

/**
 * Returns true only if the URL is a valid Microsoft Teams meeting link.
 * Guards render sites that produce clickable <a href> tags to prevent
 * arbitrary or malformed URLs from being rendered as trusted links.
 */
export function isValidTeamsUrl(url: string | null | undefined): boolean {
  return !!url && url.startsWith('https://teams.microsoft.com/');
}
