/** Shared formatting utilities — single canonical source for all date/number formatting */

import { formatDistanceToNow, isToday as isTodayFns, parseISO, differenceInMinutes } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

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
  try {
    localStorage.setItem(TZ_KEY, tz);
  } catch {
    /* ignore */
  }
}

/** Format an ISO datetime in the user's selected display timezone */
export function formatInTz(iso: string | undefined | null, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const tz = getDisplayTimezone();
  try {
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
      timeZoneName: 'short',
      ...opts,
    });
  } catch {
    const fallbackTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: fallbackTz,
      timeZoneName: 'short',
      ...opts,
    });
  }
}

export function fmtDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  try {
    return formatInTimeZone(parseISO(iso), getDisplayTimezone(), 'dd MMM yyyy');
  } catch {
    return iso;
  }
}

export function fmtDateTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  try {
    return formatInTimeZone(parseISO(iso), getDisplayTimezone(), 'dd MMM yyyy, HH:mm');
  } catch {
    return iso;
  }
}

export function fmtDateTimeShort(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const tz = getDisplayTimezone();
  try {
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    });
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
  try {
    return isTodayFns(parseISO(iso));
  } catch {
    return false;
  }
}

export function timeAgo(iso: string | undefined): string {
  if (!iso) return '';
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

/** Returns the number of hours between two ISO datetime strings (end − start). */
export function durationHours(startIso: string, endIso: string): number {
  try {
    return differenceInMinutes(parseISO(endIso), parseISO(startIso)) / 60;
  } catch {
    return 0;
  }
}

/**
 * Returns true only if the URL is a valid Microsoft Teams meeting link.
 * Guards render sites that produce clickable <a href> tags to prevent
 * arbitrary or malformed URLs from being rendered as trusted links.
 */
export function isValidTeamsUrl(url: string | null | undefined): boolean {
  return !!url && url.startsWith('https://teams.microsoft.com/');
}

/**
 * Escapes HTML special characters in a raw string to prevent XSS at
 * dangerouslySetInnerHTML render sites where content is user-supplied.
 * Preserves the text as-is — callers may additionally replace \n with <br>.
 */
export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
