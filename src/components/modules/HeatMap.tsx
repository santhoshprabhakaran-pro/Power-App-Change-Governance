import { useMemo, useState } from 'react';
import { useChangeList } from '../../hooks/useDataverse';
import { exportCSV } from '../../utils/csv';
import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';
import { getDisplayTimezone } from '../../utils/format';

const RISK_LABEL: Record<number, string> = { 100000000: 'Low', 100000001: 'Medium', 100000002: 'High', 100000003: 'Critical' };
const CAT_LABEL: Record<number, string> = {
  100000000: 'Hardware', 100000001: 'Software', 100000002: 'Network',
  100000003: 'Security', 100000004: 'Database', 100000005: 'Application',
  100000006: 'Infrastructure', 100000007: 'Patch', 100000008: 'Other',
};

type Mode = 'region-risk' | 'region-category' | 'facility-risk' | 'country-category';
type TimeRange = '7d' | '30d' | '90d' | 'all';

const THRESHOLD = 5;

function getIntensityClass(count: number, max: number): string {
  if (count === 0) return 'hm-cell--0';
  const pct = count / max;
  if (pct <= 0.25) return 'hm-cell--1';
  if (pct <= 0.5) return 'hm-cell--2';
  if (pct <= 0.75) return 'hm-cell--3';
  return 'hm-cell--4';
}

function buildMatrix<T extends number | string>(
  changes: Cgmp_changes[],
  rowKey: (c: Cgmp_changes) => string | null,
  colKey: (c: Cgmp_changes) => T | null,
  colLabels: Record<number, string>,
): { rows: string[]; cols: string[]; data: Map<string, number>; max: number } {
  const rows = new Set<string>();
  const cols = new Set<string>();
  const data = new Map<string, number>();

  changes.forEach(c => {
    const r = rowKey(c);
    const col = colKey(c);
    if (!r || col == null) return;
    const colStr = colLabels[col as unknown as number] ?? String(col);
    rows.add(r);
    cols.add(colStr);
    const key = `${r}::${colStr}`;
    data.set(key, (data.get(key) ?? 0) + 1);
  });

  const max = Math.max(...[...data.values()], 1);
  return { rows: [...rows].sort(), cols: [...cols].sort(), data, max };
}

