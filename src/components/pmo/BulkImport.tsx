import { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog } from '../ui/Modal';
import { getBrowserInfo } from '../../utils/format';
import { useApp } from '../../context/AppContext';
import { Cgmp_changesService, Cgmp_auditlogsService, Cgmp_blackoutperiodsService } from '../../generated';
import type { Cgmp_blackoutperiods } from '../../generated/models/Cgmp_blackoutperiodsModel';
import type { Cgmp_changesBase } from '../../generated/models/Cgmp_changesModel';
import type { Cgmp_changescgmp_status, Cgmp_changescgmp_category, Cgmp_changescgmp_changetype, Cgmp_changescgmp_risklevel, Cgmp_changescgmp_impactlevel } from '../../generated/models/Cgmp_changesModel';
import type { Cgmp_auditlogsBase } from '../../generated/models/Cgmp_auditlogsModel';
import type { Cgmp_auditlogscgmp_entitytype, Cgmp_auditlogscgmp_eventtype } from '../../generated/models/Cgmp_auditlogsModel';
import { CSV_CATEGORY_MAP, CSV_RISK_MAP, CSV_IMPACT_MAP, CSV_TYPE_MAP } from './options';
import { parseCSV as parseCSVUtil } from '../../utils/csv';
import { useChangeList } from '../../hooks/useDataverse';

/* ─── Column definitions ──────────────────────────────────────────── */

const REQUIRED_COLS = ['Title', 'Category', 'ChangeType', 'RiskLevel', 'ImpactLevel', 'StartTime', 'EndTime'];
const OPTIONAL_COLS = ['ChangeNumber', 'Owner', 'ChangePOC', 'Description', 'Location', 'Region', 'Country', 'Facility', 'IsEmergency', 'IsWeekend', 'UATRequired', 'ProjectIds', 'PIRNotes'];
const CSV_COLUMNS = [...REQUIRED_COLS, ...OPTIONAL_COLS];

const CSV_TEMPLATE =
  CSV_COLUMNS.join(',') + '\n' +
  'Test Change,Network,Standard,Low,Low,2026-07-01 08:00,2026-07-01 10:00,CHG-20260701-0001,John Smith,Jane Doe,Brief description,DC1,APAC,India,Building A,no,no,no,PROJ-001,Initial deployment notes';

const FIELD_DESCRIPTIONS: Record<string, string> = {
  Title: 'Required. Brief description of the change.',
  Category: 'Required. One of: ' + Object.keys(CSV_CATEGORY_MAP).join(', '),
  ChangeType: 'Required. One of: ' + Object.keys(CSV_TYPE_MAP).join(', '),
  RiskLevel: 'Required. One of: ' + Object.keys(CSV_RISK_MAP).join(', '),
  ImpactLevel: 'Required. One of: ' + Object.keys(CSV_IMPACT_MAP).join(', '),
  StartTime: 'Required. Format: YYYY-MM-DD HH:MM',
  EndTime: 'Required. Format: YYYY-MM-DD HH:MM — must be after StartTime',
  ChangeNumber: 'Optional. If blank, auto-generated (CHG-IMPORT-timestamp).',
  Owner: 'Optional. Full name of the change owner (e.g., "John Smith").',
  ChangePOC: 'Optional. Full name of the Change Point of Contact.',
  Description: 'Optional. Detailed description.',
  Location: 'Optional. One or more locations comma-separated (e.g., "DC1,DC2").',
  Region: 'Optional. One or more regions comma-separated (e.g., "APAC,EMEA").',
  Country: 'Optional. One or more countries comma-separated (e.g., "India,Singapore").',
  Facility: 'Optional. One or more facilities comma-separated (e.g., "Building A,Building B").',
  IsEmergency: 'Optional. yes/no (default: no).',
  IsWeekend: 'Optional. yes/no (default: no).',
  UATRequired: 'Optional. yes/no (default: no). Indicates whether UAT is required.',
  ProjectIds: 'Optional. Comma-separated project IDs to link (e.g., "PROJ-001,PROJ-002").',
  PIRNotes: 'Optional. Post-implementation review notes.',
};

function parseBool(val: string | undefined): boolean {
  if (!val) return false;
  const v = val.trim().toLowerCase();
  return v === 'yes' || v === 'true' || v === '1';
}

/* ─── Types ──────────────────────────────────────────────────────── */

interface ParsedRow {
  raw: Record<string, string>;
  errors: string[];
  warnings: string[];
  valid: boolean;
}

type Step = 'upload' | 'preview' | 'importing' | 'done';

/* ─── Parser ──────────────────────────────────────────────────────── */

