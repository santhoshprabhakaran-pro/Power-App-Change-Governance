
import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';
import type { Cgmp_projects } from '../../generated/models/Cgmp_projectsModel';
import { STATUS, statusLabel, statusColor, riskLabel, riskColor } from '../../hooks/useDataverse';
import { fmtShortDate as fmtDate } from '../../utils/format';
import { parseChangeUATData, defaultUATEntry, remStatusLabel, remStatusColor, RemediationHistory } from '../giicc/GIICCCommandCenter';
import AttachmentPanel from '../ui/AttachmentPanel';

/* ─── Props ─────────────────────────────────────────────────────── */

export interface ISMUATStatusTabProps {
  changes: Cgmp_changes[];
  ismProjects: Cgmp_projects[];
}

/* ─── Main Tab Component ─────────────────────────────────────────── */

export default function ISMUATStatusTab({ changes, ismProjects }: ISMUATStatusTabProps) {
  const giiccStatuses = new Set<number>([STATUS.InProgress, STATUS.Completed, STATUS.Closed]);
  const myProjectIds = new Set(ismProjects.map(p => p.cgmp_projectid));

  const relevantChanges = changes.filter(c => {
    const sc = c.cgmp_status as unknown as number;
    if (!giiccStatuses.has(sc)) return false;
    const ids = (c.cgmp_projectids ?? '').split(',').map(s => s.trim()).filter(Boolean);
    return ids.some(id => myProjectIds.has(id));
  });

  if (relevantChanges.length === 0) {
    return (
      <div className="ism-empty">
        No changes in GIICC execution or closure phase for your projects.<br />
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Changes appear here once IT Ops hands them over to GIICC.</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {relevantChanges.map(change => {
        const sc = change.cgmp_status as unknown as number;
        const rc = change.cgmp_risklevel as unknown as number;
        const uatData = parseChangeUATData(change.cgmp_uatusers);
        const projectIds = (change.cgmp_projectids ?? '').split(',').map(s => s.trim()).filter(Boolean);
        const myPids = projectIds.filter(pid => myProjectIds.has(pid));

        return (
          <div key={change.cgmp_changeid} className="ism-uat-status-card">
            <div className="ism-uat-status-header">
              <span className="change-number">{change.cgmp_changenumber}</span>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{change.cgmp_title}</span>
              <span className={`badge badge--status ${statusColor(sc)}`}>{statusLabel(sc)}</span>
              <span className={`badge badge--risk ${riskColor(rc)}`}>{riskLabel(rc)}</span>
              {change.cgmp_starttime && (
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{fmtDate(change.cgmp_starttime)}</span>
              )}
            </div>
            <div className="ism-uat-status-projects">
              {myPids.map(pid => {
                const proj = ismProjects.find(p => p.cgmp_projectid === pid);
                const entry = uatData[pid] ?? defaultUATEntry();
                const colorMap: Record<string, string> = {
                  Pending: '#999', Success: 'var(--success)', Failed: 'var(--danger)',
                  Rollback: 'var(--orange)', NotApplicable: '#aaa', PartialSuccess: '#f59e0b',
                };
                const postColor = colorMap[entry.postStatus] ?? '#999';
                const preColor = colorMap[entry.preStatus] ?? '#999';
                return (
                  <div key={pid} className="ism-uat-status-proj-row">
                    <div>
                      <strong style={{ fontSize: 13 }}>{proj?.cgmp_name ?? pid}</strong>
                      {proj?.cgmp_pidbnumber && <span className="proj-pidb" style={{ marginLeft: 6 }}>{proj.cgmp_pidbnumber}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Pre-UAT:</span>
                      <span className="itops-uat-status-pill" style={{ background: `${preColor}22`, color: preColor }}>{entry.preStatus}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Post-UAT:</span>
                      <span className="itops-uat-status-pill" style={{ background: `${postColor}22`, color: postColor }}>{entry.postStatus}</span>
                    </div>
                    {entry.comments && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{entry.comments}</div>}
                    {entry.failureReason && (
                      <div style={{ fontSize: 12, color: 'var(--danger)' }}>
                        <strong>Failure Reason:</strong> {entry.failureReason}
                      </div>
                    )}
                    {entry.rollback && <span style={{ fontSize: 11, color: 'var(--orange)', fontWeight: 600 }}>Rollback Initiated</span>}
                    {(entry.postStatus === 'Failed' || entry.postStatus === 'Rollback') && entry.remediationStatus && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Remediation:</span>
                          <span className="rem-status-pill" style={{ background: `${remStatusColor(entry.remediationStatus)}20`, color: remStatusColor(entry.remediationStatus) }}>
                            {remStatusLabel(entry.remediationStatus)}
                          </span>
                        </div>
                        {(entry.remediationHistory ?? []).length > 0 && (
                          <RemediationHistory history={entry.remediationHistory ?? []} />
                        )}
                      </div>
                    )}
                    {entry.contacts.length > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        {entry.contacts.length} UAT contact{entry.contacts.length !== 1 ? 's' : ''}: {entry.contacts.map(c => c.name).join(', ')}
                      </div>
                    )}
                    <AttachmentPanel
                      objectId={change.cgmp_changeid}
                      subjectPrefix={`giicc-${change.cgmp_changeid}-${pid}:`}
                      readOnly
                      compact
                    />
                  </div>
                );
              })}
            </div>
            {change.cgmp_pirnotes && (
              <div className="ism-uat-pir-notes">
                <strong style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>PIR Notes</strong>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 0' }}>{change.cgmp_pirnotes}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
