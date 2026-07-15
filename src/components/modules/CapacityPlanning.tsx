import { useState, useMemo, useCallback, useEffect } from 'react';
import { Cgmp_changesService } from '../../generated';
import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';
import { SlidePanel } from '../ui/Modal';

type DateRangeKey = 'last30' | 'last90' | 'next30';
type BucketMode = 'hour' | 'day';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getDateRange(key: DateRangeKey): [Date, Date] {
  const now = new Date();
  const MS_30 = 30 * 24 * 60 * 60 * 1000;
  const MS_90 = 90 * 24 * 60 * 60 * 1000;
  if (key === 'last30') return [new Date(now.getTime() - MS_30), now];
  if (key === 'last90') return [new Date(now.getTime() - MS_90), now];
  return [now, new Date(now.getTime() + MS_30)];
}

function getCellStyle(count: number, warnThreshold: number): Record<string, string> {
  if (count === 0) return { background: 'var(--surface-alt)' };
  if (count >= warnThreshold) return { background: 'color-mix(in srgb, var(--chart-3) 85%, transparent)', color: '#fff', fontWeight: '700' };
  if (count <= 2) return { background: 'color-mix(in srgb, var(--chart-1) 30%, transparent)' };
  if (count <= 5) return { background: 'color-mix(in srgb, var(--chart-1) 70%, transparent)', color: '#fff' };
  return { background: 'var(--chart-5)', color: '#fff' };
}

function CapacitySkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {Array.from({ length: 5 }).map((_, r) => (
        <div key={r} style={{ display: 'flex', gap: 4 }}>
          <div style={{ width: 130, height: 32, background: 'var(--surface)', borderRadius: 4, flexShrink: 0, border: '1px solid var(--border)' }} />
          {Array.from({ length: 8 }).map((_, c) => (
            <div key={c} style={{ flex: 1, height: 32, background: 'var(--surface)', borderRadius: 4, border: '1px solid var(--border)' }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function CapacityPlanning() {
  const [changes, setChanges] = useState<Cgmp_changes[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRangeKey>('next30');
  const [bucketMode, setBucketMode] = useState<BucketMode>('hour');
  const [warnThreshold, setWarnThreshold] = useState(5);
  const [suggestLocation, setSuggestLocation] = useState<string | null>(null);

  const loadChanges = useCallback(async () => {
    setLoading(true);
    try {
      const result = await Cgmp_changesService.getAll({
        top: 500,
        select: ['cgmp_changeid', 'cgmp_starttime', 'cgmp_endtime', 'cgmp_location', 'cgmp_status', 'cgmp_risklevel'],
      });
      setChanges(result.data ?? []);
    } catch (err) {
      if (import.meta.env.DEV) console.error('CapacityPlanning: load error', err);
      setChanges([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadChanges(); }, [loadChanges]);

  const [rangeStart, rangeEnd] = useMemo(() => getDateRange(dateRange), [dateRange]);

  const filteredChanges = useMemo(() =>
    changes.filter(c => {
      if (!c.cgmp_starttime) return false;
      const d = new Date(c.cgmp_starttime);
      return d >= rangeStart && d <= rangeEnd;
    }),
    [changes, rangeStart, rangeEnd],
  );

  const locations = useMemo(() => {
    const s = new Set<string>();
    filteredChanges.forEach(c => { if (c.cgmp_location) s.add(c.cgmp_location); });
    return [...s].sort();
  }, [filteredChanges]);

  const columns = useMemo<number[]>(() =>
    bucketMode === 'hour'
      ? Array.from({ length: 24 }, (_, i) => i)
      : Array.from({ length: 7 }, (_, i) => i),
    [bucketMode],
  );

  // heatData[location][bucket] = count of changes
  const heatData = useMemo(() => {
    const map = new Map<string, Map<number, number>>();
    filteredChanges.forEach(c => {
      const loc = c.cgmp_location;
      if (!loc || !c.cgmp_starttime) return;
      const d = new Date(c.cgmp_starttime);
      const bucket = bucketMode === 'hour' ? d.getHours() : d.getDay();
      if (!map.has(loc)) map.set(loc, new Map());
      const locMap = map.get(loc)!;
      locMap.set(bucket, (locMap.get(bucket) ?? 0) + 1);
    });
    return map;
  }, [filteredChanges, bucketMode]);

  const suggestedSlots = useMemo(() => {
    if (!suggestLocation) return [];
    const locData = heatData.get(suggestLocation);
    return columns.filter(col => !locData?.has(col) || (locData.get(col) ?? 0) === 0);
  }, [suggestLocation, heatData, columns]);

  return (
    <div className="module-workspace">
      <div className="module-header">
        <div>
          <h1 className="module-title">Capacity Planning</h1>
          <p className="module-subtitle">Change-window saturation by location and time slot</p>
        </div>
      </div>

      <div style={{ padding: '0 24px 24px' }}>
        {/* Filter bar */}
        <div className="filter-bar" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <select
            className="filter-bar__select"
            value={dateRange}
            onChange={e => setDateRange(e.target.value as DateRangeKey)}
          >
            <option value="last30">Last 30 Days</option>
            <option value="last90">Last 90 Days</option>
            <option value="next30">Next 30 Days</option>
          </select>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className={`btn btn--xs ${bucketMode === 'hour' ? 'btn--primary' : 'btn--outline'}`}
              onClick={() => setBucketMode('hour')}
            >
              By Hour
            </button>
            <button
              className={`btn btn--xs ${bucketMode === 'day' ? 'btn--primary' : 'btn--outline'}`}
              onClick={() => setBucketMode('day')}
            >
              By Day
            </button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
            Warn at
            <input
              type="number"
              min={1}
              max={100}
              value={warnThreshold}
              onChange={e => setWarnThreshold(Math.max(1, parseInt(e.target.value) || 5))}
              style={{
                width: 56, padding: '2px 6px', borderRadius: 4,
                border: '1px solid var(--border)',
                background: 'var(--surface)', color: 'var(--text-primary)', fontSize: 13,
              }}
            />
            changes
          </label>
        </div>

        {loading ? (
          <CapacitySkeleton />
        ) : locations.length === 0 ? (
          <div className="module-empty">No change data found for this date range.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{
                    textAlign: 'left', padding: '6px 10px', fontSize: 11, fontWeight: 600,
                    color: 'var(--text-secondary)', background: 'var(--surface-alt)',
                    position: 'sticky', left: 0, zIndex: 1, border: '1px solid var(--border)',
                    minWidth: 120, whiteSpace: 'nowrap',
                  }}>
                    Location
                  </th>
                  {columns.map(col => (
                    <th key={col} style={{
                      padding: '4px 3px', fontSize: 10, fontWeight: 600,
                      color: 'var(--text-secondary)', textAlign: 'center',
                      background: 'var(--surface-alt)', border: '1px solid var(--border)',
                      minWidth: bucketMode === 'hour' ? 34 : 48, whiteSpace: 'nowrap',
                    }}>
                      {bucketMode === 'hour' ? `${col}:00` : DAY_NAMES[col]}
                    </th>
                  ))}
                  <th style={{
                    padding: '4px 8px', fontSize: 11, fontWeight: 600,
                    color: 'var(--text-secondary)', textAlign: 'center',
                    background: 'var(--surface-alt)', border: '1px solid var(--border)',
                    whiteSpace: 'nowrap',
                  }}>
                    Windows
                  </th>
                </tr>
              </thead>
              <tbody>
                {locations.map(loc => {
                  const locData = heatData.get(loc);
                  return (
                    <tr key={loc}>
                      <td style={{
                        padding: '4px 10px', fontSize: 12, fontWeight: 500,
                        color: 'var(--text-primary)', background: 'var(--surface)',
                        position: 'sticky', left: 0, zIndex: 1,
                        border: '1px solid var(--border)', whiteSpace: 'nowrap',
                      }}>
                        {loc}
                      </td>
                      {columns.map(col => {
                        const count = locData?.get(col) ?? 0;
                        const cellStyle = getCellStyle(count, warnThreshold);
                        return (
                          <td
                            key={col}
                            title={`${loc} — ${bucketMode === 'hour' ? `${col}:00` : DAY_NAMES[col]}: ${count} change${count !== 1 ? 's' : ''}`}
                            style={{
                              padding: '4px 2px',
                              textAlign: 'center',
                              fontSize: 11,
                              border: '1px solid var(--border)',
                              ...cellStyle,
                            }}
                          >
                            {count > 0 ? count : ''}
                          </td>
                        );
                      })}
                      <td style={{
                        padding: '4px 8px', textAlign: 'center',
                        border: '1px solid var(--border)', background: 'var(--surface)',
                      }}>
                        <button
                          className="btn btn--xs btn--outline"
                          onClick={() => setSuggestLocation(loc)}
                          style={{ fontSize: 10, whiteSpace: 'nowrap' }}
                        >
                          Suggest
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Color legend */}
        {!loading && locations.length > 0 && (
          <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-secondary)' }}>
            {[
              { bg: 'var(--surface-alt)', border: '1px solid var(--border)', label: '0' },
              { bg: 'color-mix(in srgb, var(--chart-1) 30%, transparent)', border: 'none', label: '1–2' },
              { bg: 'color-mix(in srgb, var(--chart-1) 70%, transparent)', border: 'none', label: '3–5' },
              { bg: 'var(--chart-5)', border: 'none', label: '6–10' },
              { bg: 'color-mix(in srgb, var(--chart-3) 85%, transparent)', border: 'none', label: `≥${warnThreshold} (warn)` },
            ].map(({ bg, border, label }) => (
              <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 16, height: 16, borderRadius: 3, display: 'inline-block', flexShrink: 0, background: bg, border }} />
                {label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Suggest alternative windows panel */}
      <SlidePanel
        open={!!suggestLocation}
        onClose={() => setSuggestLocation(null)}
        title="Suggest Alternative Windows"
        subtitle={suggestLocation ? `Free time slots for ${suggestLocation}` : ''}
        width={400}
      >
        {suggestLocation && (
          <div style={{ padding: '4px 0' }}>
            {suggestedSlots.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>
                No completely free time slots found for <strong>{suggestLocation}</strong> in the selected date range.
                Consider the date range with the fewest changes instead.
              </p>
            ) : (
              <>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
                  {suggestedSlots.length} free {bucketMode === 'hour' ? 'hour' : 'day'} slot{suggestedSlots.length !== 1 ? 's' : ''} with no changes scheduled for <strong>{suggestLocation}</strong>:
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {suggestedSlots.map(col => (
                    <span key={col} style={{
                      padding: '5px 12px',
                      background: 'color-mix(in srgb, var(--success) 15%, transparent)',
                      border: '1px solid var(--success)',
                      borderRadius: 20,
                      fontSize: 13,
                      color: 'var(--text-primary)',
                      fontWeight: 500,
                    }}>
                      {bucketMode === 'hour' ? `${String(col).padStart(2, '0')}:00 – ${String(col + 1).padStart(2, '0')}:00` : DAY_NAMES[col]}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </SlidePanel>
    </div>
  );
}
