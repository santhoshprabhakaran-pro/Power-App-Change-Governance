import { useMemo } from 'react';
import { fmtDateTime } from '../../utils/format';

export interface HistoryEntry {
  timestamp: string;
  previousValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  _type?: string;
  comment?: string;
  user?: string;
}

export function VersionHistory({ json, currentValues }: { json: string | undefined; currentValues?: Record<string, unknown> }) {
  const entries = useMemo<HistoryEntry[]>(() => {
    try { return JSON.parse(json ?? '[]') as HistoryEntry[]; } catch { return []; }
  }, [json]);

  // Filter entries by type
  const versionEntries = entries.filter(e => !e._type || e._type === 'edit');
  const commentEntries = entries.filter(e => e._type === 'comment');
  const reschedEntries = entries.filter((e: any) => e._type === 'rescheduleProposed' || e._type === 'rescheduleAccepted' || e._type === 'rescheduleDeclined');

  if (versionEntries.length === 0 && commentEntries.length === 0 && reschedEntries.length === 0) {
    return <p className="view-text" style={{ color: 'var(--text-tertiary)' }}>No version history recorded.</p>;
  }

  return (
    <div className="version-history">
      {reschedEntries.map((e: any, i: number) => {
        if (e._type === 'rescheduleProposed') {
          return (
            <div key={`rs-${i}`} className="version-entry" style={{ borderLeft: '3px solid #FF8C00', background: 'rgba(255,140,0,0.04)' }}>
              <div className="version-entry__header">
                <span className="version-entry__ts">{fmtDateTime(e.timestamp)}</span>
                <span className="version-entry__badge" style={{ background: '#FF8C00' }}>Reschedule Proposed</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.7 }}>
                <strong>By:</strong> {e.by}<br />
                <strong>Proposed:</strong> {fmtDateTime(e.proposedStart)} – {fmtDateTime(e.proposedEnd)}<br />
                {e.reason && <><strong>Reason:</strong> {e.reason}</>}
              </div>
            </div>
          );
        }
        if (e._type === 'rescheduleAccepted') {
          return (
            <div key={`ra-${i}`} className="version-entry" style={{ borderLeft: '3px solid var(--success)', background: 'rgba(16,124,16,0.04)' }}>
              <div className="version-entry__header">
                <span className="version-entry__ts">{fmtDateTime(e.timestamp)}</span>
                <span className="version-entry__badge" style={{ background: 'var(--success)' }}>Reschedule Accepted</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Accepted by {e.by}</div>
            </div>
          );
        }
        if (e._type === 'rescheduleDeclined') {
          return (
            <div key={`rd-${i}`} className="version-entry" style={{ borderLeft: '3px solid var(--danger)', background: 'rgba(209,52,56,0.04)' }}>
              <div className="version-entry__header">
                <span className="version-entry__ts">{fmtDateTime(e.timestamp)}</span>
                <span className="version-entry__badge" style={{ background: 'var(--danger)' }}>Reschedule Declined</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Declined by {e.by}</div>
            </div>
          );
        }
        return null;
      })}
      {[...versionEntries].reverse().map((e, i) => {
        // Determine "new values" by looking at the next older entry's prev values or using current values
        const nextEntry = versionEntries[versionEntries.length - 1 - i - 1];
        const newValues = e.newValues ?? nextEntry?.previousValues ?? currentValues ?? {};
        return (
          <div key={i} className="version-entry">
            <div className="version-entry__header">
              <span className="version-entry__ts">{fmtDateTime(e.timestamp)}</span>
              <span className="version-entry__badge">v{versionEntries.length - i}</span>
            </div>
            <table className="version-diff-table">
              <thead>
                <tr>
                  <th className="version-diff-table__field">Field</th>
                  <th className="version-diff-table__old">Previous</th>
                  <th className="version-diff-table__new">Current</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(e.previousValues ?? {}).map(([k, oldVal]) => {
                  const newVal = newValues[k];
                  const changed = String(oldVal ?? '') !== String(newVal ?? '');
                  return (
                    <tr key={k} className={changed ? 'version-diff-table__row--changed' : ''}>
                      <td className="version-diff-table__field">{k}</td>
                      <td className="version-diff-table__old-val">{String(oldVal ?? '—')}</td>
                      <td className="version-diff-table__new-val">{String(newVal ?? '—')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
