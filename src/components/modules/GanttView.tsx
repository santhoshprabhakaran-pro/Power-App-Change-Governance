import { useState, useMemo } from 'react';
import { useChanges } from '../../context/ChangesContext';
import { useApp } from '../../context/AppContext';
import { riskColor } from '../../hooks/useDataverse';
import { getDisplayTimezone } from '../../utils/format';

interface GanttBar {
  id: string;
  label: string;
  location: string;
  start: Date;
  end: Date;
  status: number;
  risk: number;
  isEmergency: boolean;
}

const WINDOW_DAYS = 14;
const MS_PER_DAY = 86_400_000;

const RISK_LABELS: Record<string, string> = {
  'risk-low': 'Low',
  'risk-medium': 'Medium',
  'risk-high': 'High',
  'risk-critical': 'Critical',
};

export default function GanttView() {
  const { changes } = useChanges();
  const { navigate } = useApp();

  const [windowStart, setWindowStart] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const windowEnd = useMemo(() => new Date(windowStart.getTime() + WINDOW_DAYS * MS_PER_DAY), [windowStart]);

  const bars = useMemo<GanttBar[]>(
    () =>
      changes
        .filter((c) => c.cgmp_starttime && c.cgmp_endtime)
        .filter((c) => new Date(c.cgmp_endtime) >= windowStart && new Date(c.cgmp_starttime) <= windowEnd)
        .map((c) => ({
          id: c.cgmp_changeid,
          label: `${c.cgmp_changenumber ?? ''}: ${(c.cgmp_title ?? '').slice(0, 30)}`,
          location: c.cgmp_location ?? 'Unknown',
          start: new Date(c.cgmp_starttime),
          end: new Date(c.cgmp_endtime),
          status: c.cgmp_status as unknown as number,
          risk: c.cgmp_risklevel as unknown as number,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isEmergency: !!(c as any).cgmp_isemergency,
        })),
    [changes, windowStart, windowEnd]
  );

  const byLocation = useMemo(() => {
    const map = new Map<string, GanttBar[]>();
    for (const b of bars) {
      if (!map.has(b.location)) map.set(b.location, []);
      map.get(b.location)!.push(b);
    }
    return map;
  }, [bars]);

  const windowMs = windowEnd.getTime() - windowStart.getTime();

  const dateLabels = useMemo<string[]>(() => {
    const tz = getDisplayTimezone();
    const labels: string[] = [];
    for (let i = 0; i <= WINDOW_DAYS; i += 2) {
      const d = new Date(windowStart.getTime() + i * MS_PER_DAY);
      labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz }));
    }
    return labels;
  }, [windowStart]);

  function shiftWindow(direction: -1 | 1) {
    setWindowStart((d) => new Date(d.getTime() + direction * WINDOW_DAYS * MS_PER_DAY));
  }

  function resetToToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    setWindowStart(d);
  }

  return (
    <div className="module-workspace">
      <div className="module-header">
        <div>
          <h1 className="module-title">Timeline</h1>
          <p className="module-subtitle">14-day change schedule grouped by location</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--outline btn--sm" onClick={() => shiftWindow(-1)}>
            ← Prev
          </button>
          <button className="btn btn--outline btn--sm" onClick={resetToToday}>
            Today
          </button>
          <button className="btn btn--outline btn--sm" onClick={() => shiftWindow(1)}>
            Next →
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 16, overflowX: 'auto' }}>
        {/* Date header */}
        <div className="gantt-header">
          <div className="gantt-header-label" />
          <div className="gantt-header-dates">
            {dateLabels.map((lbl, i) => (
              <span key={i}>{lbl}</span>
            ))}
          </div>
        </div>

        {/* Risk legend */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap', paddingLeft: 140 }}>
          {Object.entries(RISK_LABELS).map(([cls, lbl]) => (
            <div key={cls} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
              <div
                className={`gantt-bar ${cls}`}
                style={{ width: 20, height: 10, borderRadius: 3, flexShrink: 0, position: 'relative' }}
              />
              <span style={{ color: 'var(--text-secondary)' }}>{lbl}</span>
            </div>
          ))}
        </div>

        {/* Location rows */}
        {byLocation.size === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
            No changes scheduled in this 14-day window
          </div>
        ) : (
          Array.from(byLocation.entries()).map(([loc, locBars]) => (
            <div key={loc} className="gantt-row">
              <div className="gantt-label" title={loc}>
                {loc}
              </div>
              <div className="gantt-track" style={{ position: 'relative', height: 32 }}>
                {locBars.map((bar) => {
                  const leftPct = Math.max(0, (bar.start.getTime() - windowStart.getTime()) / windowMs) * 100;
                  const rawWidthPct = ((bar.end.getTime() - bar.start.getTime()) / windowMs) * 100;
                  const widthPct = Math.min(100 - leftPct, Math.max(rawWidthPct, 0.5));
                  return (
                    <div
                      key={bar.id}
                      className={`gantt-bar ${riskColor(bar.risk)}`}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        position: 'absolute',
                        height: 24,
                        borderRadius: 4,
                        top: 4,
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                        fontSize: 11,
                        padding: '4px 6px',
                        cursor: 'pointer',
                      }}
                      title={bar.label}
                      onClick={() => navigate('pmo')}
                      role="button"
                      aria-label={`View change: ${bar.label}`}
                    >
                      {bar.label}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
