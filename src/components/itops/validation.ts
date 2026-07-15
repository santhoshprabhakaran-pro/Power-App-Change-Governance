import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';

export type ValidationSeverity = 'pass' | 'warning' | 'error';

export interface ValidationResult {
  field: string;
  message: string;
  severity: ValidationSeverity;
}

export function validateForReview(change: Cgmp_changes, allChanges: Cgmp_changes[]): ValidationResult[] {
  const results: ValidationResult[] = [];

  const check = (
    condition: boolean,
    field: string,
    passMsg: string,
    failMsg: string,
    severity: ValidationSeverity = 'error',
  ) => results.push({ field, severity: condition ? 'pass' : severity, message: condition ? passMsg : failMsg });

  check(!!change.cgmp_title?.trim(), 'title', 'Title is present', 'Title is missing');
  check(change.cgmp_category !== undefined && change.cgmp_category !== null, 'category', 'Category is set', 'Category is missing');
  check(change.cgmp_risklevel !== undefined && change.cgmp_risklevel !== null, 'risk', 'Risk level is set', 'Risk level is missing');
  check(change.cgmp_impactlevel !== undefined && change.cgmp_impactlevel !== null, 'impact', 'Impact level is set', 'Impact level is missing');
  check(!!change.cgmp_starttime, 'starttime', 'Start time is set', 'Start time is missing');
  check(!!change.cgmp_endtime, 'endtime', 'End time is set', 'End time is missing');

  if (change.cgmp_starttime && change.cgmp_endtime) {
    check(
      new Date(change.cgmp_starttime) < new Date(change.cgmp_endtime),
      'timeorder', 'Start time is before end time', 'Start time must be before end time',
    );
  }

  const duplicates = allChanges.filter(
    c => c.cgmp_changenumber === change.cgmp_changenumber && c.cgmp_changeid !== change.cgmp_changeid,
  );
  check(duplicates.length === 0, 'duplicate', 'Change number is unique', `Duplicate change number found (${duplicates.length} match)`);

  /* Non-blocking warning for missing UAT users */
  const hasUAT = !!change.cgmp_uatusers?.trim();
  results.push({
    field: 'uatusers',
    severity: hasUAT ? 'pass' : 'warning',
    message: hasUAT ? 'UAT users are defined' : 'No UAT users defined (recommended)',
  });

  return results;
}

export function hasBlockingErrors(results: ValidationResult[]): boolean {
  return results.some(r => r.severity === 'error');
}
