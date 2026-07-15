import { useState, useMemo, useCallback, useEffect } from 'react';
import { Cgmp_tasksService, Cgmp_changesService, Cgmp_userprofilesService } from '../../generated';
import type { Cgmp_tasks } from '../../generated/models/Cgmp_tasksModel';
import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';
import type { Cgmp_userprofiles } from '../../generated/models/Cgmp_userprofilesModel';
import { useApp } from '../../context/AppContext';
import { fmtDate, fmtDateTime } from '../../utils/format';
import { TASK_TYPE_LABEL_MAP, PRIORITY_LABEL_MAP } from '../../utils/roles';
import DataTable from '../ui/DataTable';
import type { Column } from '../ui/DataTable';
import { SlidePanel } from '../ui/Modal';
import ConfirmDialog from '../ui/ConfirmDialog';
import FilteredSelect from '../ui/FilteredSelect';

/* ── Row casting helpers ── */
type AnyRow = { [key: string]: unknown };
const asTask = (r: AnyRow): Cgmp_tasks => r as unknown as Cgmp_tasks;

/* ── Static option sets (derived from canonical label maps) ── */
const TASK_TYPE_OPTIONS = Object.entries(TASK_TYPE_LABEL_MAP).map(([value, label]) => ({ value, label }));
const PRIORITY_OPTIONS = Object.entries(PRIORITY_LABEL_MAP).map(([value, label]) => ({ value, label }));

const PRIORITY_BADGE: Record<number, string> = {
  100000000: 'priority-high',
  100000001: 'priority-medium',
  100000002: 'priority-low',
};

/* ── Form state ── */
type TaskForm = {
  title: string;
  type: string;
  priority: string;
  dueDate: string;
  relatedChangeId: string;
  assignedTo: string;
};

const EMPTY_FORM: TaskForm = {
  title: '',
  type: '100000001',      // ReviewChange default
  priority: '100000001',  // Medium default
  dueDate: '',
  relatedChangeId: '',
  assignedTo: '',
};

