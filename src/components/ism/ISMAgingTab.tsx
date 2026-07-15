import { useState } from 'react';
import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';
import type { Cgmp_projects } from '../../generated/models/Cgmp_projectsModel';
import { STATUS, statusLabel, statusColor } from '../../hooks/useDataverse';
import { getDisplayTimezone } from '../../utils/format';

/* ─── Props ─────────────────────────────────────────────────────── */

export interface ISMAgingTabProps {
  ismProjects: Cgmp_projects[];
  changes: Cgmp_changes[];
}

/* ─── Main Tab Component ─────────────────────────────────────────── */

export default function ISMAgingTab({ ismProjects, changes }: ISMAgingTabProps) {
  const [agingThresholdDays, setAgingThresholdDays] = useState(7);

  const ismProjectIds = new Set(ismProjects.map(p => p.cgmp_projectid));
  const now = Date.now();
  const DAY = 86400000;

  const agingRows = changes
    .filter(c => {
      const s = c.cgmp_status as unknown as number;
      if (!(s === STATUS.Draft || s === STATUS.Published || s === STATUS.UnderReview || s === STATUS.Released)) return false;
      if (new Date(c.createdon ?? 0).getTime() >= now - agingThresholdDays * DAY) return false;
      const changeProjects = (c.cgmp_projectids ?? '').split(',').map(x => x.trim()).filter(Boolean);
      return changeProjects.some(pid => ismProjectIds.has(pid));
    })
    .map(c => ({
      change: c,
      age: Math.floor((now - new Date(c.createdon ?? 0).getTime()) / DAY),
      project: ismProjects.find(p => c.cgmp_projectids?.split(',').map(s => s.trim()).includes(p.cgmp_projectid)),
    }))
    .sort((a, b) => b.age - a.age);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <label className="ff-label" style={{ marginBottom: 0 }}>Flag changes pending more than</label>
        <select className="ff-input ff-select" value={agingThresholdDays}
          onChange={e => setAgingThresholdDays(Number(e.target.value))} style={{ width: 'auto' }}>
          {[3, 5, 7, 10, 14, 21, 30].map(d => <option key={d} value={d}>{d} days</option>)}
        </select>
      </div>

      {agingRows.length === 0 ? (
        <div className="ism-empty" style={{ color: 'var(--success)' }}>
          No aging changes — all pending changes are within the {agingThresholdDays}-day threshold.
        </div>
      ) : (
        <div className="ism-table-wrap">
          <table className="ism-table">
            <thead>
              <tr>
                <th>Change #</th><th>Title</th><th>Status</th><th>Age</th><th>Project</th><th>Owner</th><th>Created</th>
              </tr>
            </thead>
            <tbody>
              {agingRows.map(({ change: c, age, project: p }) => {
                const sc = c.cgmp_status as unknown as number;
                const ageClass = age > 30 ? 'red' : age > 14 ? 'orange' : 'yellow';
                return (
                  <tr key={c.cgmp_changeid}>
                    <td><span className="change-number">{c.cgmp_changenumber}</span></td>
                    <td>{c.cgmp_title}</td>
                    <td><span className={`badge badge--status ${statusColor(sc)}`}>{statusLabel(sc)}</span></td>
                    <td><span className={`age-badge age-badge--${ageClass}`}>{age}d</span></td>
                    <td>{p?.cgmp_name ?? <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</td>
                    <td>{c.cgmp_createdby || c.owneridname || '—'}</td>
                    <td>{c.createdon ? new Date(c.createdon).toLocaleDateString(undefined, { timeZone: getDisplayTimezone() }) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
