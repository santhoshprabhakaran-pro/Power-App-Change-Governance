/** Shared CSV utilities — proper RFC 4180 parser and exporter */

/** Parse a full CSV string into an array of row arrays.
 *  Handles quoted fields that contain embedded newlines (RFC 4180 §2.6). */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  let row: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '"') {
      if (inQuotes && normalized[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      row.push(current);
      current = '';
    } else if (ch === '\n' && !inQuotes) {
      row.push(current);
      current = '';
      if (row.some(f => f.trim())) rows.push(row);
      row = [];
    } else {
      current += ch;
    }
  }
  row.push(current);
  if (row.some(f => f.trim())) rows.push(row);

  return rows;
}

/** Escape a value for CSV output */
function escapeCSV(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Column header patterns that contain personally identifiable information */
const PII_COLUMN_PATTERNS = [
  /upn/i, /email/i, /owner/i, /reviewer/i, /signoff/i, /createdby/i, /modifiedby/i,
  /lockedby/i, /approvedby/i, /reviewedby/i, /assignedto/i, /acknowledgedby/i,
];

function isPiiColumn(header: string): boolean {
  return PII_COLUMN_PATTERNS.some(p => p.test(header));
}

/** Trigger a browser download of a CSV file.
 *  @param options.redactPii  When true, values in PII-matched columns are replaced with
 *                            `[REDACTED]` and a compliance comment is prepended. Default: false. */
export function exportCSV(
  filename: string,
  headers: string[],
  rows: string[][],
  options?: { redactPii?: boolean },
): void {
  const redact = options?.redactPii ?? false;

  const piiFlags = headers.map(h => redact && isPiiColumn(h));

  const redactedRows = rows.map(row =>
    row.map((cell, i) => (piiFlags[i] ? '[REDACTED]' : cell)),
  );

  const dataLines = [headers, ...redactedRows].map(row => row.map(escapeCSV).join(','));
  const commentLine = '# PII fields redacted for export compliance';
  const body = redact ? [commentLine, ...dataLines].join('\r\n') : dataLines.join('\r\n');

  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  try { a.click(); } finally {
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }
}
