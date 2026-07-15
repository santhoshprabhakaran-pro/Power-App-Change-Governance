import { useState, useMemo } from 'react';
import type { Cgmp_projects } from '../../generated/models/Cgmp_projectsModel';
import { PROJ_STATUS_LABEL, PROJ_STATUS_CLASS } from './ISMPanels';
import { exportCSV } from '../../utils/csv';

/* ─── Types ─────────────────────────────────────────────────────── */

interface ComplianceRow {
  project: Cgmp_projects;
  total: number;
  completed: number;
  failed: number;
  pending: number;
  sla: number;
  uat: number;
}

type SortKey = 'name' | 'total' | 'completed' | 'failed' | 'pending' | 'sla';

/* ─── Props ─────────────────────────────────────────────────────── */

export interface ISMComplianceTabProps {
  complianceRows: ComplianceRow[];
}

/* ─── Sortable Column Header ─────────────────────────────────────── */

function CompTh({
  label, k, sortKey, sortAsc, onSort,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortAsc: boolean;
  onSort: (k: SortKey) => void;
}) {
  return (
    <th className="dt__th dt__th--sortable"
      onClick={() => onSort(k)}
      aria-sort={sortKey === k ? (sortAsc ? 'ascending' : 'descending') : 'none'}
    >
      {label}{sortKey === k ? (sortAsc ? ' ▲' : ' ▼') : ' ⇅'}
    </th>
  );
}

/* ─── Main Tab Component ─────────────────────────────────────────── */

export default function ISMComplianceTab({ complianceRows }: ISMComplianceTabProps) {
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);

  const handleSort = (k: SortKey) => {
    if (sortKey === k) setSortAsc(a => !a);
    else { setSortKey(k); setSortAsc(true); }
  };

  const sorted = useMemo(() => {
    return [...complianceRows].sort((a, b) => {
      const av = sortKey === 'name' ? a.project.cgmp_name ?? '' : a[sortKey as Exclude<SortKey, 'name'>];
      const bv = sortKey === 'name' ? b.project.cgmp_name ?? '' : b[sortKey as Exclude<SortKey, 'name'>];
      const cmp = typeof av === 'number' ? av - (bv as number) : String(av).localeCompare(String(bv));
      return sortAsc ? cmp : -cmp;
    });
  }, [complianceRows, sortKey, sortAsc]);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button
          className="btn btn--outline btn--sm"
          onClick={() => exportCSV(
            `ism-compliance-${new Date().toISOString().slice(0, 10)}.csv`,
            ['Project', 'Status', 'Total', 'Completed', 'Failed', 'Pending', 'SLA %', 'UAT Users'],
            sorted.map(({ project: p, total, completed, failed, pending, sla, uat }) => [
              p.cgmp_name ?? '',
              PROJ_STATUS_LABEL[p.cgmp_status as unknown as number] ?? '',
              String(total), String(completed), String(failed), String(pending),
              `${sla}%`, String(uat),
            ])
          )}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 4 }}>
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
          </svg>
          Export CSV
        </button>
      </div>

      <div className="ism-table-wrap">
        <table className="ism-table">
          <thead>
            <tr>
              <CompTh label="Project" k="name" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
              <th>Status</th>
              <CompTh label="Total" k="total" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
              <CompTh label="Completed" k="completed" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
              <CompTh label="Failed" k="failed" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
              <CompTh label="Pending" k="pending" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
              <CompTh label="SLA %" k="sla" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
              <th>UAT Users</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={8} className="ism-table__empty">No projects assigned to you.</td></tr>
            ) : sorted.map(({ project: p, total, completed, failed, pending, sla, uat }) => (
              <tr key={p.cgmp_projectid}>
                <td><strong style={{ color: 'var(--text-primary)' }}>{p.cgmp_name}</strong></td>
                <td>
                  <span className={`badge badge--status ${PROJ_STATUS_CLASS[p.cgmp_status as unknown as number] ?? 'status-draft'}`}>
                    {PROJ_STATUS_LABEL[p.cgmp_status as unknown as number] ?? 'Unknown'}
                  </span>
                </td>
                <td>{total}</td>
                <td style={{ color: completed > 0 ? 'var(--success)' : 'var(--text-tertiary)' }}>{completed}</td>
                <td style={{ color: failed > 0 ? 'var(--danger)' : 'var(--text-tertiary)' }}>{failed}</td>
                <td style={{ color: pending > 0 ? 'var(--orange)' : 'var(--text-tertiary)' }}>{pending}</td>
                <td>
                  <span className={`sla-badge ${sla >= 95 ? 'sla-badge--green' : sla >= 80 ? 'sla-badge--orange' : 'sla-badge--red'}`}>
                    {sla}%
                  </span>
                </td>
                <td style={{ color: uat === 0 ? 'var(--danger)' : undefined }}>{uat}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
