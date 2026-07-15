import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { useTasks, useBridges, useChangeList, useCountdown, taskTypeLabel, priorityLabel, priorityColor, bridgeStatusLabel, formatDueDelta } from '../hooks/useDataverse';
import { Cgmp_tasksService } from '../generated';
import type { Cgmp_tasks } from '../generated/models/Cgmp_tasksModel';
import type { Cgmp_bridges } from '../generated/models/Cgmp_bridgesModel';

const QUICK_FILTERS = [
  { label: "Today's Changes", icon: '📅', page: 'pmo', title: "Today's Changes" },
  { label: 'High Risk', icon: '⚠', page: 'pmo', title: 'High Risk' },
  { label: 'Failed', icon: '✕', page: 'pmo', title: 'Failed' },
  { label: 'Pending Reviews', icon: '🔍', page: 'itops', title: 'Pending Reviews' },
  { label: 'Pending UAT', icon: '🧪', page: 'ism', title: 'Pending UAT' },
  { label: 'Active Bridges', icon: '🌉', page: 'giicc', title: 'Active Bridges' },
  { label: 'Weekend Changes', icon: '📆', page: 'pmo', title: 'Weekend Changes' },
  { label: 'Active Changes', icon: '⚡', page: 'pmo', title: 'Active' },
];

const LS_COLLAPSE = 'rp-section-collapse';
const LS_QF_HIDDEN = 'rp-quickfilter-hidden';

function loadCollapse(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(LS_COLLAPSE) ?? '{}'); } catch { return {}; }
}

function saveCollapse(state: Record<string, boolean>) {
  try { localStorage.setItem(LS_COLLAPSE, JSON.stringify(state)); } catch { /* noop */ }
}

/* ── Countdown Timer ── */
function Countdown({ target }: { target: string | undefined }) {
  const t = useCountdown(target);
  const urgent = t && !t.includes('d') && parseInt(t.split(':')[0] ?? '99') < 4;
  return <span className={`sla-time ${urgent ? 'sla-time--urgent' : ''}`}>{t}</span>;
}

/* ── Task Item ── */
function TaskItem({
  task,
  onNavigate,
  onComplete,
  completing,
}: {
  task: Cgmp_tasks;
  onNavigate: (page: string) => void;
  onComplete: (id: string) => void;
  completing: Set<string>;
}) {
  const priority = task.cgmp_priority as unknown as number;
  const pLabel = priorityLabel(priority);
  const pClass = priorityColor(priority);
  const typeLabel = taskTypeLabel(task.cgmp_type as unknown as number);
  const due = formatDueDelta(task.cgmp_duedate);
  const ref = task.cgmp_relatedchangeid
    ? `CHG-${task.cgmp_relatedchangeid.slice(-4).toUpperCase()}`
    : task.cgmp_relatedprojectid
      ? `PRJ-${task.cgmp_relatedprojectid.slice(-4).toUpperCase()}`
      : '';
  const isCompleting = completing.has(task.cgmp_taskid ?? '');

  return (
    <div className="task-item">
      <div className="task-item__left" role="button" tabIndex={0} onClick={() => onNavigate(task.cgmp_type as unknown as number === 100000001 ? 'itops' : task.cgmp_type as unknown as number === 100000000 ? 'ism' : 'pmo')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate(task.cgmp_type as unknown as number === 100000001 ? 'itops' : task.cgmp_type as unknown as number === 100000000 ? 'ism' : 'pmo'); } }} style={{ cursor: 'pointer', flex: 1 }}>
        <div className="task-item__indicator" />
        <div className="task-item__info">
          <span className="task-item__title">{typeLabel}{ref ? ` ${ref}` : ''}</span>
          <span className="task-item__due">{due}</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className={`badge badge--priority ${pClass}`}>{pLabel}</span>
        <button
          className="rp-complete-btn"
          title="Mark complete"
          disabled={isCompleting}
          onClick={e => { e.stopPropagation(); if (task.cgmp_taskid) onComplete(task.cgmp_taskid); }}
        >
          {isCompleting ? '…' : '✓'}
        </button>
      </div>
    </div>
  );
}

