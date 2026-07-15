import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import DataTable from '../ui/DataTable';
import type { Column } from '../ui/DataTable';
import { SearchInput, Select } from '../ui/FormFields';
import { statusLabel, statusColor, riskLabel, riskColor, riskIcon, STATUS, daysUntilIsmFreeze, isIsmFrozen, useSystemUsers } from '../../hooks/useDataverse';
import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';
import { STATUS_OPTIONS, CATEGORY_OPTIONS, RISK_OPTIONS } from './options';
import { categoryLabel, changeTypeLabel } from './ChangeForm';
import type { FormMode } from './ChangeForm';
import ConfirmDialog from '../ui/ConfirmDialog';
import { SlidePanel } from '../ui/Modal';
import { Cgmp_changesService } from '../../generated';
import { useApp } from '../../context/AppContext';
import { exportCSV } from '../../utils/csv';
import { fmtDateTime as fmtDate } from '../../utils/format';
import { UserPickerSelect } from '../ui/UserPickerSelect';

type AnyRow = { [key: string]: unknown };

const DATE_RANGE_OPTIONS = [
  { value: 'all', label: 'All Time' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'quarter', label: 'This Quarter' },
  { value: 'custom', label: 'Custom Range…' },
];

const STATUS_FILTER_OPTIONS = [{ value: '', label: 'All Statuses' }, ...STATUS_OPTIONS];
const RISK_FILTER_OPTIONS = [{ value: '', label: 'All Risks' }, ...RISK_OPTIONS];
const CATEGORY_FILTER_OPTIONS = [{ value: '', label: 'All Categories' }, ...CATEGORY_OPTIONS];

interface Filters {
  search: string;
  status: string;
  risk: string;
  category: string;
  dateRange: string;
  customFrom: string;
  customTo: string;
}

interface Props {
  changes: Cgmp_changes[];
  loading: boolean;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onOpenForm: (mode: FormMode, change?: Cgmp_changes) => void;
  onPublish?: (change: Cgmp_changes) => void;
  onClone?: (change: Cgmp_changes) => void;
  onRefresh?: () => void;
}

const LS_KEY = 'pmo-changelist-filters';
const LS_COL_KEY = 'pmo-changelist-columns';

const ALL_COL_DEFS: { key: string; label: string }[] = [
  { key: 'cgmp_changenumber', label: 'Change #' },
  { key: 'cgmp_title', label: 'Title' },
  { key: 'cgmp_status', label: 'Status' },
  { key: 'cgmp_risklevel', label: 'Risk' },
  { key: 'cgmp_category', label: 'Category' },
  { key: 'cgmp_changetype', label: 'Type' },
  { key: 'cgmp_starttime', label: 'Start' },
  { key: 'cgmp_endtime', label: 'End' },
  { key: 'cgmp_createdby', label: 'Owner' },
  { key: '_sla_days', label: 'Days to Start' },
];

function StatusBadge({ code }: { code: number }) {
  return <span className={`badge badge--status ${statusColor(code)}`}>{statusLabel(code)}</span>;
}

function RiskBadge({ code }: { code: number }) {
  return <span className={`badge badge--risk ${riskColor(code)}`}>{riskIcon(code)} {riskLabel(code)}</span>;
}