function parseRows(text: string): ParsedRow[] {
  const allRows = parseCSVUtil(text);
  if (allRows.length < 2) return [];

  const headerRow = allRows[0] ?? [];
  const dataRows = allRows.slice(1).filter(r => r.some(c => c.trim()));

  return dataRows.map(cols => {
    const raw: Record<string, string> = {};
    headerRow.forEach((h, i) => { raw[h.trim()] = (cols[i] ?? '').trim(); });

    const errors: string[] = [];

    if (!raw.Title) errors.push('Title is required');

    if (!raw.Category || !CSV_CATEGORY_MAP[raw.Category.toLowerCase()])
      errors.push(`Invalid Category "${raw.Category}" — must be one of: ${Object.keys(CSV_CATEGORY_MAP).join(', ')}`);
    if (!raw.ChangeType || !CSV_TYPE_MAP[raw.ChangeType.toLowerCase()])
      errors.push(`Invalid ChangeType "${raw.ChangeType}" — must be one of: ${Object.keys(CSV_TYPE_MAP).join(', ')}`);
    if (!raw.RiskLevel || !CSV_RISK_MAP[raw.RiskLevel.toLowerCase()])
      errors.push(`Invalid RiskLevel "${raw.RiskLevel}" — must be one of: ${Object.keys(CSV_RISK_MAP).join(', ')}`);
    if (!raw.ImpactLevel || !CSV_IMPACT_MAP[raw.ImpactLevel.toLowerCase()])
      errors.push(`Invalid ImpactLevel "${raw.ImpactLevel}" — must be one of: ${Object.keys(CSV_IMPACT_MAP).join(', ')}`);

    const startDate = raw.StartTime ? new Date(raw.StartTime) : null;
    const endDate = raw.EndTime ? new Date(raw.EndTime) : null;
    if (!raw.StartTime || !startDate || isNaN(startDate.getTime()))
      errors.push('Invalid StartTime — use format: YYYY-MM-DD HH:MM');
    if (!raw.EndTime || !endDate || isNaN(endDate.getTime()))
      errors.push('Invalid EndTime — use format: YYYY-MM-DD HH:MM');
    if (startDate && !isNaN(startDate.getTime()) && endDate && !isNaN(endDate.getTime()) && startDate >= endDate)
      errors.push('EndTime must be after StartTime');

    if (raw.IsEmergency && !['yes', 'no', 'true', 'false', '1', '0', ''].includes(raw.IsEmergency.toLowerCase()))
      errors.push(`Invalid IsEmergency "${raw.IsEmergency}" — use yes or no`);
    if (raw.IsWeekend && !['yes', 'no', 'true', 'false', '1', '0', ''].includes(raw.IsWeekend.toLowerCase()))
      errors.push(`Invalid IsWeekend "${raw.IsWeekend}" — use yes or no`);

    return { raw, errors, warnings: [], valid: errors.length === 0 };
  });
}

