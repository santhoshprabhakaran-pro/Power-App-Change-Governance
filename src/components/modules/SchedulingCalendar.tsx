import { useState, useMemo, useCallback, useEffect } from 'react';
import { Cgmp_changesService } from '../../generated';
import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';
import { useApp } from '../../context/AppContext';
import { STATUS_LABEL_MAP, RISK_LABEL_MAP } from '../../utils/roles';

const STATUS_LABEL = STATUS_LABEL_MAP;
const RISK_LABEL = RISK_LABEL_MAP;

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface CalendarCell {
  day: number;
  currentMonth: boolean;
}

function getBarColor(c: Cgmp_changes): string {
  const status = c.cgmp_status as unknown as number;
  const risk = c.cgmp_risklevel as unknown as number;
  if (status === 100000008 || risk === 100000003) return 'var(--danger)';
  if (risk === 100000002) return 'var(--warning)';
  if (status === 100000007 || status === 100000009 || status === 100000010) return 'var(--text-secondary)';
  return 'var(--primary)';
}

function buildCalendarCells(year: number, month: number): CalendarCell[] {
  const firstDow = new Date(year, month, 1).getDay(); // 0=Sun
  const pad = firstDow === 0 ? 6 : firstDow - 1;     // Mon-based offset
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDaysInMonth = new Date(year, month, 0).getDate();
  const total = Math.ceil((pad + daysInMonth) / 7) * 7;
  const cells: CalendarCell[] = [];
  for (let i = pad - 1; i >= 0; i--) cells.push({ day: prevDaysInMonth - i, currentMonth: false });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, currentMonth: true });
  let nextDay = 1;
  while (cells.length < total) cells.push({ day: nextDay++, currentMonth: false });
  return cells;
}

function CalendarSkeleton() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
      {Array.from({ length: 35 }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 84, borderRadius: 6,
            background: 'var(--surface)',
            opacity: 0.6,
          }}
        />
      ))}
    </div>
  );
}

