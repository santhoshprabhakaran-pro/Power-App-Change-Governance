/** Pure business-logic utilities — no React dependencies */

import { STATUS } from './roles';
import type { Cgmp_changes } from '../generated/models/Cgmp_changesModel';

/* ── UAT Freeze helpers ─────────────────────────────────────────────
   ISM freeze  : startTime − 3 days  (ISMs cannot edit after this)
   IT Ops freeze: startTime − 2 days  (IT Ops should lock by this)  */

export function ismFreezeDate(startTime: string): Date {
  const d = new Date(startTime);
  d.setDate(d.getDate() - 3);
  return d;
}

export function itopsFreezeDate(startTime: string): Date {
  const d = new Date(startTime);
  d.setDate(d.getDate() - 2);
  return d;
}

export function isIsmFrozen(startTime: string | undefined): boolean {
  return !!startTime && new Date() >= ismFreezeDate(startTime);
}

export function daysUntilIsmFreeze(startTime: string): number {
  return Math.ceil((ismFreezeDate(startTime).getTime() - Date.now()) / 86400000);
}

/** Count changes with a given status code */
export function countStatus(arr: Cgmp_changes[], code: number): number {
  return arr.filter(c => (c.cgmp_status as unknown as number) === code).length;
}

/** Compute SLA compliance percentage (completed / (completed + failed)) */
export function calcSLA(arr: Cgmp_changes[]): number {
  const comp = countStatus(arr, STATUS.Completed);
  const fail = countStatus(arr, STATUS.Failed);
  const total = comp + fail;
  return total > 0 ? Math.round((comp / total) * 1000) / 10 : 100;
}

/** Compute ISM health score (0–100) for a project based on SLA, failures, and UAT contacts */
export function computeHealthScore(sla: number, failCount: number, hasUatContacts: boolean): number {
  let score = 100;
  score -= (100 - sla) * 0.4;
  score -= Math.min(failCount * 5, 30);
  if (!hasUatContacts) score -= 15;
  return Math.max(0, Math.round(score));
}

const VERSION_HISTORY_CAP = 500;
const VERSION_HISTORY_TRIM_TO = 450;

/** Append an entry to a JSON version-history string, capping at 500 entries. */
export function appendHistory(existing: string | undefined, entry: unknown): string {
  let hist: unknown[] = [];
  try { const p = JSON.parse(existing ?? '[]'); if (Array.isArray(p)) hist = p; } catch {}
  if (hist.length >= VERSION_HISTORY_CAP) {
    if (import.meta.env.DEV) {
      console.warn(`[CGMP] Version history cap reached (${VERSION_HISTORY_CAP}) — oldest entries will be trimmed`);
    }
    hist = hist.slice(hist.length - VERSION_HISTORY_TRIM_TO);
  }
  hist.push(entry);
  return JSON.stringify(hist);
}

export const SLA_THRESHOLDS_MINUTES = {
  Emergency: 240,
  CriticalInfrastructure: 1440,
  Standard: 4320,
  Minor: 10080,
} as const;

export function getSlaBreach(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
  thresholdMinutes: number
): boolean {
  if (!startTime || !endTime) return false;
  const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();
  return durationMs / 60000 > thresholdMinutes;
}

/** Human-readable "due in X" or "Overdue" string */
export function formatDueDelta(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const target = new Date(dateStr).getTime();
  const diff = target - Date.now();
  if (diff <= 0) return 'Overdue';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  if (d > 0) return `Due in ${d}d ${h}h`;
  if (h > 0) return `Due in ${h}h`;
  const m = Math.floor((diff % 3600000) / 60000);
  return `Due in ${m}m`;
}
