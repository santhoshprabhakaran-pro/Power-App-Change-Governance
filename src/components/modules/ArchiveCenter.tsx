import { useState, useMemo, useCallback } from 'react';
import { useChangeList, useAllBridges } from '../../hooks/useDataverse';
import { exportCSV } from '../../utils/csv';
import { fmtDate, fmtDateTime, getDisplayTimezone } from '../../utils/format';
import { STATUS, statusColor, statusLabel, riskLabel, riskColor } from '../../hooks/useDataverse';
import { SlidePanel } from '../ui/Modal';
import { Cgmp_changesService } from '../../generated';
import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';
import type { Cgmp_bridges } from '../../generated/models/Cgmp_bridgesModel';
import { useApp } from '../../context/AppContext';

const PIR_STATUS_LABEL: Record<number, string> = {
  100000000: 'Draft',
  100000001: 'Submitted',
  100000002: 'Approved',
  100000003: 'Rejected',
};
const PIR_STATUS_COLOR: Record<number, string> = {
  100000000: 'status-draft',
  100000001: 'status-review',
  100000002: 'status-released',
  100000003: 'status-cancelled',
};

type ArchiveTab = 'changes' | 'pir' | 'lessons' | 'bridge-pir';

const RETENTION_YEARS = 1;

function retentionDate(c: Cgmp_changes): Date | null {
  const closedAt = c.cgmp_actualendtime ?? c.createdon;
  if (!closedAt) return null;
  const d = new Date(closedAt);
  d.setFullYear(d.getFullYear() + RETENTION_YEARS);
  return d;
}

interface PirStructured { rootCause: string; impactSummary: string; preventiveActions: string; signOffStatus: 'Pending' | 'Approved'; }

function parsePir(raw: string | undefined): PirStructured | null {
  if (!raw?.trim()) return null;
  try {
    const p = JSON.parse(raw);
    if (typeof p === 'object' && 'rootCause' in p) return p as PirStructured;
  } catch { /* plain text */ }
  return null;
}

const EMPTY_PIR: PirStructured = { rootCause: '', impactSummary: '', preventiveActions: '', signOffStatus: 'Pending' };