export default function SchedulingCalendar() {
  const { navigate, showToast } = useApp();
  const today = useMemo(() => new Date(), []);
  const [changes, setChanges] = useState<Cgmp_changes[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
  const [weekOffset, setWeekOffset] = useState(0);
  const [locFilter, setLocFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const loadChanges = useCallback(async () => {
    setLoading(true);
    try {
      const result = await Cgmp_changesService.getAll({
        orderBy: ['cgmp_starttime asc'],
        top: 500,
        select: ['cgmp_changeid', 'cgmp_changenumber', 'cgmp_title', 'cgmp_starttime', 'cgmp_endtime', 'cgmp_status', 'cgmp_risklevel', 'cgmp_location'],
      });
      setChanges(result.data ?? []);
    } catch (err) {
      if (import.meta.env.DEV) console.error('SchedulingCalendar: load error', err);
      setChanges([]);
      showToast('error', 'Failed to load changes');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadChanges(); }, [loadChanges]);

  const locations = useMemo(() => {
    const s = new Set<string>();
    changes.forEach(c => { if (c.cgmp_location) s.add(c.cgmp_location); });
    return [...s].sort();
  }, [changes]);

  const filtered = useMemo(() => {
    let list = changes;
    if (locFilter) list = list.filter(c => c.cgmp_location === locFilter);
    if (riskFilter) list = list.filter(c => (c.cgmp_risklevel as unknown as number) === parseInt(riskFilter));
    if (statusFilter) list = list.filter(c => (c.cgmp_status as unknown as number) === parseInt(statusFilter));
    return list;
  }, [changes, locFilter, riskFilter, statusFilter]);

  const calendarCells = useMemo(() => buildCalendarCells(year, month), [year, month]);

  // Map day-of-month → changes starting on that day (for month view)
  const changesByDay = useMemo(() => {
    const map = new Map<number, Cgmp_changes[]>();
    filtered.forEach(c => {
      if (!c.cgmp_starttime) return;
      const d = new Date(c.cgmp_starttime);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate();
        const arr = map.get(day) ?? [];
        arr.push(c);
        map.set(day, arr);
      }
    });
    return map;
  }, [filtered, year, month]);

  // Week view: 7-day window starting from Monday of current week + offset
  const weekDays = useMemo(() => {
    const now = new Date();
    const dow = now.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff + weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
  }, [weekOffset]);

  const weekChangesByDateKey = useMemo(() => {
    const map = new Map<string, Cgmp_changes[]>();
    filtered.forEach(c => {
      if (!c.cgmp_starttime) return;
      const d = new Date(c.cgmp_starttime);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
    });
    return map;
  }, [filtered]);

  const prevPeriod = () => {
    if (viewMode === 'month') {
      if (month === 0) { setYear(y => y - 1); setMonth(11); }
      else setMonth(m => m - 1);
    } else {
      setWeekOffset(w => w - 1);
    }
  };
  const nextPeriod = () => {
    if (viewMode === 'month') {
      if (month === 11) { setYear(y => y + 1); setMonth(0); }
      else setMonth(m => m + 1);
    } else {
      setWeekOffset(w => w + 1);
    }
  };

  const periodLabel = viewMode === 'month'
    ? `${MONTH_NAMES[month]} ${year}`
    : weekDays.length > 0
      ? `${MONTH_NAMES[weekDays[0].getMonth()]} ${weekDays[0].getDate()} – ${MONTH_NAMES[weekDays[6].getMonth()]} ${weekDays[6].getDate()}, ${weekDays[6].getFullYear()}`
      : '';

  return (
    <div className="module-workspace">
      <div className="module-header">
        <div>
          <h1 className="module-title">Scheduling Calendar</h1>
          <p className="module-subtitle">Monthly view of all scheduled changes</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className={`btn btn--xs ${viewMode === 'month' ? 'btn--primary' : 'btn--outline'}`}
            onClick={() => setViewMode('month')}
          >
            Month
          </button>
          <button
            className={`btn btn--xs ${viewMode === 'week' ? 'btn--primary' : 'btn--outline'}`}
            onClick={() => setViewMode('week')}
          >
            Week
          </button>
          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
          <button className="btn btn--xs btn--outline" onClick={prevPeriod} aria-label="Previous period">&#8249;</button>
          <span style={{ fontWeight: 600, minWidth: 220, textAlign: 'center', fontSize: 13, color: 'var(--text-primary)' }}>
            {periodLabel}
          </span>
          <button className="btn btn--xs btn--outline" onClick={nextPeriod} aria-label="Next period">&#8250;</button>
        </div>
      </div>

      <div style={{ padding: '0 24px 24px' }}>
        {/* Filter bar */}
        <div className="filter-bar" style={{ marginBottom: 16 }}>
          <select
            className="filter-bar__select"
            value={locFilter}
            onChange={e => setLocFilter(e.target.value)}
          >
            <option value="">All Locations</option>
            {locations.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <select
            className="filter-bar__select"
            value={riskFilter}
            onChange={e => setRiskFilter(e.target.value)}
          >
            <option value="">All Risk Levels</option>
            {Object.entries(RISK_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select
            className="filter-bar__select"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="">All Statuses</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-secondary)' }}>
          {[
            { color: 'var(--danger)', label: 'Critical / Failed' },
            { color: 'var(--warning)', label: 'High Risk' },
            { color: 'var(--primary)', label: 'Normal' },
            { color: 'var(--text-secondary)', label: 'Completed / Cancelled' },
          ].map(({ color, label }) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
              {label}
            </span>
          ))}
        </div>

        {loading ? (
          <CalendarSkeleton />
        ) : viewMode === 'month' ? (
          <>
            {/* Day-of-week header row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
              {WEEK_DAYS.map(d => (
                <div key={d} style={{
                  textAlign: 'center', fontSize: 11, fontWeight: 600,
                  color: 'var(--text-secondary)', padding: '4px 0',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>
                  {d}
                </div>
              ))}
            </div>
            {/* Calendar cells */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
              {calendarCells.map((cell, idx) => {
                const isToday =
                  cell.currentMonth &&
                  cell.day === today.getDate() &&
                  month === today.getMonth() &&
                  year === today.getFullYear();
                const dayChanges = cell.currentMonth ? (changesByDay.get(cell.day) ?? []) : [];
                return (
                  <div
                    key={idx}
                    style={{
                      minHeight: 84,
                      background: cell.currentMonth ? 'var(--surface)' : 'var(--surface-alt)',
                      border: `1px solid ${isToday ? 'var(--primary)' : 'var(--border)'}`,
                      borderRadius: 6,
                      padding: '4px 6px',
                      opacity: cell.currentMonth ? 1 : 0.4,
                    }}
                  >
                    <div style={{
                      fontSize: 11, fontWeight: isToday ? 700 : 400,
                      color: isToday ? 'var(--primary)' : 'var(--text-primary)',
                      marginBottom: 3,
                    }}>
                      {cell.day}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {dayChanges.slice(0, 3).map(c => (
                        <button
                          key={c.cgmp_changeid}
                          onClick={() => navigate('pmo')}
                          title={`${c.cgmp_changenumber}: ${c.cgmp_title}`}
                          style={{
                            background: getBarColor(c),
                            color: '#fff',
                            border: 'none',
                            borderRadius: 3,
                            padding: '1px 4px',
                            fontSize: 10,
                            textAlign: 'left',
                            cursor: 'pointer',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: '100%',
                            display: 'block',
                          }}
                        >
                          {c.cgmp_changenumber} {c.cgmp_title}
                        </button>
                      ))}
                      {dayChanges.length > 3 && (
                        <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                          +{dayChanges.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          /* Week view */
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
              {weekDays.map(d => {
                const isToday = d.toDateString() === today.toDateString();
                return (
                  <div key={d.toISOString()} style={{
                    textAlign: 'center', fontSize: 11, fontWeight: 600,
                    color: isToday ? 'var(--primary)' : 'var(--text-secondary)',
                    padding: '4px 0', textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    {WEEK_DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1]} {d.getDate()}
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
              {weekDays.map(d => {
                const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
                const dayChanges = weekChangesByDateKey.get(key) ?? [];
                const isToday = d.toDateString() === today.toDateString();
                return (
                  <div key={key} style={{
                    minHeight: 120,
                    background: 'var(--surface)',
                    border: `1px solid ${isToday ? 'var(--primary)' : 'var(--border)'}`,
                    borderRadius: 6,
                    padding: '6px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}>
                    {dayChanges.length === 0 ? (
                      <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>No changes</span>
                    ) : (
                      dayChanges.map(c => (
                        <button
                          key={c.cgmp_changeid}
                          onClick={() => navigate('pmo')}
                          title={`${c.cgmp_changenumber}: ${c.cgmp_title}`}
                          style={{
                            background: getBarColor(c),
                            color: '#fff',
                            border: 'none',
                            borderRadius: 3,
                            padding: '2px 4px',
                            fontSize: 10,
                            textAlign: 'left',
                            cursor: 'pointer',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: '100%',
                            display: 'block',
                          }}
                        >
                          {c.cgmp_changenumber} {c.cgmp_title}
                        </button>
                      ))
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