export default function ChangeList({ changes, loading, selectedIds, onSelectionChange, onOpenForm, onPublish, onClone, onRefresh }: Props) {
  const { showToast, currentUserName, currentUserUpn } = useApp();
  const { users: systemUsers, loading: usersLoading } = useSystemUsers();
  const [filters, setFilters] = useState<Filters>(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) return { ...{ search: '', status: '', risk: '', category: '', dateRange: 'all', customFrom: '', customTo: '' }, ...JSON.parse(saved) };
    } catch {}
    return { search: '', status: '', risk: '', category: '', dateRange: 'all', customFrom: '', customTo: '' };
  });
  const [showArchived, setShowArchived] = useState(() => {
    try { return localStorage.getItem('pmo-changelist-archived') === '1'; } catch { return false; }
  });
  const [deleteTarget, setDeleteTarget] = useState<Cgmp_changes | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditRisk, setBulkEditRisk] = useState('');
  const [bulkEditCategory, setBulkEditCategory] = useState('');
  const [bulkEditOwner, setBulkEditOwner] = useState('');
  const [bulkDateShiftAmount, setBulkDateShiftAmount] = useState('');
  const [bulkDateShiftUnit, setBulkDateShiftUnit] = useState<'hours' | 'days'>('hours');
  const [bulkDateShiftDir, setBulkDateShiftDir] = useState<'+' | '-'>('+');
  const [bulkEditing, setBulkEditing] = useState(false);
  const [colVisOpen, setColVisOpen] = useState(false);
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(LS_COL_KEY);
      if (saved) return new Set(JSON.parse(saved));
    } catch {}
    return new Set<string>();
  });
  const toggleCol = useCallback((key: string) => {
    setHiddenCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem(LS_COL_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);
  const colVisRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!colVisOpen) return;
    const handler = (e: MouseEvent) => { if (colVisRef.current && !colVisRef.current.contains(e.target as Node)) setColVisOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [colVisOpen]);

  const pendingProposalIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of changes) {
      let hist: any[] = [];
      try { hist = JSON.parse((c as any).cgmp_versionhistory || '[]'); } catch { continue; }
      const resolved = new Set(hist.filter((e: any) => e._type === 'rescheduleAccepted' || e._type === 'rescheduleDeclined').map((e: any) => e.proposedTs));
      if (hist.some((e: any) => e._type === 'rescheduleProposed' && !resolved.has(e.timestamp))) {
        ids.add(c.cgmp_changeid);
      }
    }
    return ids;
  }, [changes]);

  // Debounce the search filter so filtering only runs 300ms after the user stops typing
  const debouncedSearch = useRef(filters.search);
  const [debouncedFilters, setDebouncedFilters] = useState(filters);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedFilters(f => ({ ...f, search: filters.search })), 300);
    return () => clearTimeout(id);
  }, [filters.search]);
  // Non-search filters apply immediately
  useEffect(() => {
    setDebouncedFilters(f => ({ ...f, status: filters.status, risk: filters.risk, category: filters.category, dateRange: filters.dateRange, customFrom: filters.customFrom, customTo: filters.customTo }));
  }, [filters.status, filters.risk, filters.category, filters.dateRange, filters.customFrom, filters.customTo]);
  void debouncedSearch; // suppress unused warning

  // Persist filters to localStorage whenever they change
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(filters)); } catch {}
  }, [filters]);
  useEffect(() => {
    try { localStorage.setItem('pmo-changelist-archived', showArchived ? '1' : '0'); } catch {}
  }, [showArchived]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // Soft-delete: mark as Cancelled with deletion marker in version history
      const deletionEntry = { timestamp: new Date().toISOString(), _type: 'deleted', deletedBy: currentUserName, deletedByUpn: currentUserUpn };
      // Re-fetch latest history to avoid overwriting concurrent changes
      const latestChange = await Cgmp_changesService.get(deleteTarget.cgmp_changeid, { select: ['cgmp_versionhistory'] as any });
      let existingHistory: unknown[] = [];
      try { existingHistory = JSON.parse((latestChange.data?.cgmp_versionhistory ?? deleteTarget.cgmp_versionhistory) ?? '[]'); } catch {}
      const newHistory = [...existingHistory, deletionEntry];
      await Cgmp_changesService.update(deleteTarget.cgmp_changeid, {
        cgmp_status: 100000010 as any, // Cancelled = soft-deleted
        cgmp_versionhistory: JSON.stringify(newHistory),
      });
      showToast('success', `Change ${deleteTarget.cgmp_changenumber} moved to archive`);
      setDeleteTarget(null);
      onRefresh?.();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to delete change');
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, showToast, onRefresh, currentUserName, currentUserUpn]);

  const handleBulkEdit = useCallback(async () => {
    const targets = changes.filter(c => selectedIds.has(c.cgmp_changeid));
    if (targets.length === 0) return;
    setBulkEditing(true);
    try {
      const shiftMs = bulkDateShiftAmount
        ? (parseInt(bulkDateShiftAmount) || 0) * (bulkDateShiftUnit === 'days' ? 86400000 : 3600000) * (bulkDateShiftDir === '-' ? -1 : 1)
        : 0;
      await Promise.all(targets.map(c => {
        const patch: Record<string, unknown> = {};
        if (bulkEditRisk) patch.cgmp_risklevel = parseInt(bulkEditRisk);
        if (bulkEditCategory) patch.cgmp_category = parseInt(bulkEditCategory);
        if (bulkEditOwner) patch.cgmp_createdby = bulkEditOwner;
        if (shiftMs && c.cgmp_starttime) patch.cgmp_starttime = new Date(new Date(c.cgmp_starttime).getTime() + shiftMs).toISOString();
        if (shiftMs && c.cgmp_endtime) patch.cgmp_endtime = new Date(new Date(c.cgmp_endtime).getTime() + shiftMs).toISOString();
        if (Object.keys(patch).length === 0) return Promise.resolve();
        return Cgmp_changesService.update(c.cgmp_changeid, patch as any);
      }));
      showToast('success', `Updated ${targets.length} change${targets.length > 1 ? 's' : ''}`);
      setBulkEditOpen(false);
      setBulkEditRisk(''); setBulkEditCategory(''); setBulkEditOwner('');
      setBulkDateShiftAmount('');
      onRefresh?.();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Bulk edit failed');
    } finally { setBulkEditing(false); }
  }, [changes, selectedIds, bulkEditRisk, bulkEditCategory, bulkEditOwner, bulkDateShiftAmount, bulkDateShiftUnit, bulkDateShiftDir, showToast, onRefresh]);

  const setFilter = useCallback(<K extends keyof Filters>(key: K, val: Filters[K]) => {
    setFilters(prev => ({ ...prev, [key]: val }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({ search: '', status: '', risk: '', category: '', dateRange: 'all', customFrom: '', customTo: '' });
  }, []);

  const hasActiveFilter = filters.search || filters.status || filters.risk || filters.category || filters.dateRange !== 'all' || filters.customFrom || filters.customTo;

  const filtered = useMemo(() => {
    const now = Date.now();
    const rangeMs: Record<string, number> = {
      week: 7 * 86400000, month: 30 * 86400000, quarter: 90 * 86400000,
    };
    const cutoff = debouncedFilters.dateRange !== 'all' && debouncedFilters.dateRange !== 'custom'
      ? now - rangeMs[debouncedFilters.dateRange]
      : 0;
    const customFrom = debouncedFilters.dateRange === 'custom' && debouncedFilters.customFrom
      ? new Date(debouncedFilters.customFrom).getTime()
      : 0;
    const customTo = debouncedFilters.dateRange === 'custom' && debouncedFilters.customTo
      ? new Date(debouncedFilters.customTo).getTime() + 86399999
      : 0;

    const oneWeekAgo = Date.now() - 7 * 86400000;

    return changes.filter(c => {
      const sc = c.cgmp_status as unknown as number;
      /* Auto-archive: hide Closed changes older than 1 week unless user opted in */
      if (!showArchived && sc === STATUS.Closed) {
        const closedAt = (c as any).cgmp_actualendtime ? new Date((c as any).cgmp_actualendtime).getTime() : 0;
        if (closedAt && closedAt < oneWeekAgo) return false;
      }
      if (debouncedFilters.status && String(sc) !== debouncedFilters.status) return false;
      if (debouncedFilters.risk && String(c.cgmp_risklevel as unknown as number) !== debouncedFilters.risk) return false;
      if (debouncedFilters.category && String(c.cgmp_category as unknown as number) !== debouncedFilters.category) return false;
      const createdMs = new Date(c.createdon ?? 0).getTime();
      if (cutoff && createdMs < cutoff) return false;
      if (customFrom && createdMs < customFrom) return false;
      if (customTo && createdMs > customTo) return false;
      if (debouncedFilters.search) {
        const q = debouncedFilters.search.toLowerCase();
        if (!c.cgmp_changenumber?.toLowerCase().includes(q) && !c.cgmp_title?.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [changes, debouncedFilters, showArchived]);

  /* DataTable requires generic rows — cast filtered to AnyRow for column render callbacks */
  const asRow = (row: AnyRow) => row as unknown as Cgmp_changes;

  const columns = useMemo((): Column<AnyRow>[] => [
    {
      key: 'cgmp_changenumber', label: 'Change #', width: 130, sortable: true,
      render: (_: unknown, row: AnyRow) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span className="change-number">{asRow(row).cgmp_changenumber}</span>
          <button
            className="btn-icon"
            title={`Copy ${asRow(row).cgmp_changenumber} to clipboard`}
            aria-label={`Copy change number ${asRow(row).cgmp_changenumber}`}
            style={{ padding: '2px 4px', fontSize: 11, opacity: 0.6 }}
            onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(asRow(row).cgmp_changenumber ?? '').catch(() => {}); }}
          >📋</button>
        </span>
      ),
    },
    {
      key: 'cgmp_title', label: 'Title', sortable: true,
      render: (_: unknown, row: AnyRow) =>(
        <span className="change-title" title={asRow(row).cgmp_title}>{asRow(row).cgmp_title}</span>
      ),
    },
    {
      key: 'cgmp_status', label: 'Status', width: 150, sortable: true,
      render: (_: unknown, row: AnyRow) => {
        const c = asRow(row);
        const isReturnedDraft = (c.cgmp_status as unknown as number) === STATUS.Draft && c.cgmp_reviewnotes?.startsWith('[Returned by IT Ops');
        const hasPendingProposal = pendingProposalIds.has(c.cgmp_changeid);
        const slaAtRisk = (() => {
          if (!c.cgmp_starttime) return false;
          const hoursUntilStart = (new Date(c.cgmp_starttime).getTime() - Date.now()) / 3_600_000;
          return hoursUntilStart > 0 && hoursUntilStart < 24;
        })();
        return (
          <span style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusBadge code={c.cgmp_status as unknown as number} />
            {isReturnedDraft && (
              <span className="badge" style={{ background: 'rgba(220,53,69,0.12)', color: '#D13438', fontSize: 10 }} title={c.cgmp_reviewnotes}>
                Returned
              </span>
            )}
            {hasPendingProposal && (
              <span className="badge" style={{ background: 'rgba(255,140,0,0.12)', color: '#FF8C00', fontSize: 10 }} title="IT Ops has proposed a new time window — open to review">
                ⏱ Proposal
              </span>
            )}
            {slaAtRisk && (
              <span
                className="badge badge--warning"
                title="This change starts within 24 hours"
                style={{ fontSize: 10, padding: '1px 5px' }}
              >
                ⚠ SLA at risk
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'cgmp_risklevel', label: 'Risk', width: 80, sortable: true,
      render: (_: unknown, row: AnyRow) =><RiskBadge code={asRow(row).cgmp_risklevel as unknown as number} />,
    },
    {
      key: 'cgmp_category', label: 'Category', width: 110, sortable: true,
      render: (_: unknown, row: AnyRow) =>categoryLabel(asRow(row).cgmp_category as unknown as number),
    },
    {
      key: 'cgmp_changetype', label: 'Type', width: 90, sortable: true,
      render: (_: unknown, row: AnyRow) =>changeTypeLabel(asRow(row).cgmp_changetype as unknown as number),
    },
    {
      key: 'cgmp_starttime', label: 'Start', width: 140, sortable: true,
      render: (_: unknown, row: AnyRow) =><span className="change-date">{fmtDate(asRow(row).cgmp_starttime)}</span>,
    },
    {
      key: 'cgmp_endtime', label: 'End', width: 140, sortable: true,
      render: (_: unknown, row: AnyRow) =><span className="change-date">{fmtDate(asRow(row).cgmp_endtime)}</span>,
    },
    {
      key: 'cgmp_createdby', label: 'Owner', width: 140, sortable: true,
      render: (_: unknown, row: AnyRow) =>{
        const c = asRow(row);
        const name = (c.cgmp_createdby as string | undefined) || c.owneridname || '—';
        return <span className="change-owner">{name}</span>;
      },
    },
    {
      key: '_sla_days', label: 'Days to Start', width: 110, sortable: false,
      render: (_: unknown, row: AnyRow) =>{
        const c = asRow(row);
        if (!c.cgmp_starttime) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
        if (isIsmFrozen(c.cgmp_starttime)) return <span className="sla-chip sla-chip--red">Started</span>;
        const days = daysUntilIsmFreeze(c.cgmp_starttime);
        if (days <= 2) return <span className="sla-chip sla-chip--red">{days}d</span>;
        if (days <= 7) return <span className="sla-chip sla-chip--amber">{days}d</span>;
        return <span className="sla-chip sla-chip--green">{days}d</span>;
      },
    },
  ].filter(col => !hiddenCols.has(col.key)), [hiddenCols, showToast]);

  const actions = useCallback((row: AnyRow): ReactNode => {
    const change = asRow(row);
    const statusCode = change.cgmp_status as unknown as number;
    const canPublish = statusCode === STATUS.Draft;
    /* Locked to read-only once handed over to GIICC (InProgress and beyond) */
    const isLocked = statusCode >= STATUS.InProgress;
    return (
      <div className="row-actions">
        <button className="row-action-btn" onClick={() => onOpenForm('view', change)} title="View">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
          </svg>
        </button>
        {isLocked ? (
          <button className="row-action-btn row-action-btn--locked" title="Locked — handed over to GIICC for execution" style={{ cursor: 'not-allowed', opacity: 0.4 }} disabled>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z" />
            </svg>
          </button>
        ) : (
          <button className="row-action-btn" onClick={() => onOpenForm('edit', change)} title="Edit">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
            </svg>
          </button>
        )}
        {onClone && (
          <button className="row-action-btn" onClick={e => { e.stopPropagation(); onClone(change); }} title="Clone — create a copy as Draft">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
            </svg>
          </button>
        )}
        {canPublish && onPublish && (
          <button className="row-action-btn row-action-btn--publish" onClick={() => onPublish(change)} title="Publish">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M5 4v2h14V4H5zm0 10h4v6h6v-6h4l-7-7-7 7z" />
            </svg>
          </button>
        )}
        {!isLocked && (
          <button
            className="row-action-btn row-action-btn--danger"
            onClick={() => setDeleteTarget(change)}
            title="Delete"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
            </svg>
          </button>
        )}
      </div>
    );
  }, [onOpenForm, onPublish, onClone]);

  const filteredAsAnyRows = filtered as unknown as AnyRow[];

  return (
    <div className="change-list">
      {/* Filter bar */}
      <div className="filter-bar">
        <SearchInput
          value={filters.search}
          onChange={e => setFilter('search', e.target.value)}
          placeholder="Search by title or change number…"
          style={{ width: 240 }}
        />
        <Select
          value={filters.status}
          onChange={e => setFilter('status', e.target.value)}
          options={STATUS_FILTER_OPTIONS}
          style={{ width: 140 }}
        />
        <Select
          value={filters.risk}
          onChange={e => setFilter('risk', e.target.value)}
          options={RISK_FILTER_OPTIONS}
          style={{ width: 120 }}
        />
        <Select
          value={filters.category}
          onChange={e => setFilter('category', e.target.value)}
          options={CATEGORY_FILTER_OPTIONS}
          style={{ width: 140 }}
        />
        <Select
          value={filters.dateRange}
          onChange={e => setFilter('dateRange', e.target.value)}
          options={DATE_RANGE_OPTIONS}
          style={{ width: 140 }}
        />
        {filters.dateRange === 'custom' && (
          <>
            <input
              type="date"
              className="ff-input"
              style={{ width: 130, fontSize: 12 }}
              value={filters.customFrom}
              onChange={e => setFilter('customFrom', e.target.value)}
              title="From date"
            />
            <span style={{ color: 'var(--text-tertiary)', fontSize: 12, alignSelf: 'center' }}>–</span>
            <input
              type="date"
              className="ff-input"
              style={{ width: 130, fontSize: 12 }}
              value={filters.customTo}
              onChange={e => setFilter('customTo', e.target.value)}
              title="To date"
            />
          </>
        )}
        {hasActiveFilter && (
          <button className="btn btn--outline btn--sm" onClick={clearFilters}>
            Clear
          </button>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: 'var(--text-secondary)', whiteSpace: 'nowrap', marginLeft: 4 }}>
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        {selectedIds.size > 0 && (
          <button className="btn btn--outline btn--sm" onClick={() => setBulkEditOpen(true)}>
            Edit {selectedIds.size} Selected
          </button>
        )}
        <button
          className="btn btn--outline btn--sm"
          title="Export current filtered list as CSV"
          onClick={() => exportCSV(
            `changes-${new Date().toISOString().slice(0, 10)}.csv`,
            ['Change #', 'Title', 'Status', 'Risk', 'Category', 'Start', 'End', 'Owner'],
            filtered.map(c => [
              c.cgmp_changenumber ?? '',
              c.cgmp_title ?? '',
              statusLabel(c.cgmp_status as unknown as number),
              riskLabel(c.cgmp_risklevel as unknown as number),
              categoryLabel(c.cgmp_category as unknown as number),
              fmtDate(c.cgmp_starttime),
              fmtDate(c.cgmp_endtime),
              (c.cgmp_createdby as string | undefined) || c.owneridname || '',
            ])
          )}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 4 }}>
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
          </svg>
          Export
        </button>
        {/* Column Visibility Toggle (#17) */}
        <div style={{ position: 'relative' }} ref={colVisRef}>
          <button className="btn btn--outline btn--sm" onClick={() => setColVisOpen(o => !o)} title="Show/hide columns">
            Columns
          </button>
          {colVisOpen && (
            <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 200, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px', minWidth: 160, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', marginTop: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>VISIBLE COLUMNS</div>
              {ALL_COL_DEFS.map(def => (
                <label key={def.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!hiddenCols.has(def.key)} onChange={() => toggleCol(def.key)} />
                  {def.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <span className="filter-count">{filtered.length} of {changes.length}</span>
      </div>

      <DataTable
        columns={columns}
        rows={filteredAsAnyRows}
        loading={loading}
        selectable
        selectedIds={selectedIds}
        idKey="cgmp_changeid"
        onSelectionChange={onSelectionChange}
        onRowClick={(row) => onOpenForm('view', asRow(row as AnyRow))}
        pageSize={25}
        emptyMessage={hasActiveFilter ? 'No changes match the current filters.' : 'No changes found.'}
        actions={actions}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Change"
        message={`Are you sure you want to delete this change? This will move the change to the Archive Center. It can be restored from there.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleting}
      />

      <SlidePanel open={bulkEditOpen} onClose={() => setBulkEditOpen(false)} title={`Bulk Edit — ${selectedIds.size} Changes`} width={360}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn--outline" onClick={() => setBulkEditOpen(false)}>Cancel</button>
            <button className="btn btn--primary" onClick={handleBulkEdit} disabled={bulkEditing}>
              {bulkEditing ? 'Applying…' : 'Apply Changes'}
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
            Only fields you change will be updated. Leave a field blank to keep existing values. Status transitions are managed through the workflow (Publish → IT Ops Review → Release).
          </p>
          <div className="ff-group">
            <label className="ff-label">Risk Level</label>
            <select className="ff-input ff-select" value={bulkEditRisk} onChange={e => setBulkEditRisk(e.target.value)}>
              <option value="">— No change —</option>
              {RISK_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="ff-group">
            <label className="ff-label">Category</label>
            <select className="ff-input ff-select" value={bulkEditCategory} onChange={e => setBulkEditCategory(e.target.value)}>
              <option value="">— No change —</option>
              {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="ff-group">
            <label className="ff-label">Reassign Owner</label>
            <UserPickerSelect
              users={systemUsers}
              loading={usersLoading}
              value={bulkEditOwner}
              onChange={setBulkEditOwner}
            />
          </div>

          {/* Bulk Date Shift (#14) */}
          <div className="ff-group">
            <label className="ff-label">Shift Dates</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                className="ff-input ff-select"
                value={bulkDateShiftDir}
                onChange={e => setBulkDateShiftDir(e.target.value as '+' | '-')}
                style={{ width: 60 }}
              >
                <option value="+">+ Forward</option>
                <option value="-">- Backward</option>
              </select>
              <input
                type="number"
                className="ff-input"
                placeholder="Amount"
                min={1}
                value={bulkDateShiftAmount}
                onChange={e => setBulkDateShiftAmount(e.target.value)}
                style={{ width: 80 }}
              />
              <select
                className="ff-input ff-select"
                value={bulkDateShiftUnit}
                onChange={e => setBulkDateShiftUnit(e.target.value as 'hours' | 'days')}
                style={{ width: 80 }}
              >
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </div>
            {bulkDateShiftAmount && (
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                Will shift Start and End by {bulkDateShiftDir === '-' ? '−' : '+'}{bulkDateShiftAmount} {bulkDateShiftUnit}
              </p>
            )}
          </div>
        </div>
      </SlidePanel>
    </div>
  );
}