export default function TaskManager() {
  const { showToast, isAdmin } = useApp();

  /* ── Data state ── */
  const [tasks, setTasks] = useState<Cgmp_tasks[]>([]);
  const [changes, setChanges] = useState<Cgmp_changes[]>([]);
  const [users, setUsers] = useState<Cgmp_userprofiles[]>([]);
  const [loading, setLoading] = useState(true);

  /* ── Filter state ── */
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  /* ── Panel / dialog state ── */
  const [createOpen, setCreateOpen] = useState(false);
  const [detailTask, setDetailTask] = useState<Cgmp_tasks | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Cgmp_tasks | null>(null);
  const [resolveTarget, setResolveTarget] = useState<Cgmp_tasks | null>(null);
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /* ── Form state ── */
  const [form, setForm] = useState<TaskForm>(EMPTY_FORM);

  /* ── Data loading ── */
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [tasksResult, changesResult, usersResult] = await Promise.all([
        Cgmp_tasksService.getAll({
          orderBy: ['createdon desc'],
          top: 200,
          select: [
            'cgmp_taskid', 'cgmp_title', 'cgmp_type', 'cgmp_priority', 'cgmp_duedate',
            'cgmp_relatedchangeid', 'cgmp_assignedto', 'cgmp_iscompleted',
            'cgmp_completedat', 'createdon',
          ] as any,
        }),
        Cgmp_changesService.getAll({
          orderBy: ['cgmp_changenumber asc'],
          top: 500,
          select: ['cgmp_changeid', 'cgmp_changenumber', 'cgmp_title', 'cgmp_status'] as any,
        }),
        Cgmp_userprofilesService.getAll({
          filter: 'cgmp_isactive eq true',
          select: ['cgmp_userprofileid', 'cgmp_userprincipalname', 'owneridname'] as any,
        }),
      ]);
      setTasks(tasksResult.data ?? []);
      setChanges(changesResult.data ?? []);
      setUsers(usersResult.data ?? []);
    } catch (err) {
      if (import.meta.env.DEV) console.error('TaskManager: data load failed', err);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  /* ── Derived lookups ── */
  const changeMap = useMemo(() => {
    const m = new Map<string, Cgmp_changes>();
    changes.forEach(c => m.set(c.cgmp_changeid, c));
    return m;
  }, [changes]);

  const changeOptions = useMemo(() => [
    { value: '', label: 'None' },
    ...changes.map(c => ({
      value: c.cgmp_changeid,
      label: `${c.cgmp_changenumber} — ${c.cgmp_title ?? ''}`,
    })),
  ], [changes]);

  const userOptions = useMemo(() => [
    { value: '', label: 'Unassigned' },
    ...users.map(u => ({
      value: u.cgmp_userprincipalname,
      label: u.owneridname || u.cgmp_userprincipalname,
    })),
  ], [users]);

  /* ── Filtering ── */
  const filtered = useMemo(() => {
    let list = tasks;
    if (statusFilter === 'open') list = list.filter(t => !t.cgmp_iscompleted);
    else if (statusFilter === 'resolved') list = list.filter(t => !!t.cgmp_iscompleted);
    if (priorityFilter) list = list.filter(t => String(t.cgmp_priority as unknown as number) === priorityFilter);
    if (typeFilter) list = list.filter(t => String(t.cgmp_type as unknown as number) === typeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        t.cgmp_title?.toLowerCase().includes(q) ||
        t.cgmp_assignedto?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [tasks, statusFilter, priorityFilter, typeFilter, search]);

  const filteredRows = filtered as unknown as AnyRow[];

  /* ── Form handlers ── */
  const setFormField = (k: keyof TaskForm) => (val: string) =>
    setForm(prev => ({ ...prev, [k]: val }));

  const setFormFieldEvent = (k: keyof TaskForm) => (e: { target: { value: string } }) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  /* ── Create task ── */
  const handleCreate = async () => {
    if (!form.title.trim()) { showToast('error', 'Task name is required'); return; }
    setSaving(true);
    try {
      const result = await Cgmp_tasksService.create({
        cgmp_title: form.title.trim(),
        cgmp_type: Number(form.type) as any,
        cgmp_priority: Number(form.priority) as any,
        cgmp_duedate: form.dueDate || undefined,
        cgmp_relatedchangeid: form.relatedChangeId || undefined,
        cgmp_assignedto: form.assignedTo || undefined,
        ownerid: '',
        owneridtype: '',
        statecode: 0 as any,
      });
      if (!result.success) throw result.error ?? new Error('Failed to create task');
      showToast('success', 'Task created successfully');
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setSaving(false);
    }
  };

  /* ── Mark resolved ── */
  const handleMarkResolved = async () => {
    if (!resolveTarget) return;
    setResolving(true);
    try {
      await Cgmp_tasksService.update(resolveTarget.cgmp_taskid, {
        cgmp_iscompleted: true,
        cgmp_completedat: new Date().toISOString(),
      });
      showToast('success', 'Task marked as resolved');
      setResolveTarget(null);
      loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to resolve task');
    } finally {
      setResolving(false);
    }
  };

  /* ── Delete task ── */
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await Cgmp_tasksService.delete(deleteTarget.cgmp_taskid);
      showToast('success', 'Task deleted');
      setDeleteTarget(null);
      loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to delete task');
    } finally {
      setDeleting(false);
    }
  };

  /* ── DataTable column definitions ── */
  const columns = useMemo((): Column<AnyRow>[] => [
    {
      key: 'cgmp_title',
      label: 'Task Name',
      sortable: true,
      render: (_: unknown, row: AnyRow) => {
        const t = asTask(row);
        return (
          <button
            className="kb-review-title-link"
            style={{ textAlign: 'left', fontWeight: 500, maxWidth: 260 }}
            onClick={() => setDetailTask(t)}
          >
            {t.cgmp_title || '—'}
          </button>
        );
      },
    },
    {
      key: 'cgmp_type',
      label: 'Type',
      sortable: true,
      width: 170,
      render: (_: unknown, row: AnyRow) => {
        const code = asTask(row).cgmp_type as unknown as number;
        return <span style={{ fontSize: 12 }}>{TASK_TYPE_LABEL_MAP[code] ?? '—'}</span>;
      },
    },
    {
      key: 'cgmp_priority',
      label: 'Priority',
      sortable: true,
      width: 95,
      render: (_: unknown, row: AnyRow) => {
        const code = asTask(row).cgmp_priority as unknown as number;
        return (
          <span className={`badge badge--status ${PRIORITY_BADGE[code] ?? ''}`}>
            {PRIORITY_LABEL_MAP[code] ?? '—'}
          </span>
        );
      },
    },
    {
      key: 'cgmp_duedate',
      label: 'Due Date',
      sortable: true,
      width: 110,
      render: (_: unknown, row: AnyRow) => (
        <span style={{ fontSize: 12 }}>{fmtDate(asTask(row).cgmp_duedate)}</span>
      ),
    },
    {
      key: 'cgmp_relatedchangeid',
      label: 'Linked Change',
      width: 130,
      render: (_: unknown, row: AnyRow) => {
        const t = asTask(row);
        if (!t.cgmp_relatedchangeid) return <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>—</span>;
        const c = changeMap.get(t.cgmp_relatedchangeid);
        return <span style={{ fontSize: 12 }}>{c ? c.cgmp_changenumber : t.cgmp_relatedchangeid}</span>;
      },
    },
    {
      key: 'cgmp_assignedto',
      label: 'Assigned To',
      sortable: true,
      width: 150,
      render: (_: unknown, row: AnyRow) => {
        const val = asTask(row).cgmp_assignedto;
        return val
          ? <span style={{ fontSize: 12 }}>{val}</span>
          : <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Unassigned</span>;
      },
    },
    {
      key: 'cgmp_iscompleted',
      label: 'Status',
      sortable: true,
      width: 90,
      render: (_: unknown, row: AnyRow) => {
        const done = asTask(row).cgmp_iscompleted;
        return done
          ? <span className="badge badge--status status-completed">Resolved</span>
          : <span className="badge badge--status status-inprogress">Open</span>;
      },
    },
  ], [changeMap]);

  /* ── Row actions ── */
  const actions = useCallback((row: AnyRow) => {
    const t = asTask(row);
    return (
      <div className="row-actions">
        {!t.cgmp_iscompleted && (
          <button
            className="row-action-btn"
            title="Mark Resolved"
            onClick={() => setResolveTarget(t)}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
            </svg>
          </button>
        )}
        {isAdmin && (
          <button
            className="row-action-btn row-action-btn--danger"
            title="Delete task"
            onClick={() => setDeleteTarget(t)}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
            </svg>
          </button>
        )}
      </div>
    );
  }, [isAdmin]);

  /* ── Footers ── */
  const createFooter = (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
      <button
        className="btn btn--outline"
        onClick={() => { setCreateOpen(false); setForm(EMPTY_FORM); }}
        disabled={saving}
      >
        Cancel
      </button>
      <button className="btn btn--primary" onClick={handleCreate} disabled={saving}>
        {saving ? 'Creating…' : 'Create Task'}
      </button>
    </div>
  );

  /* ── Detail panel linked change ── */
  const detailChange = detailTask?.cgmp_relatedchangeid
    ? changeMap.get(detailTask.cgmp_relatedchangeid)
    : undefined;

  return (
    <div className="module-workspace">
      {/* Header */}
      <div className="module-header">
        <div>
          <h1 className="module-title">Task Manager</h1>
          <p className="module-subtitle">Track and manage action items across all changes</p>
        </div>
        <button className="btn btn--primary btn--sm" onClick={() => setCreateOpen(true)}>+ New Task</button>
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        <input
          className="filter-bar__search"
          placeholder="Search tasks…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="filter-bar__select"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as 'all' | 'open' | 'resolved')}
        >
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
        </select>
        <select
          className="filter-bar__select"
          value={priorityFilter}
          onChange={e => setPriorityFilter(e.target.value)}
        >
          <option value="">All Priorities</option>
          {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          className="filter-bar__select"
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
        >
          <option value="">All Types</option>
          {TASK_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="filter-bar__count">{filtered.length} task{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Data table */}
      <div className="module-table-wrap">
        <DataTable
          columns={columns}
          rows={filteredRows}
          loading={loading}
          idKey="cgmp_taskid"
          emptyMessage="No tasks found"
          actions={actions}
          ariaLabel="Tasks table"
        />
      </div>

      {/* ── Create task panel ── */}
      <SlidePanel
        open={createOpen}
        onClose={() => { setCreateOpen(false); setForm(EMPTY_FORM); }}
        title="New Task"
        width={520}
        footer={createFooter}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 4 }}>
          <div className="ff-group">
            <label className="ff-label">Task Name <span className="ff-required">*</span></label>
            <input
              className="ff-input"
              value={form.title}
              onChange={setFormFieldEvent('title')}
              placeholder="Enter task name"
              autoFocus
            />
          </div>

          <div className="ff-row">
            <div className="ff-group">
              <label className="ff-label">Type</label>
              <select className="ff-input ff-select" value={form.type} onChange={setFormFieldEvent('type')}>
                {TASK_TYPE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="ff-group">
              <label className="ff-label">Priority</label>
              <select className="ff-input ff-select" value={form.priority} onChange={setFormFieldEvent('priority')}>
                {PRIORITY_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="ff-group">
            <label className="ff-label">Due Date</label>
            <input
              type="datetime-local"
              className="ff-input"
              value={form.dueDate}
              onChange={setFormFieldEvent('dueDate')}
            />
          </div>

          <div className="ff-group">
            <label className="ff-label">Linked Change</label>
            <FilteredSelect
              options={changeOptions}
              value={form.relatedChangeId}
              onChange={setFormField('relatedChangeId')}
              placeholder="Select a change…"
            />
          </div>

          <div className="ff-group">
            <label className="ff-label">Assigned To</label>
            <FilteredSelect
              options={userOptions}
              value={form.assignedTo}
              onChange={setFormField('assignedTo')}
              placeholder="Select a user…"
            />
          </div>
        </div>
      </SlidePanel>

      {/* ── Task detail panel ── */}
      <SlidePanel
        open={!!detailTask}
        onClose={() => setDetailTask(null)}
        title={detailTask?.cgmp_title ?? 'Task Details'}
        subtitle={
          detailTask
            ? TASK_TYPE_LABEL_MAP[detailTask.cgmp_type as unknown as number] ?? ''
            : ''
        }
        width={480}
      >
        {detailTask && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Status */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 4 }}>Status</div>
                {detailTask.cgmp_iscompleted
                  ? <span className="badge badge--status status-completed">Resolved</span>
                  : <span className="badge badge--status status-inprogress">Open</span>}
              </div>

              {/* Priority */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 4 }}>Priority</div>
                <span className={`badge badge--status ${PRIORITY_BADGE[detailTask.cgmp_priority as unknown as number] ?? ''}`}>
                  {PRIORITY_LABEL_MAP[detailTask.cgmp_priority as unknown as number] ?? '—'}
                </span>
              </div>

              {/* Due Date */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 4 }}>Due Date</div>
                <div style={{ fontSize: 13 }}>{fmtDate(detailTask.cgmp_duedate)}</div>
              </div>

              {/* Assigned To */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 4 }}>Assigned To</div>
                <div style={{ fontSize: 13 }}>{detailTask.cgmp_assignedto || '—'}</div>
              </div>

              {/* Linked Change */}
              {detailChange && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 4 }}>Linked Change</div>
                  <div style={{ fontSize: 13 }}>{detailChange.cgmp_changenumber}</div>
                </div>
              )}

              {/* Created On */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 4 }}>Created On</div>
                <div style={{ fontSize: 13 }}>{fmtDateTime(detailTask.createdon)}</div>
              </div>

              {/* Resolved On */}
              {detailTask.cgmp_iscompleted && detailTask.cgmp_completedat && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 4 }}>Resolved On</div>
                  <div style={{ fontSize: 13 }}>{fmtDateTime(detailTask.cgmp_completedat)}</div>
                </div>
              )}
            </div>

            {/* Resolve action */}
            {!detailTask.cgmp_iscompleted && (
              <div style={{ paddingTop: 4 }}>
                <button
                  className="btn btn--primary btn--sm"
                  onClick={() => { setResolveTarget(detailTask); setDetailTask(null); }}
                >
                  Mark Resolved
                </button>
              </div>
            )}
          </div>
        )}
      </SlidePanel>

      {/* ── Mark resolved confirmation ── */}
      <ConfirmDialog
        open={!!resolveTarget}
        onClose={() => setResolveTarget(null)}
        onConfirm={handleMarkResolved}
        title="Mark Task Resolved"
        message={`Mark "${resolveTarget?.cgmp_title}" as resolved? This action sets the completion date to now.`}
        confirmLabel="Mark Resolved"
        loading={resolving}
      />

      {/* ── Delete confirmation ── */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Task"
        message={`Delete "${deleteTarget?.cgmp_title}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleting}
      />
    </div>
  );
}
