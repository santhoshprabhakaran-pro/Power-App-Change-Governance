import { useMemo } from 'react';
import { SlidePanel } from '../ui/Modal';
import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';
import type { Cgmp_projects } from '../../generated/models/Cgmp_projectsModel';

function countUAT(uatJson: string | undefined): number {
  if (!uatJson?.trim()) return 0;
  try {
    const parsed = JSON.parse(uatJson);
    if (Array.isArray(parsed)) return parsed.length;
    return uatJson.split(',').filter(s => s.trim()).length;
  } catch {
    return uatJson.split(',').filter(s => s.trim()).length;
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  selectedChanges: Cgmp_changes[];
  allProjects: Cgmp_projects[];
}

export default function ImpactAnalysis({ open, onClose, selectedChanges, allProjects }: Props) {
  const { impactedProjects, unresolved } = useMemo(() => {
    const ids = new Set<string>();
    selectedChanges.forEach(c => {
      if (c.cgmp_projectids) {
        c.cgmp_projectids.split(',').forEach(id => {
          const trimmed = id.trim();
          if (trimmed) ids.add(trimmed);
        });
      }
    });

    const matched = allProjects.filter(p => ids.has(p.cgmp_projectid));
    const matchedIds = new Set(matched.map(p => p.cgmp_projectid));
    const unresolved = [...ids].filter(id => !matchedIds.has(id));

    return { impactedProjects: matched, unresolved };
  }, [selectedChanges, allProjects]);

  const totalUATUsers = impactedProjects.reduce((sum, p) => sum + countUAT(p.cgmp_uatusers), 0);

  return (
    <SlidePanel
      open={open}
      onClose={onClose}
      title="Impact Analysis"
      subtitle={`${selectedChanges.length} change${selectedChanges.length !== 1 ? 's' : ''} · ${impactedProjects.length} project${impactedProjects.length !== 1 ? 's' : ''} impacted`}
      width={640}
    >
      <div className="impact-panel">
        {/* Summary chips */}
        <div className="impact-summary">
          <div className="impact-chip">
            <span className="impact-chip__value">{selectedChanges.length}</span>
            <span className="impact-chip__label">Changes Selected</span>
          </div>
          <div className="impact-chip">
            <span className="impact-chip__value" style={{ color: impactedProjects.length > 0 ? 'var(--primary)' : 'var(--text-tertiary)' }}>{impactedProjects.length}</span>
            <span className="impact-chip__label">Projects Impacted</span>
          </div>
          <div className="impact-chip">
            <span className="impact-chip__value" style={{ color: totalUATUsers > 0 ? 'var(--orange)' : 'var(--text-tertiary)' }}>{totalUATUsers}</span>
            <span className="impact-chip__label">UAT Contacts</span>
          </div>
        </div>

        {/* Selected changes list */}
        <div className="impact-section">
          <div className="impact-section__title">Selected Changes</div>
          <div className="impact-change-list">
            {selectedChanges.map(c => (
              <div key={c.cgmp_changeid} className="impact-change-row">
                <span className="change-number">{c.cgmp_changenumber}</span>
                <span className="impact-change-title">{c.cgmp_title}</span>
                <span className="impact-change-proj">
                  {c.cgmp_projectids
                    ? c.cgmp_projectids.split(',').map(s => s.trim()).filter(Boolean).map(id =>
                        allProjects.find(p => p.cgmp_projectid === id)?.cgmp_name ?? id
                      ).join(', ')
                    : 'No projects linked'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Impacted projects table */}
        <div className="impact-section">
          <div className="impact-section__title">Impacted Projects</div>
          {impactedProjects.length === 0 ? (
            <div className="impact-empty">
              {selectedChanges.some(c => c.cgmp_projectids)
                ? 'Project IDs are set but no matching project records were found.'
                : 'No project IDs linked to the selected changes.'}
            </div>
          ) : (
            <div className="impact-table-wrap">
              <table className="impact-table">
                <thead>
                  <tr>
                    <th>Project Name</th>
                    <th>Primary ISM</th>
                    <th>Backup ISM</th>
                    <th>Region</th>
                    <th>Country</th>
                    <th>UAT Users</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {impactedProjects.map(p => (
                    <tr key={p.cgmp_projectid}>
                      <td><strong style={{ color: 'var(--text-primary)' }}>{p.cgmp_name}</strong></td>
                      <td>{p.cgmp_primaryism || '—'}</td>
                      <td>{p.cgmp_backupism || '—'}</td>
                      <td>{p.cgmp_region || '—'}</td>
                      <td>{p.cgmp_country || '—'}</td>
                      <td>
                        <span className={`impact-uat-count ${countUAT(p.cgmp_uatusers) === 0 ? 'impact-uat-count--empty' : ''}`}>
                          {countUAT(p.cgmp_uatusers)}
                        </span>
                      </td>
                      <td>
                        <span className={`badge badge--status status-${String(p.cgmp_status as unknown as number) === '100000000' ? 'completed' : 'cancelled'}`}>
                          {p.cgmp_statusname ?? ((p.cgmp_status as unknown as number) === 100000000 ? 'Active' : 'Inactive')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {unresolved.length > 0 && (
            <div className="impact-unresolved">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--orange)', flexShrink: 0 }}>
                <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
              </svg>
              <span>{unresolved.length} project ID{unresolved.length > 1 ? 's' : ''} could not be resolved: {unresolved.join(', ')}</span>
            </div>
          )}
        </div>
      </div>
    </SlidePanel>
  );
}