/* ── SLA Counters ── */
function SLACounters({ tasks }: { tasks: Cgmp_tasks[] }) {
  const slaDefs = [
    { label: 'Review Due In', type: 100000001, icon: '🔍' },
    { label: 'UAT Window Closes In', type: 100000000, icon: '🧪' },
    { label: 'Bridge Starts In', type: 100000003, icon: '🔗' },
    { label: 'Execution Starts In', type: 100000004, icon: '⚡' },
    { label: 'Auto Lock Starts In', type: 100000005, icon: '🔒' },
  ];

  const tasksByType: Record<number, Cgmp_tasks | undefined> = {};
  tasks.forEach(t => { const c = t.cgmp_type as unknown as number; if (!tasksByType[c]) tasksByType[c] = t; });

  return (
    <div className="sla-list">
      {slaDefs.map(def => {
        const task = tasksByType[def.type];
        const ref = task?.cgmp_relatedchangeid
          ? `CHG-${task.cgmp_relatedchangeid.slice(-4).toUpperCase()}`
          : task?.cgmp_relatedprojectid
            ? `PRJ-${task.cgmp_relatedprojectid.slice(-4).toUpperCase()}`
            : '—';
        return (
          <div key={def.label} className="sla-item">
            <div className="sla-item__left">
              <span className="sla-item__icon">{def.icon}</span>
              <div>
                <div className="sla-item__label">{def.label}</div>
                <div className="sla-item__ref">{ref}</div>
              </div>
            </div>
            <Countdown target={task?.cgmp_duedate} />
          </div>
        );
      })}
    </div>
  );
}

/* ── Bridge Item ── */
function BridgeItem({ bridge, onNavigate }: { bridge: Cgmp_bridges; onNavigate: (page: string) => void }) {
  const status = bridge.cgmp_status as unknown as number;
  const statusStr = bridgeStatusLabel(status);
  const isActive = status === 100000000;
  const isScheduled = status === 100000004;

  let endsIn = '';
  let isOverdue = false;

  if (isActive && bridge.cgmp_schedend) {
    const diff = new Date(bridge.cgmp_schedend).getTime() - Date.now();
    if (diff <= 0) {
      endsIn = '⚠ Overdue';
      isOverdue = true;
    } else {
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      endsIn = h > 0 ? `Ends in ${h}h ${m}m` : `Ends in ${m}m`;
    }
  } else if (isScheduled && bridge.cgmp_schedstart) {
    const diff = new Date(bridge.cgmp_schedstart).getTime() - Date.now();
    if (diff <= 0) {
      endsIn = 'Starting';
    } else {
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      endsIn = d > 0 ? `Starts in ${d}d ${h}h` : `Starts in ${h}h`;
    }
  }

  // Progress bar: elapsed time vs scheduled/actual duration
  let progressPct: number | null = null;
  if (bridge.cgmp_actualstart) {
    const now = Date.now();
    const start = new Date(bridge.cgmp_actualstart).getTime();
    const durationMs = bridge.cgmp_duration
      ? bridge.cgmp_duration * 60000
      : new Date(bridge.cgmp_schedend).getTime() - new Date(bridge.cgmp_schedstart).getTime();
    progressPct = durationMs > 0 ? (now - start) / durationMs : 0;
  }

  return (
    <div className={`bridge-item${isOverdue ? ' bridge-item--overdue' : ''}`} role="button" tabIndex={0} onClick={() => onNavigate('giicc')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate('giicc'); } }} style={{ cursor: 'pointer' }}>
      <div className="bridge-item__bar" style={{ background: isOverdue ? 'var(--danger)' : isActive ? 'var(--purple)' : 'var(--primary)' }} />
      <div className="bridge-item__content">
        <div className="bridge-item__header">
          <span className="bridge-item__name">
            {bridge.cgmp_changenumber ? `${bridge.cgmp_changenumber} - ` : ''}{bridge.cgmp_title}
          </span>
          <span className={`badge ${isActive ? 'badge--inprogress' : 'badge--review'}`}>{statusStr}</span>
        </div>
        {endsIn && (
          <span className={`bridge-item__time${isOverdue ? ' bridge-item__time--overdue' : ''}`}>{endsIn}</span>
        )}
        {progressPct !== null && (
          <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, marginTop: 6 }}>
            <div style={{ height: '100%', width: `${Math.min(progressPct * 100, 100)}%`, background: progressPct > 0.9 ? 'var(--danger)' : progressPct > 0.7 ? 'var(--warning)' : 'var(--primary)', borderRadius: 2, transition: 'width 0.3s' }} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Section Header ── */
function SectionHeader({
  title, collapsed, onToggle, action,
}: {
  title: string; collapsed: boolean; onToggle: () => void; action?: React.ReactNode;
}) {
  return (
    <div className="rp-section__header">
      <button className="rp-section__collapse-btn" onClick={onToggle} title={collapsed ? 'Expand' : 'Collapse'}>
        <span className={`rp-section__chevron${collapsed ? ' rp-section__chevron--collapsed' : ''}`}>›</span>
        <span className="rp-section__title">{title}</span>
      </button>
      {action}
    </div>
  );
}