interface ImportResult { success: number; failed: number; errors: string[]; }

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export default function BulkImport({ open, onClose, onImported }: Props) {
  const { showToast, currentUserName, currentUserUpn } = useApp();
  const { changes: existingChanges } = useChangeList();
  const [step, setStep] = useState<Step>('upload');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [showFieldDocs, setShowFieldDocs] = useState(false);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [blackoutPeriods, setBlackoutPeriods] = useState<Cgmp_blackoutperiods[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    Cgmp_blackoutperiodsService.getAll({ top: 100 }).then(r => setBlackoutPeriods(r.data ?? [])).catch(() => {});
  }, [open]);

  const reset = useCallback(() => {
    setStep('upload');
    setRows([]);
    setCsvText('');
    setFileName('');
    setResult(null);
    setProgress(0);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const MAX_CSV_SIZE = 5 * 1024 * 1024; // 5 MB
    if (file.size > MAX_CSV_SIZE) {
      showToast('error', 'File is too large. Maximum size is 5 MB.');
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = ev => { setCsvText(ev.target?.result as string ?? ''); };
    reader.readAsText(file);
  }, [showToast]);

  const handleParse = useCallback(() => {
    const parsed = parseRows(csvText);
    if (parsed.length === 0) { showToast('error', 'No valid rows found. Check CSV format.'); return; }
    const existingNumbers = new Set(existingChanges.map(c => c.cgmp_changenumber).filter(Boolean));
    const withDupes = parsed.map(row => {
      const num = row.raw.ChangeNumber?.trim();
      if (num && existingNumbers.has(num)) {
        return { ...row, warnings: [`Change number "${num}" already exists — will create a duplicate`] };
      }
      return row;
    });
    const withAll = withDupes.map((row, i) => {
      if (!row.raw.StartTime || !row.raw.EndTime) return row;
      const rowStart = new Date(row.raw.StartTime).getTime();
      const rowEnd = new Date(row.raw.EndTime).getTime();
      if (isNaN(rowStart) || isNaN(rowEnd)) return row;
      const extra: string[] = [];
      for (const bp of blackoutPeriods) {
        const bpStart = new Date((bp as any).cgmp_startdate).getTime();
        const bpEnd = new Date((bp as any).cgmp_enddate).getTime();
        if (rowStart < bpEnd && rowEnd > bpStart) {
          extra.push(`Falls in blackout "${(bp as any).cgmp_name ?? 'Unnamed'}"`);
          break;
        }
      }
      for (let j = 0; j < i; j++) {
        const other = withDupes[j];
        if (!other.raw.StartTime || !other.raw.EndTime || !other.valid) continue;
        if (other.raw.Location && row.raw.Location && other.raw.Location !== row.raw.Location) continue;
        const otherStart = new Date(other.raw.StartTime).getTime();
        const otherEnd = new Date(other.raw.EndTime).getTime();
        if (rowStart < otherEnd && rowEnd > otherStart) {
          extra.push(`Time conflict with row ${j + 1}`);
          break;
        }
      }
      if (extra.length === 0) return row;
      return { ...row, warnings: [...row.warnings, ...extra] };
    });
    setRows(withAll);
    setStep('preview');
  }, [csvText, showToast, existingChanges, blackoutPeriods]);

  const handleImport = useCallback(async () => {
    const validRows = rows.filter(r => r.valid && !(skipDuplicates && r.warnings.length > 0));
    if (validRows.length === 0) return;

    setStep('importing');
    setProgress(0);

    let success = 0;
    const importErrors: string[] = [];

    for (let i = 0; i < validRows.length; i++) {
      const r = validRows[i].raw;
      try {
        const createResult = await Cgmp_changesService.create({
          cgmp_changenumber: r.ChangeNumber || `CHG-IMPORT-${Date.now()}-${i}`,
          cgmp_title: r.Title,
          cgmp_category: CSV_CATEGORY_MAP[r.Category.toLowerCase()] as unknown as Cgmp_changescgmp_category,
          cgmp_changetype: CSV_TYPE_MAP[r.ChangeType.toLowerCase()] as unknown as Cgmp_changescgmp_changetype,
          cgmp_risklevel: CSV_RISK_MAP[r.RiskLevel.toLowerCase()] as unknown as Cgmp_changescgmp_risklevel,
          cgmp_impactlevel: CSV_IMPACT_MAP[r.ImpactLevel.toLowerCase()] as unknown as Cgmp_changescgmp_impactlevel,
          cgmp_starttime: new Date(r.StartTime).toISOString(),
          cgmp_endtime: new Date(r.EndTime).toISOString(),
          cgmp_createdby: r.Owner || undefined,
          cgmp_description: r.Description || undefined,
          cgmp_location: r.Location || undefined,
          cgmp_region: r.Region || undefined,
          cgmp_country: r.Country || undefined,
          cgmp_facility: r.Facility || undefined,
          cgmp_isemergency: parseBool(r.IsEmergency),
          cgmp_isweekend: parseBool(r.IsWeekend),
          cgmp_uatrequired: parseBool(r.UATRequired),
          cgmp_changepoc: r.ChangePOC || undefined,
          cgmp_projectids: r.ProjectIds || undefined,
          cgmp_pirnotes: r.PIRNotes || undefined,
          cgmp_status: 100000000 as unknown as Cgmp_changescgmp_status,
        } as unknown as Omit<Cgmp_changesBase, 'cgmp_changeid'>);
        if (!createResult.success) throw createResult.error ?? new Error('Dataverse rejected the record');
        success++;
      } catch (err) {
        importErrors.push(`Row ${i + 1} (${r.Title}): ${err instanceof Error ? err.message : 'Failed'}`);
      }
      setProgress(Math.round(((i + 1) / validRows.length) * 100));
    }

    const res = { success, failed: validRows.length - success, errors: importErrors };
    setResult(res);
    setStep('done');

    Cgmp_auditlogsService.create({
      cgmp_auditlogname: `Bulk Import — ${success}/${validRows.length} rows imported`,
      cgmp_entitytype: 100000000 as unknown as Cgmp_auditlogscgmp_entitytype,
      cgmp_eventtype: 100000003 as unknown as Cgmp_auditlogscgmp_eventtype,
      cgmp_entityid: 'bulk-import',
      cgmp_entityname: 'Bulk Import',
      cgmp_username: currentUserName,
      cgmp_useremail: currentUserUpn,
      cgmp_ipaddress: getBrowserInfo(),
      cgmp_newvalues: JSON.stringify({ success, failed: res.failed, total: validRows.length, importedBy: currentUserName, file: fileName || 'pasted' }),
    } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch(err => { if (import.meta.env.DEV) console.error('Audit log failed:', err); });

    if (success > 0) { showToast('success', `Imported ${success} change${success > 1 ? 's' : ''} successfully`); onImported(); }
    if (res.failed > 0) { showToast('error', `${res.failed} row${res.failed > 1 ? 's' : ''} failed to import`); }
  }, [rows, showToast, onImported, currentUserName]);

  const downloadTemplate = useCallback(() => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'change_import_template.csv'; a.click();
    URL.revokeObjectURL(url);
  }, []);

  const dupeCount = rows.filter(r => r.warnings.length > 0).length;
  const validCount = rows.filter(r => r.valid && !(skipDuplicates && r.warnings.length > 0)).length;
  const invalidCount = rows.length - rows.filter(r => r.valid).length;

  const footerContent = (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
      <button className="btn btn--outline btn--sm" onClick={handleClose}>{step === 'done' ? 'Close' : 'Cancel'}</button>
      <div style={{ display: 'flex', gap: 8 }}>
        {step === 'preview' && <button className="btn btn--outline btn--sm" onClick={() => setStep('upload')}>← Back</button>}
        {step === 'upload' && <button className="btn btn--primary btn--sm" onClick={handleParse} disabled={!csvText.trim()}>Preview →</button>}
        {step === 'preview' && <button className="btn btn--primary btn--sm" onClick={handleImport} disabled={validCount === 0}>Import {validCount} Change{validCount !== 1 ? 's' : ''}</button>}
        {step === 'done' && <button className="btn btn--outline btn--sm" onClick={reset}>Import More</button>}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onClose={handleClose} title="Bulk Import Changes" maxWidth={800} footer={footerContent}>
      <div className="bulk-import">
        {/* Step indicator */}
        <div className="bulk-steps">
          {(['upload', 'preview', 'importing', 'done'] as Step[]).map((s, i) => (
            <div key={s} className={`bulk-step ${step === s ? 'bulk-step--active' : ''} ${['preview', 'importing', 'done'].indexOf(step) > ['upload', 'preview', 'importing', 'done'].indexOf(s) - 1 ? 'bulk-step--done' : ''}`}>
              <span className="bulk-step__num">{i + 1}</span>
              <span className="bulk-step__label">{s === 'upload' ? 'Upload' : s === 'preview' ? 'Preview' : s === 'importing' ? 'Import' : 'Done'}</span>
            </div>
          ))}
        </div>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div className="bulk-upload">
            <div className="bulk-upload__header">
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
                Upload a CSV file or paste CSV content below. Each row becomes one change record in Draft status.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn--outline btn--sm" onClick={downloadTemplate}>↓ Download Template</button>
                <button className="btn btn--outline btn--sm" onClick={() => setShowFieldDocs(v => !v)}>
                  {showFieldDocs ? 'Hide' : 'Show'} Field Reference
                </button>
              </div>
            </div>

            {showFieldDocs && (
              <div className="bulk-field-docs">
                <div className="bulk-field-docs__title">Field Reference</div>
                <table className="bulk-field-docs__table">
                  <thead><tr><th>Column</th><th>Required</th><th>Description</th></tr></thead>
                  <tbody>
                    {CSV_COLUMNS.map(col => (
                      <tr key={col}>
                        <td><code>{col}</code></td>
                        <td>{REQUIRED_COLS.includes(col) ? <span style={{ color: 'var(--danger)', fontWeight: 700 }}>Yes</span> : <span style={{ color: 'var(--text-tertiary)' }}>No</span>}</td>
                        <td style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{FIELD_DESCRIPTIONS[col]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="bulk-upload__file" role="button" tabIndex={0} onClick={() => fileRef.current?.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--text-tertiary)', marginBottom: 8 }}>
                <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 15.01l1.41 1.41L11 14.84V19h2v-4.16l1.59 1.59L16 15.01 12.01 11 8 15.01z" />
              </svg>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Click to browse or drop CSV file</p>
              <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleFile} />
            </div>
            <div className="bulk-divider"><span>or paste CSV content</span></div>
            <textarea
              className="ff-input ff-textarea"
              rows={8}
              value={csvText}
              onChange={e => setCsvText(e.target.value)}
              placeholder={`Paste CSV content here…\n\nFirst row must be the header: ${CSV_COLUMNS.slice(0, 7).join(', ')}, …`}
              style={{ fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: 12 }}
            />
            <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>
              <strong>Required:</strong> {REQUIRED_COLS.join(', ')}.&nbsp;&nbsp;
              <strong>Optional:</strong> {OPTIONAL_COLS.join(', ')}.
            </p>
          </div>
        )}

        {/* Step 2: Preview */}
        {step === 'preview' && (
          <div className="bulk-preview">
            <div className="bulk-preview__summary">
              <span className="bulk-badge bulk-badge--ok">{validCount} ready</span>
              {invalidCount > 0 && <span className="bulk-badge bulk-badge--err">{invalidCount} error{invalidCount !== 1 ? 's' : ''}</span>}
              {dupeCount > 0 && <span className="bulk-badge bulk-badge--warn" title="Rows flagged for duplicates, blackout conflicts, or scheduling conflicts">{dupeCount} flagged</span>}
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8 }}>Only valid rows will be imported.</span>
              {dupeCount > 0 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginLeft: 'auto', cursor: 'pointer' }}>
                  <input type="checkbox" checked={skipDuplicates} onChange={e => setSkipDuplicates(e.target.checked)} />
                  Skip flagged rows
                </label>
              )}
            </div>
            <div className="bulk-preview__table-wrap">
              <table className="bulk-preview__table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Title</th>
                    <th>Category</th>
                    <th>Type</th>
                    <th>Risk</th>
                    <th>Impact</th>
                    <th>Owner</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Emg</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className={row.valid ? '' : 'bulk-row--invalid'}>
                      <td>{i + 1}</td>
                      <td title={row.raw.Title}>{row.raw.Title ? (row.raw.Title.length > 30 ? row.raw.Title.slice(0, 28) + '…' : row.raw.Title) : '—'}</td>
                      <td>{row.raw.Category || '—'}</td>
                      <td>{row.raw.ChangeType || '—'}</td>
                      <td>{row.raw.RiskLevel || '—'}</td>
                      <td>{row.raw.ImpactLevel || '—'}</td>
                      <td>{row.raw.Owner || '—'}</td>
                      <td>{row.raw.StartTime || '—'}</td>
                      <td>{row.raw.EndTime || '—'}</td>
                      <td>{parseBool(row.raw.IsEmergency) ? 'Yes' : 'No'}</td>
                      <td>
                        {row.valid
                          ? row.warnings.length > 0
                            ? <span className="bulk-badge bulk-badge--warn" title={row.warnings.join(' | ')}>Warning</span>
                            : <span className="bulk-badge bulk-badge--ok">Ready</span>
                          : (
                            <span className="bulk-badge bulk-badge--err" title={row.errors.join(' | ')}>
                              {row.errors.length} error{row.errors.length > 1 ? 's' : ''}
                            </span>
                          )
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.some(r => !r.valid) && (
              <div className="bulk-errors-list">
                {rows.filter(r => !r.valid).map((row, i) => (
                  <div key={i} className="bulk-error-item">
                    <strong>Row {rows.indexOf(row) + 1}:</strong> {row.errors.join(' • ')}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Importing */}
        {step === 'importing' && (
          <div className="bulk-progress">
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>Importing {validCount} changes…</p>
            <div className="bulk-progress__bar-wrap"><div className="bulk-progress__bar" style={{ width: `${progress}%` }} /></div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>{progress}% complete</p>
          </div>
        )}

        {/* Step 4: Done */}
        {step === 'done' && result && (
          <div className="bulk-done">
            <div className={`bulk-done__icon ${result.failed === 0 ? 'bulk-done__icon--success' : 'bulk-done__icon--partial'}`}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                {result.failed === 0
                  ? <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                  : <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                }
              </svg>
            </div>
            <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{result.failed === 0 ? 'Import Complete' : 'Partial Import'}</p>
            <div className="bulk-done__stats">
              <div className="bulk-done__stat"><span className="bulk-done__stat-value" style={{ color: 'var(--success)' }}>{result.success}</span><span className="bulk-done__stat-label">Imported</span></div>
              <div className="bulk-done__stat"><span className="bulk-done__stat-value" style={{ color: result.failed > 0 ? 'var(--danger)' : 'var(--text-tertiary)' }}>{result.failed}</span><span className="bulk-done__stat-label">Failed</span></div>
            </div>
            {result.errors.length > 0 && (
              <div className="bulk-done__errors">
                {result.errors.map((e, i) => <p key={i} style={{ fontSize: 11, color: 'var(--danger)', margin: '2px 0' }}>{e}</p>)}
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