function HeatMapSkeleton() {
  return (
    <div className="heatmap-skeleton" aria-label="Loading heatmap data" aria-busy="true">
      {Array.from({ length: 6 }).map((_, row) => (
        <div key={row} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
          {Array.from({ length: 12 }).map((_, col) => (
            <div
              key={col}
              style={{
                width: 28,
                height: 28,
                borderRadius: 4,
                background: 'var(--border, #e5e7eb)',
                opacity: 0.5,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function HeatMap() {
  const { changes, loading } = useChangeList();
  const [mode, setMode] = useState<Mode>('region-risk');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [selectedCell, setSelectedCell] = useState<{ row: string; col: string } | null>(null);

  const filteredChanges = useMemo(() => {
    if (timeRange === 'all') return changes;
    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return changes.filter(c => c.createdon && new Date(c.createdon) >= cutoff);
  }, [changes, timeRange]);

  const matrix = useMemo(() => {
    if (mode === 'region-risk') {
      return buildMatrix(
        filteredChanges,
        c => c.cgmp_region || null,
        c => c.cgmp_risklevel as unknown as number,
        RISK_LABEL,
      );
    } else if (mode === 'facility-risk') {
      return buildMatrix(
        filteredChanges,
        c => c.cgmp_facility || null,
        c => c.cgmp_risklevel as unknown as number,
        RISK_LABEL,
      );
    } else if (mode === 'country-category') {
      return buildMatrix(
        filteredChanges,
        c => c.cgmp_country || null,
        c => c.cgmp_category as unknown as number,
        CAT_LABEL,
      );
    } else {
      return buildMatrix(
        filteredChanges,
        c => c.cgmp_region || null,
        c => c.cgmp_category as unknown as number,
        CAT_LABEL,
      );
    }
  }, [filteredChanges, mode]);

  const totalsByRow = useMemo(() => {
    const map = new Map<string, number>();
    matrix.rows.forEach(row => {
      let total = 0;
      matrix.cols.forEach(col => {
        total += matrix.data.get(`${row}::${col}`) ?? 0;
      });
      map.set(row, total);
    });
    return map;
  }, [matrix]);

  const drillChanges = useMemo(() => {
    if (!selectedCell) return [];
    return filteredChanges.filter(c => {
      let rowVal: string | null = null;
      let colVal: string | null = null;
      if (mode === 'region-risk') {
        rowVal = c.cgmp_region || null;
        colVal = RISK_LABEL[c.cgmp_risklevel as unknown as number] ?? null;
      } else if (mode === 'facility-risk') {
        rowVal = c.cgmp_facility || null;
        colVal = RISK_LABEL[c.cgmp_risklevel as unknown as number] ?? null;
      } else if (mode === 'country-category') {
        rowVal = c.cgmp_country || null;
        colVal = CAT_LABEL[c.cgmp_category as unknown as number] ?? null;
      } else {
        rowVal = c.cgmp_region || null;
        colVal = CAT_LABEL[c.cgmp_category as unknown as number] ?? null;
      }
      return rowVal === selectedCell.row && colVal === selectedCell.col;
    });
  }, [selectedCell, filteredChanges, mode]);

  const doExport = () => {
    const rowHeader = mode === 'facility-risk' ? 'Facility' : mode === 'country-category' ? 'Country' : 'Region';
    exportCSV(
      `heatmap-${mode}-${timeRange}.csv`,
      [rowHeader, ...matrix.cols, 'Total'],
      matrix.rows.map(row => [
        row,
        ...matrix.cols.map(col => String(matrix.data.get(`${row}::${col}`) ?? 0)),
        String(totalsByRow.get(row) ?? 0),
      ])
    );
  };

  return (
    <div className="module-workspace">
      <div className="module-header">
        <div>
          <h1 className="module-title">Heat Maps</h1>
          <p className="module-subtitle">Location-wise change density visualization by region and risk/category</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Time range filter */}
          <div className="hm-time-range" role="group" aria-label="Time range">
            {(['7d', '30d', '90d', 'all'] as TimeRange[]).map(tr => (
              <button
                key={tr}
                className={`btn btn--xs ${timeRange === tr ? 'btn--primary' : 'btn--outline'}`}
                onClick={() => setTimeRange(tr)}
              >
                {tr === 'all' ? 'All' : tr === '7d' ? '7D' : tr === '30d' ? '30D' : '90D'}
              </button>
            ))}
          </div>

          <div style={{ width: 1, height: 24, background: 'var(--border)' }} />

          {/* Mode buttons */}
          <button
            className={`btn btn--sm ${mode === 'region-risk' ? 'btn--primary' : 'btn--outline'}`}
            onClick={() => setMode('region-risk')}
          >
            Region × Risk
          </button>
          <button
            className={`btn btn--sm ${mode === 'region-category' ? 'btn--primary' : 'btn--outline'}`}
            onClick={() => setMode('region-category')}
          >
            Region × Category
          </button>
          <button
            className={`btn btn--sm ${mode === 'facility-risk' ? 'btn--primary' : 'btn--outline'}`}
            onClick={() => setMode('facility-risk')}
          >
            Facility × Risk
          </button>
          <button
            className={`btn btn--sm ${mode === 'country-category' ? 'btn--primary' : 'btn--outline'}`}
            onClick={() => setMode('country-category')}
          >
            Country × Category
          </button>

          <div style={{ width: 1, height: 24, background: 'var(--border)' }} />

          <button
            className="btn btn--sm btn--outline"
            onClick={doExport}
            disabled={matrix.rows.length === 0}
            title="Export matrix as CSV"
          >
            Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <HeatMapSkeleton />
      ) : filteredChanges.length === 0 ? (
        <div
          style={{
            padding: '48px 24px',
            textAlign: 'center',
            color: 'var(--text-secondary)',
          }}
          aria-live="polite"
        >
          <div style={{ fontSize: 32, marginBottom: 8 }} aria-hidden="true">📊</div>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>No changes in this time range</p>
          <p style={{ fontSize: 13 }}>Adjust your filters or date range to see activity.</p>
        </div>
      ) : (
        <div className="hm-content">
          {/* Threshold notice */}
          {matrix.max > THRESHOLD && (
            <div className="hm-threshold-notice">
              Cells with &gt;{THRESHOLD} changes are highlighted in red.
            </div>
          )}

          {/* Legend */}
          <div className="hm-legend" role="img" aria-label="Color intensity legend">
            {[
              { level: 0, label: '0' },
              { level: 1, label: '1–2' },
              { level: 2, label: '3–5' },
              { level: 3, label: '6–10' },
              { level: 4, label: '10+' },
            ].map(({ level, label }) => (
              <div key={level} className="hm-legend-item">
                <div className={`hm-legend-cell hm-cell--${level}`} aria-hidden="true" />
                <span className="hm-legend__label">{label}</span>
              </div>
            ))}
          </div>

          {/* Matrix table */}
          <div className="hm-table-wrap">
            <table className="hm-table" role="grid" aria-label="Change density heat map">
              <thead>
                <tr>
                  <th className="hm-th-region">
                    {mode === 'facility-risk' ? 'Facility' : mode === 'country-category' ? 'Country' : 'Region'}
                  </th>
                  {matrix.cols.map(col => (
                    <th key={col} className="hm-th-col">{col}</th>
                  ))}
                  <th className="hm-th-total">Total</th>
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map(row => (
                  <tr key={row}>
                    <td className="hm-td-region">{row}</td>
                    {matrix.cols.map(col => {
                      const count = matrix.data.get(`${row}::${col}`) ?? 0;
                      const isAlert = count > THRESHOLD;
                      const isSelected = selectedCell?.row === row && selectedCell?.col === col;
                      return (
                        <td
                          key={col}
                          role="gridcell"
                          className={`hm-cell ${getIntensityClass(count, matrix.max)}${isAlert ? ' hm-cell--alert' : ''}${isSelected ? ' hm-cell--selected' : ''}${count > 0 ? ' hm-cell--clickable' : ''}`}
                          aria-label={`${row} × ${col}: ${count} change${count !== 1 ? 's' : ''}${isAlert ? ' — exceeds threshold' : ''}`}
                          title={count > 0 ? `${row} / ${col}: ${count} — click to drill down${isAlert ? ' ⚠ Exceeds threshold' : ''}` : undefined}
                          onClick={() => count > 0 && setSelectedCell(isSelected ? null : { row, col })}
                        >
                          {count > 0 ? count : ''}
                        </td>
                      );
                    })}
                    <td className="hm-td-total">{totalsByRow.get(row) ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary bubbles */}
          <div className="hm-summary">
            <div className="hm-summary__title">Top Concentrations</div>
            <div className="hm-bubbles">
              {[...matrix.data.entries()]
                .sort(([, a], [, b]) => b - a)
                .slice(0, 12)
                .map(([key, count]) => {
                  const [region, col] = key.split('::');
                  const pct = Math.round((count / matrix.max) * 100);
                  return (
                    <div key={key} className="hm-bubble" style={{ opacity: 0.4 + (pct / 100) * 0.6 }}>
                      <span className="hm-bubble__count">{count}</span>
                      <span className="hm-bubble__label">{region}</span>
                      <span className="hm-bubble__sub">{col}</span>
                    </div>
                  );
                })
              }
            </div>
          </div>

          {/* Drill-down panel */}
          {selectedCell && (
            <div className="hm-drill-panel">
              <div className="hm-drill-panel__header">
                <span className="hm-drill-panel__title">
                  {selectedCell.row} × {selectedCell.col} — {drillChanges.length} change{drillChanges.length !== 1 ? 's' : ''}
                </span>
                <button className="btn btn--xs btn--outline" onClick={() => setSelectedCell(null)}>✕ Close</button>
              </div>
              <div className="hm-drill-list">
                {drillChanges.map(c => (
                  <div key={c.cgmp_changeid} className="hm-drill-row">
                    <span className="hm-drill-row__num">{c.cgmp_changenumber}</span>
                    <span className="hm-drill-row__title">{c.cgmp_title ?? '—'}</span>
                    <span className="hm-drill-row__date">{c.cgmp_starttime ? new Date(c.cgmp_starttime).toLocaleDateString(undefined, { timeZone: getDisplayTimezone() }) : '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