/* ── Right Panel ── */
interface RightPanelProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function RightPanel({ collapsed, onToggleCollapse }: RightPanelProps) {
  const { navigate, showToast } = useApp();
  const { tasks, loading: tasksLoading, refresh: refreshTasks } = useTasks();
  const { bridges, loading: bridgesLoading } = useBridges();
  const { changes } = useChangeList();

  const [completing, setCompleting] = useState<Set<string>>(new Set());
  const [sections, setSections] = useState<Record<string, boolean>>(loadCollapse);
  const [hiddenQF, setHiddenQF] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(LS_QF_HIDDEN) ?? '[]')); } catch { return new Set(); }
  });
  const [qfCustomizing, setQfCustomizing] = useState(false);
  const toggleQF = useCallback((label: string) => {
    setHiddenQF(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      localStorage.setItem(LS_QF_HIDDEN, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const toggleSection = useCallback((key: string) => {
    setSections(prev => {
      const next = { ...prev, [key]: !prev[key] };
      saveCollapse(next);
      return next;
    });
  }, []);

  /* Filter out tasks referencing deleted changes */
  const activeChangeIds = useMemo(
    () => new Set(changes.map(c => c.cgmp_changeid)),
    [changes],
  );

  const filteredTasks = useMemo(
    () => tasks.filter(t =>
      !t.cgmp_relatedchangeid || activeChangeIds.has(t.cgmp_relatedchangeid)
    ),
    [tasks, activeChangeIds],
  );

  /* #123 SLA Breach Browser Notification — fire once per task when < 1 hour away.
   * Permission must be 'granted' already; we never auto-request from an effect
   * (Chrome 71+ blocks non-gesture-triggered permission requests). */
  const notifiedRef = useRef<Set<string>>(new Set());
  const urgentTasks = useMemo(() => {
    const now = Date.now();
    const cutoff = now + 3600000;
    return filteredTasks.filter(t => {
      if (!t.cgmp_duedate) return false;
      const due = new Date(t.cgmp_duedate).getTime();
      return due > now && due <= cutoff;
    });
  }, [filteredTasks]);

  useEffect(() => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    urgentTasks.forEach(t => {
      const id = t.cgmp_taskid ?? '';
      if (!id || notifiedRef.current.has(id)) return;
      notifiedRef.current.add(id);
      const typeStr = taskTypeLabel(t.cgmp_type as unknown as number);
      const ref = t.cgmp_relatedchangeid
        ? `CHG-${t.cgmp_relatedchangeid.slice(-4).toUpperCase()}`
        : t.cgmp_relatedprojectid
          ? `PRJ-${t.cgmp_relatedprojectid.slice(-4).toUpperCase()}`
          : '';
      const body = `${typeStr}${ref ? ` for ${ref}` : ''} is due in less than 1 hour.`;
      new Notification('SLA Alert — Action Required', { body, icon: '/favicon.ico', tag: id });
    });
  }, [urgentTasks]);

  const requestDesktopNotifications = useCallback(() => {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    Notification.requestPermission().then(p => {
      if (p === 'granted') showToast('success', 'Desktop notifications enabled');
    });
  }, [showToast]);

  const doCompleteTask = useCallback(async (taskId: string) => {
    setCompleting(prev => new Set(prev).add(taskId));
    try {
      const result = await Cgmp_tasksService.update(taskId, { cgmp_iscompleted: true } as any);
      if (!result.success) throw result.error ?? new Error('Update failed');
      await refreshTasks();
    } catch {
      showToast('error', 'Failed to complete task');
    } finally {
      setCompleting(prev => { const s = new Set(prev); s.delete(taskId); return s; });
    }
  }, [refreshTasks, showToast]);

  return (
    <aside className={`right-panel ${collapsed ? 'right-panel--collapsed' : ''}`} aria-label="Actions panel">
      {/* Collapse toggle */}
      <button
        className="rp-collapse-btn"
        onClick={onToggleCollapse}
        title={collapsed ? 'Expand panel' : 'Collapse panel'}
        aria-label={collapsed ? 'Expand actions panel' : 'Collapse actions panel'}
        aria-expanded={!collapsed}
        aria-controls="right-panel-content"
      >
        <svg
          className={`rp-collapse-icon ${collapsed ? 'rp-collapse-icon--collapsed' : ''}`}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
        </svg>
        {!collapsed && <span className="rp-collapse-label">Collapse</span>}
      </button>

      <div id="right-panel-content">
      {!collapsed && (
        <>
          {/* My Actions */}
          <div className="rp-section">
            <SectionHeader
              title="My Actions"
              collapsed={!!sections['actions']}
              onToggle={() => toggleSection('actions')}
              action={<button className="rp-section__link" onClick={() => navigate('pmo')}>View All</button>}
            />
            {!sections['actions'] && (
              <div className="task-list">
                {tasksLoading
                  ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 52, marginBottom: 8, borderRadius: 6 }} />)
                  : filteredTasks.length > 0
                    ? filteredTasks.slice(0, 4).map(t => (
                        <TaskItem
                          key={t.cgmp_taskid}
                          task={t}
                          onNavigate={navigate}
                          onComplete={doCompleteTask}
                          completing={completing}
                        />
                      ))
                    : <div className="rp-empty">No pending actions</div>
                }
              </div>
            )}
          </div>

          {/* SLA Counters */}
          <div className="rp-section">
            <SectionHeader
              title="SLA Counters"
              collapsed={!!sections['sla']}
              onToggle={() => toggleSection('sla')}
              action={<button className="rp-section__link" onClick={() => navigate('pmo')}>View All</button>}
            />
            {!sections['sla'] && (
              tasksLoading
                ? Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 44, marginBottom: 6, borderRadius: 4 }} />)
                : <SLACounters tasks={filteredTasks} />
            )}
          </div>

          {/* Desktop notification permission prompt */}
          {'Notification' in window && Notification.permission === 'default' && (
            <div style={{ padding: '8px 12px', background: 'var(--surface-alt)', borderRadius: 6, margin: '0 0 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Enable desktop alerts for urgent tasks</span>
              <button className="btn btn--outline" style={{ padding: '3px 8px', fontSize: 11 }} onClick={requestDesktopNotifications}>
                Enable
              </button>
            </div>
          )}

          {/* Active Bridges */}
          <div className="rp-section">
            <SectionHeader
              title="Active Bridges"
              collapsed={!!sections['bridges']}
              onToggle={() => toggleSection('bridges')}
              action={<button className="rp-section__link" onClick={() => navigate('giicc')}>View All</button>}
            />
            {!sections['bridges'] && (
              <div className="bridge-list">
                {bridgesLoading
                  ? Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 56, marginBottom: 8, borderRadius: 6 }} />)
                  : bridges.length > 0
                    ? bridges.slice(0, 4).map(b => <BridgeItem key={b.cgmp_bridgeid} bridge={b} onNavigate={navigate} />)
                    : <div className="rp-empty">No active bridges</div>
                }
                <button className="btn-create-bridge" onClick={() => navigate('giicc')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
                  Create New Bridge
                </button>
              </div>
            )}
          </div>

          {/* Quick Filters (#125) */}
          <div className="rp-section">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <SectionHeader
                title="Quick Filters"
                collapsed={!!sections['quickfilters']}
                onToggle={() => toggleSection('quickfilters')}
              />
              <button
                onClick={() => setQfCustomizing(c => !c)}
                style={{ fontSize: 10, color: qfCustomizing ? 'var(--primary)' : 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }}
                title="Customize visible quick filters"
              >
                {qfCustomizing ? 'Done' : 'Customize'}
              </button>
            </div>
            {!sections['quickfilters'] && (
              <div className="quick-filter-grid">
                {QUICK_FILTERS.filter(qf => qfCustomizing || !hiddenQF.has(qf.label)).map(qf => {
                  const hidden = hiddenQF.has(qf.label);
                  return (
                    <div key={qf.label} style={{ position: 'relative' }}>
                      <button
                        className="quick-filter-btn"
                        onClick={() => !qfCustomizing && navigate(qf.page)}
                        title={qfCustomizing ? (hidden ? 'Click to show' : 'Click to hide') : qf.title}
                        style={{ opacity: qfCustomizing && hidden ? 0.4 : 1, cursor: qfCustomizing ? 'pointer' : undefined }}
                      >
                        <span className="quick-filter-icon">{qf.icon}</span>
                        <span className="quick-filter-label">{qf.label}</span>
                      </button>
                      {qfCustomizing && (
                        <button
                          onClick={() => toggleQF(qf.label)}
                          style={{ position: 'absolute', top: 2, right: 2, fontSize: 9, background: hidden ? 'var(--surface-alt)' : 'var(--primary)', color: hidden ? 'var(--text-secondary)' : '#fff', border: 'none', borderRadius: 3, padding: '1px 4px', cursor: 'pointer', lineHeight: 1.4 }}
                          title={hidden ? 'Pin (show)' : 'Unpin (hide)'}
                        >
                          {hidden ? '＋' : '✕'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
      </div>
    </aside>
  );
}