function VersionHistoryViewer({ versionHistory }: { versionHistory: string | undefined }) {
  if (!versionHistory) return null;
  let entries: any[] = [];
  try { entries = JSON.parse(versionHistory); } catch { return null; }
  const fieldChanges = entries.filter((e: any) => e._type === 'update' || e.field);
  if (fieldChanges.length === 0) return null;
  return (
    <div className="archive-section">
      <div className="archive-section__title">Version History ({fieldChanges.length} changes)</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {fieldChanges.map((e: any, i: number) => (
          <div key={i} style={{ fontSize: 12, padding: '6px 10px', background: 'var(--surface-alt)', borderRadius: 4, borderLeft: '3px solid var(--border)' }}>
            {e.field && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, minWidth: 100, color: 'var(--text-secondary)' }}>{e.field}</span>
                <span style={{ color: 'var(--danger)', textDecoration: 'line-through', flex: 1 }}>{String(e.before ?? '—')}</span>
                <span style={{ color: 'var(--success)', flex: 1 }}>→ {String(e.after ?? '—')}</span>
              </div>
            )}
            {e.comment && <div style={{ color: 'var(--text-primary)' }}>{e.comment}</div>}
            <div style={{ color: 'var(--text-tertiary)', fontSize: 11, marginTop: 2 }}>
              {e.by ?? e.user ?? ''}{e.timestamp ? ` · ${fmtDateTime(e.timestamp)}` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function isSoftDeleted(c: Cgmp_changes): boolean {
  try {
    const h = JSON.parse(c.cgmp_versionhistory ?? '[]') as any[];
    return h.some(e => e._type === 'deleted');
  } catch { return false; }
}


export default function ArchiveCenter() {
  const { changes, loading, refresh } = useChangeList();
  const { showToast, isAdmin } = useApp();
  const [tab, setTab] = useState<ArchiveTab>(() => {
    try { return (localStorage.getItem('cgmp-tab-archive') as ArchiveTab | null) ?? 'changes'; } catch { return 'changes'; }
  });
  const handleTabChange = useCallback((newTab: ArchiveTab) => {
    try { localStorage.setItem('cgmp-tab-archive', newTab); } catch {}
    setTab(newTab);
  }, []);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [viewChange, setViewChange] = useState<Cgmp_changes | null>(null);
  const [viewBridge, setViewBridge] = useState<Cgmp_bridges | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [selectedRestoreIds, setSelectedRestoreIds] = useState<Set<string>>(new Set());
  const [bulkRestoring, setBulkRestoring] = useState(false);

  /* PIR editing state */
  const [pirEdit, setPirEdit] = useState<PirStructured | null>(null);
  const [pirSaving, setPirSaving] = useState(false);
  const [pirStatusSaving, setPirStatusSaving] = useState(false);

  const savePir = useCallback(async () => {
    if (!viewChange || !pirEdit) return;
    setPirSaving(true);
    try {
      const r = await Cgmp_changesService.update(viewChange.cgmp_changeid, { cgmp_pirnotes: JSON.stringify(pirEdit) });
      if (!r.success) throw r.error ?? new Error('Save failed');
      showToast('success', 'PIR saved');
      setPirEdit(null);
      refresh();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save PIR');
    } finally { setPirSaving(false); }
  }, [viewChange, pirEdit, showToast, refresh]);

  const updatePirStatus = useCallback(async (statusCode: number, label: string) => {
    if (!viewChange) return;
    if (!window.confirm(`${label} PIR for ${viewChange.cgmp_changenumber ?? 'this change'}?`)) return;
    setPirStatusSaving(true);
    try {
      const r = await Cgmp_changesService.update(viewChange.cgmp_changeid, {
        cgmp_pirstatus: statusCode as any,
      });
      if (!r.success) throw r.error ?? new Error('Update failed');
      showToast('success', `PIR ${label.toLowerCase()}d`);
      refresh();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : `Failed to ${label.toLowerCase()} PIR`);
    } finally { setPirStatusSaving(false); }
  }, [viewChange, showToast, refresh]);

  const handleRestore = async (c: Cgmp_changes) => {
    if (!isAdmin) {
      showToast('error', 'Only Administrators can restore archived changes');
      return;
    }
    setRestoring(c.cgmp_changeid);
    try {
      let history: unknown[] = [];
      try { history = JSON.parse(c.cgmp_versionhistory ?? '[]'); } catch {}
      const cleaned = history.filter((e: any) => e._type !== 'deleted');
      const r = await Cgmp_changesService.update(c.cgmp_changeid, {
        cgmp_status: 100000000 as any, // Draft
        cgmp_versionhistory: JSON.stringify(cleaned),
      });
      if (!r.success) throw new Error('Restore failed');
      showToast('success', `${c.cgmp_changenumber} restored to Draft`);
      refresh();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setRestoring(null);
    }
  };

  const handleBulkRestore = async (softDeletedChanges: Cgmp_changes[]) => {
    if (!isAdmin) {
      showToast('error', 'Only Administrators can restore archived changes');
      return;
    }
    const toRestore = softDeletedChanges.filter(c => selectedRestoreIds.has(c.cgmp_changeid));
    if (toRestore.length === 0) return;
    setBulkRestoring(true);
    let succeeded = 0;
    try {
      await Promise.all(toRestore.map(async c => {
        let history: unknown[] = [];
        try { history = JSON.parse(c.cgmp_versionhistory ?? '[]'); } catch {}
        const cleaned = history.filter((e: any) => e._type !== 'deleted');
        const r = await Cgmp_changesService.update(c.cgmp_changeid, {
          cgmp_status: 100000000 as any,
          cgmp_versionhistory: JSON.stringify(cleaned),
        });
        if (r.success) succeeded++;
      }));
      setSelectedRestoreIds(new Set());
      showToast(succeeded === toRestore.length ? 'success' : 'warning', `${succeeded}/${toRestore.length} changes restored`);
      refresh();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Bulk restore failed');
    } finally { setBulkRestoring(false); }
  };

  const archived = useMemo(() =>
    changes.filter(c => {
      const s = c.cgmp_status as unknown as number;
      return s === STATUS.Closed || s === STATUS.Completed || s === STATUS.Cancelled;
    }),
    [changes]
  );

  const pirChanges = useMemo(() => changes.filter(c => c.cgmp_pirnotes?.trim()), [changes]);
  const lessonsChanges = useMemo(() => changes.filter(c => c.cgmp_lessonslearned?.trim()), [changes]);

  const { bridges } = useAllBridges(3600000);
  const bridgePIR = useMemo(() => bridges.filter(b => b.cgmp_pirnotes?.trim()), [bridges]);

  function applyFilters(list: Cgmp_changes[]) {
    let r = list;
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(c => c.cgmp_title?.toLowerCase().includes(q) || c.cgmp_changenumber?.toLowerCase().includes(q));
    }
    if (dateFrom) { const from = new Date(dateFrom).getTime(); r = r.filter(c => c.createdon && new Date(c.createdon).getTime() >= from); }
    if (dateTo) { const to = new Date(dateTo).getTime() + 86399999; r = r.filter(c => c.createdon && new Date(c.createdon).getTime() <= to); }
    return r;
  }

  const displayList = applyFilters(
    tab === 'changes' ? archived :
    tab === 'pir' ? pirChanges :
    tab === 'lessons' ? lessonsChanges :
    [] // bridge-pir has separate rendering
  );

  return (
    <div className="module-workspace">
      <div className="module-header">
        <div>
          <h1 className="module-title">Archive Center</h1>
          <p className="module-subtitle">Closed changes, PIR documents, and lessons learned</p>
        </div>
        <button className="btn btn--outline btn--sm" onClick={() => {
          if (tab === 'bridge-pir') {
            exportCSV(
              `bridge-pir-${new Date().toISOString().slice(0, 10)}.csv`,
              ['Title', 'ChangeNumber', 'PIRNotes', 'LessonsLearned', 'ClosureRemarks'],
              bridgePIR.map(b => [
                b.cgmp_title ?? '',
                b.cgmp_changenumber ?? '',
                b.cgmp_pirnotes ?? '',
                b.cgmp_lessonslearned ?? '',
                b.cgmp_closureremarks ?? '',
              ])
            );
          } else {
            exportCSV(
              `archive-${tab}-${new Date().toISOString().slice(0, 10)}.csv`,
              ['ChangeNumber', 'Title', 'Status', 'Risk', 'Created', 'Owner'],
              displayList.map(c => [
                c.cgmp_changenumber ?? '',
                c.cgmp_title ?? '',
                String(c.cgmp_status),
                String(c.cgmp_risklevel),
                c.createdon ?? '',
                c.owneridname ?? '',
              ])
            );
          }
        }}>
          Export CSV
        </button>
      </div>

      {/* Tabs */}
      <div className="ism-tabs" role="tablist" aria-label="Archive views" style={{ padding: '0 24px' }}>
        {([
          ['changes', `Archived Changes (${archived.length})`],
          ['pir', `PIR Documents (${pirChanges.length})`],
          ['lessons', `Lessons Learned (${lessonsChanges.length})`],
          ['bridge-pir', `Bridge PIR (${bridgePIR.length})`],
        ] as [ArchiveTab, string][]).map(([t, label]) => (
          <button
            key={t}
            role="tab"
            id={`archive-tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`archive-panel-${t}`}
            tabIndex={tab === t ? 0 : -1}
            className={`ism-tab ${tab === t ? 'ism-tab--active' : ''}`}
            onClick={() => handleTabChange(t)}
            onKeyDown={(e) => {
              const allTabs: ArchiveTab[] = ['changes', 'pir', 'lessons', 'bridge-pir'];
              const idx = allTabs.indexOf(tab);
              if (e.key === 'ArrowRight') { e.preventDefault(); handleTabChange(allTabs[(idx + 1) % allTabs.length]); }
              if (e.key === 'ArrowLeft') { e.preventDefault(); handleTabChange(allTabs[(idx - 1 + allTabs.length) % allTabs.length]); }
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <input className="filter-bar__search" placeholder="Search by title or change number…" value={search} onChange={e => setSearch(e.target.value)} />
        <input type="date" className="filter-bar__date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="From date" />
        <input type="date" className="filter-bar__date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="To date" />
        <span className="filter-bar__count">{tab === 'bridge-pir' ? bridgePIR.length : displayList.length} records</span>
      </div>

      {/* Bulk Restore Bar */}
      {isAdmin && tab === 'changes' && selectedRestoreIds.size > 0 && (
        <div className="kb-bulk-bar">
          <span className="kb-bulk-bar__count">{selectedRestoreIds.size} selected</span>
          <button className="btn btn--sm btn--primary" disabled={bulkRestoring} onClick={() => handleBulkRestore(displayList)}>
            {bulkRestoring ? 'Restoring…' : `Restore ${selectedRestoreIds.size} to Draft`}
          </button>
          <button className="btn btn--sm btn--outline" onClick={() => setSelectedRestoreIds(new Set())}>Clear</button>
        </div>
      )}

      {/* Table — Changes / PIR / Lessons tabs */}
      {tab !== 'bridge-pir' && (
        <div role="tabpanel" id={`archive-panel-${tab}`} aria-labelledby={`archive-tab-${tab}`} tabIndex={0} className="module-table-wrap">
          {loading ? (
            <div className="module-loading">Loading…</div>
          ) : displayList.length === 0 ? (
            <div className="module-empty">No records found.</div>
          ) : (
            <table className="ism-table">
              <thead>
                <tr>
                  {tab === 'changes' && <th style={{ width: 32 }}><input type="checkbox" onChange={e => { const sds = displayList.filter(isSoftDeleted); setSelectedRestoreIds(e.target.checked ? new Set(sds.map(c => c.cgmp_changeid)) : new Set()); }} /></th>}
                  <th>Change #</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Risk</th>
                  {tab === 'pir' && <th>PIR Notes</th>}
                  {tab === 'pir' && <th>PIR Status</th>}
                  {tab === 'lessons' && <th>Lessons Learned</th>}
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayList.map(c => {
                  const sc = c.cgmp_status as unknown as number;
                  const rc = c.cgmp_risklevel as unknown as number;
                  const softDeleted = isSoftDeleted(c);
                  return (
                    <tr key={c.cgmp_changeid}>
                      {tab === 'changes' && (
                        <td>
                          {softDeleted && (
                            <input type="checkbox" checked={selectedRestoreIds.has(c.cgmp_changeid)}
                              onChange={() => setSelectedRestoreIds(prev => { const s = new Set(prev); s.has(c.cgmp_changeid) ? s.delete(c.cgmp_changeid) : s.add(c.cgmp_changeid); return s; })} />
                          )}
                        </td>
                      )}
                      <td><span className="change-number">{c.cgmp_changenumber}</span></td>
                      <td>{c.cgmp_title}</td>
                      <td><span className={`badge badge--status ${statusColor(sc)}`}>{statusLabel(sc)}</span></td>
                      <td><span className={`badge badge--risk ${riskColor(rc)}`}>{riskLabel(rc)}</span></td>
                      {tab === 'pir' && (
                        <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text-secondary)' }}>
                          {c.cgmp_pirnotes?.slice(0, 80)}{(c.cgmp_pirnotes?.length ?? 0) > 80 ? '…' : ''}
                        </td>
                      )}
                      {tab === 'pir' && (
                        <td>
                          {(() => {
                            const ps = (c as any).cgmp_pirstatus as number | undefined;
                            if (ps == null) return <span className="badge badge--status status-draft" style={{ fontSize: 10 }}>Draft</span>;
                            return <span className={`badge badge--status ${PIR_STATUS_COLOR[ps] ?? 'status-draft'}`} style={{ fontSize: 10 }}>{PIR_STATUS_LABEL[ps] ?? 'Draft'}</span>;
                          })()}
                        </td>
                      )}
                      {tab === 'lessons' && (
                        <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text-secondary)' }}>
                          {c.cgmp_lessonslearned?.slice(0, 80)}{(c.cgmp_lessonslearned?.length ?? 0) > 80 ? '…' : ''}
                        </td>
                      )}
                      <td style={{ fontSize: 12 }}>
                        {fmtDate(c.createdon)}
                        {(() => {
                          const rd = retentionDate(c);
                          if (!rd) return null;
                          const isPast = rd < new Date();
                          const daysLeft = Math.ceil((rd.getTime() - Date.now()) / 86400000);
                          if (isPast) return <div style={{ fontSize: 10, color: 'var(--danger)', marginTop: 2 }}>⚠ Scheduled for deletion</div>;
                          if (daysLeft <= 90) return <div style={{ fontSize: 10, color: 'var(--orange)', marginTop: 2 }} title={`Retention expires ${rd.toLocaleDateString(undefined, { timeZone: getDisplayTimezone() })}`}>Expires in {daysLeft}d</div>;
                          return null;
                        })()}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn--xs btn--outline" onClick={() => { setViewChange(c); setPirEdit(null); }}>View</button>
                          {isAdmin && tab === 'changes' && softDeleted && (
                            <button className="btn btn--xs btn--secondary" onClick={() => handleRestore(c)} disabled={restoring === c.cgmp_changeid}>
                              {restoring === c.cgmp_changeid ? '…' : 'Restore'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Bridge PIR tab */}
      {tab === 'bridge-pir' && (
        <div role="tabpanel" id="archive-panel-bridge-pir" aria-labelledby="archive-tab-bridge-pir" tabIndex={0} className="module-table-wrap">
          {bridgePIR.length === 0 ? (
            <div className="module-empty">No bridge PIR records found.</div>
          ) : (
            <table className="ism-table">
              <thead>
                <tr>
                  <th>Bridge ID</th>
                  <th>Title</th>
                  <th>Change #</th>
                  <th>PIR Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bridgePIR.map(b => (
                  <tr key={b.cgmp_bridgeid}>
                    <td><span className="change-number">{b.cgmp_title ?? b.cgmp_bridgeid}</span></td>
                    <td>{b.cgmp_title}</td>
                    <td>{b.cgmp_changenumber ?? '—'}</td>
                    <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text-secondary)' }}>
                      {b.cgmp_pirnotes?.slice(0, 80)}{(b.cgmp_pirnotes?.length ?? 0) > 80 ? '…' : ''}
                    </td>
                    <td>
                      <button className="btn btn--xs btn--outline" onClick={() => setViewBridge(b)}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Change detail panel */}
      <SlidePanel
        open={!!viewChange}
        onClose={() => { setViewChange(null); setPirEdit(null); }}
        title={viewChange?.cgmp_changenumber ?? ''}
        subtitle={viewChange?.cgmp_title ?? ''}
        width={600}
      >
        {viewChange && (
          <div className="archive-detail">
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <button className="btn btn--xs btn--outline" onClick={() => window.print()} title="Print or save as PDF">Print / PDF</button>
            </div>
            <div className="rv-grid">
              {[
                ['Status', <span className={`badge badge--status ${statusColor(viewChange.cgmp_status as unknown as number)}`}>{statusLabel(viewChange.cgmp_status as unknown as number)}</span>],
                ['Risk', <span className={`badge badge--risk ${riskColor(viewChange.cgmp_risklevel as unknown as number)}`}>{riskLabel(viewChange.cgmp_risklevel as unknown as number)}</span>],
                ['Owner', viewChange.owneridname],
                ['Created', fmtDate(viewChange.createdon)],
                ['Start', fmtDate(viewChange.cgmp_starttime)],
                ['End', fmtDate(viewChange.cgmp_endtime)],
                ['Released by', viewChange.cgmp_releasedby],
                ['Released at', fmtDate(viewChange.cgmp_releasedat)],
              ].map(([label, value]) => (
                <div key={String(label)} className="rv-field">
                  <span className="rv-field__label">{label}</span>
                  <span className="rv-field__value">{value ?? '—'}</span>
                </div>
              ))}
            </div>

            {/* PIR Approval Workflow (#45/#52/#86) */}
            {viewChange.cgmp_pirnotes && (
              <div className="archive-section">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="archive-section__title" style={{ marginBottom: 0 }}>PIR Approval</div>
                    {(() => {
                      const ps = (viewChange as any).cgmp_pirstatus as number | undefined;
                      const code = ps ?? 100000000;
                      return <span className={`badge badge--status ${PIR_STATUS_COLOR[code] ?? 'status-draft'}`}>{PIR_STATUS_LABEL[code] ?? 'Draft'}</span>;
                    })()}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(() => {
                      const ps = (viewChange as any).cgmp_pirstatus as number | undefined;
                      const isDraft = !ps || ps === 100000000;
                      const isSubmitted = ps === 100000001;
                      return (
                        <>
                          {isDraft && (
                            <button className="btn btn--xs btn--secondary" disabled={pirStatusSaving} onClick={() => updatePirStatus(100000001, 'Submit')}>
                              Submit for Approval
                            </button>
                          )}
                          {isSubmitted && isAdmin && (
                            <>
                              <button className="btn btn--xs btn--primary" disabled={pirStatusSaving} onClick={() => updatePirStatus(100000002, 'Approve')}>
                                Approve
                              </button>
                              <button className="btn btn--xs btn--danger-outline" disabled={pirStatusSaving} onClick={() => updatePirStatus(100000003, 'Reject')}>
                                Reject
                              </button>
                            </>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}

            {/* Structured PIR Form (#85) */}
            <div className="archive-section">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div className="archive-section__title" style={{ marginBottom: 0 }}>PIR Notes</div>
                {!pirEdit && (
                  <button className="btn btn--xs btn--outline" onClick={() => setPirEdit(parsePir(viewChange.cgmp_pirnotes) ?? { ...EMPTY_PIR })}>
                    {viewChange.cgmp_pirnotes ? 'Edit' : 'Add PIR'}
                  </button>
                )}
              </div>
              {pirEdit ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {(['rootCause', 'impactSummary', 'preventiveActions'] as const).map(field => (
                    <div key={field}>
                      <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 2 }}>
                        {field === 'rootCause' ? 'Root Cause' : field === 'impactSummary' ? 'Impact Summary' : 'Preventive Actions'}
                      </label>
                      <textarea
                        rows={3}
                        className="form-input"
                        value={pirEdit[field]}
                        onChange={e => setPirEdit(prev => prev ? { ...prev, [field]: e.target.value } : prev)}
                        style={{ width: '100%', resize: 'vertical', fontSize: 13 }}
                      />
                    </div>
                  ))}
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 2 }}>Sign-off Status</label>
                    <select
                      className="form-input"
                      value={pirEdit.signOffStatus}
                      onChange={e => setPirEdit(prev => prev ? { ...prev, signOffStatus: e.target.value as 'Pending' | 'Approved' } : prev)}
                      style={{ fontSize: 13 }}
                    >
                      <option value="Pending">Pending</option>
                      <option value="Approved">Approved</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button className="btn btn--xs btn--outline" onClick={() => setPirEdit(null)} disabled={pirSaving}>Cancel</button>
                    <button className="btn btn--xs btn--primary" onClick={savePir} disabled={pirSaving}>{pirSaving ? 'Saving…' : 'Save PIR'}</button>
                  </div>
                </div>
              ) : (() => {
                const pir = parsePir(viewChange.cgmp_pirnotes);
                if (!pir && !viewChange.cgmp_pirnotes) return <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>No PIR notes recorded.</p>;
                if (pir) return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(['rootCause', 'impactSummary', 'preventiveActions'] as const).map(field => pir[field] ? (
                      <div key={field}>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2 }}>
                          {field === 'rootCause' ? 'Root Cause' : field === 'impactSummary' ? 'Impact Summary' : 'Preventive Actions'}
                        </div>
                        <p className="archive-text" style={{ margin: 0 }}>{pir[field]}</p>
                      </div>
                    ) : null)}
                    <div style={{ fontSize: 11, marginTop: 4 }}>
                      Sign-off: <span style={{ fontWeight: 600, color: pir.signOffStatus === 'Approved' ? 'var(--success)' : 'var(--orange)' }}>{pir.signOffStatus}</span>
                    </div>
                  </div>
                );
                return <p className="archive-text">{viewChange.cgmp_pirnotes}</p>;
              })()}
            </div>

            {viewChange.cgmp_lessonslearned && (
              <div className="archive-section">
                <div className="archive-section__title">Lessons Learned</div>
                <p className="archive-text">{viewChange.cgmp_lessonslearned}</p>
              </div>
            )}
            {viewChange.cgmp_closureremarks && (
              <div className="archive-section">
                <div className="archive-section__title">Closure Remarks</div>
                <p className="archive-text">{viewChange.cgmp_closureremarks}</p>
              </div>
            )}

            {/* Version History Diff Viewer (#90) */}
            <VersionHistoryViewer versionHistory={viewChange.cgmp_versionhistory} />
          </div>
        )}
      </SlidePanel>

      {/* Bridge PIR detail panel */}
      <SlidePanel
        open={!!viewBridge}
        onClose={() => setViewBridge(null)}
        title={viewBridge?.cgmp_bridgeid ?? ''}
        subtitle={viewBridge?.cgmp_title ?? ''}
        width={560}
      >
        {viewBridge && (
          <div className="archive-detail">
            <div className="rv-grid">
              {[
                ['Change #', viewBridge.cgmp_changenumber],
                ['Actual Start', fmtDate(viewBridge.cgmp_actualstart)],
                ['Actual End', fmtDate(viewBridge.cgmp_actualend)],
              ].map(([label, value]) => (
                <div key={String(label)} className="rv-field">
                  <span className="rv-field__label">{label}</span>
                  <span className="rv-field__value">{value ?? '—'}</span>
                </div>
              ))}
            </div>
            {(() => {
              try {
                const data = JSON.parse(viewBridge.cgmp_projectstatuses ?? '{}');
                if (data && data.impactedServices) {
                  return (
                    <div className="archive-section" style={{ borderLeft: '3px solid var(--danger)', paddingLeft: 12 }}>
                      <div className="archive-section__title" style={{ color: 'var(--danger)' }}>⚠ Service Degradation Report</div>
                      <pre className="archive-text" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{data.impactedServices}</pre>
                    </div>
                  );
                }
              } catch {}
              return null;
            })()}
            {viewBridge.cgmp_pirnotes && (
              <div className="archive-section">
                <div className="archive-section__title">PIR Notes</div>
                <p className="archive-text">{viewBridge.cgmp_pirnotes}</p>
              </div>
            )}
            {viewBridge.cgmp_lessonslearned && (
              <div className="archive-section">
                <div className="archive-section__title">Lessons Learned</div>
                <p className="archive-text">{viewBridge.cgmp_lessonslearned}</p>
              </div>
            )}
            {viewBridge.cgmp_closureremarks && (
              <div className="archive-section">
                <div className="archive-section__title">Closure Remarks</div>
                <p className="archive-text">{viewBridge.cgmp_closureremarks}</p>
              </div>
            )}
          </div>
        )}
      </SlidePanel>
    </div>
  );
}
