import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import DataTable from '../ui/DataTable';
import type { Column } from '../ui/DataTable';
import { SearchInput, Select, Textarea, DateTimeInput } from '../ui/FormFields';
import { SlidePanel, Dialog } from '../ui/Modal';
import ConfirmDialog from '../ui/ConfirmDialog';
import ReviewPanel from './ReviewPanel';
import ImpactAnalysis from './ImpactAnalysis';
import { getBrowserInfo, fmtDateTime as fmtDate, fmtShortDate, isToday, getDisplayTimezone } from '../../utils/format';
import { useApp } from '../../context/AppContext';
import { Cgmp_changesService, Cgmp_auditlogsService, Cgmp_notificationsService, Cgmp_changehistoryService } from '../../generated';
import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';
import type { Cgmp_changescgmp_status, Cgmp_changescgmp_risklevel, Cgmp_changescgmp_impactlevel } from '../../generated/models/Cgmp_changesModel';
import type { Cgmp_auditlogsBase } from '../../generated/models/Cgmp_auditlogsModel';
import type { Cgmp_auditlogscgmp_entitytype, Cgmp_auditlogscgmp_eventtype } from '../../generated/models/Cgmp_auditlogsModel';
import type { Cgmp_notificationsBase } from '../../generated/models/Cgmp_notificationsModel';
import { asNotifCategory, asNotifPriority } from '../../utils/optionSets';
import { useChangeList, useProjects, useSystemUsers, useAllUserProfiles, useAllBridges, useDebounce, BRIDGE_STATUS, STATUS, statusLabel, statusColor, riskLabel, riskColor, riskIcon, bridgeStatusLabel, itopsFreezeDate, ismFreezeDate, appendHistory } from '../../hooks/useDataverse';
import { UserPickerSelect } from '../ui/UserPickerSelect';
import { ProjectMultiSelect } from '../ui/ProjectMultiSelect';
import type { ReactNode } from 'react';
import { RISK_OPTIONS, CATEGORY_OPTIONS } from '../pmo/options';
import { categoryLabel } from '../pmo/ChangeForm';
import { validateForReview, hasBlockingErrors } from './validation';
import { parseChangeUATData, defaultUATEntry, ITOPS_REM_STATUSES, remStatusLabel, remStatusColor, RemediationHistory } from '../giicc/GIICCCommandCenter';
import type { UATStatus, FailedProjectStatus, RemediationHistoryEntry } from '../giicc/GIICCCommandCenter';
import { loadAnnotations, downloadAnnotation } from '../ui/AttachmentPanel';

type AnyRow = { [key: string]: unknown };
type Tab = 'pending' | 'review' | 'released' | 'all' | 'uatcollection' | 'handover' | 'closure' | 'sla' | 'bridges';

const ITOPS_CHIP_KEYS: string[] = ['pending', 'review', 'released', 'overdue', 'uatcollection', 'handover', 'closure', 'all', 'sla', 'bridges'];

const RISK_FILTER = [{ value: '', label: 'All Risks' }, ...RISK_OPTIONS];
const CATEGORY_FILTER = [{ value: '', label: 'All Categories' }, ...CATEGORY_OPTIONS];

const LS_ITOPS_COL_KEY = 'cgmp-itops-cols';
const ITOPS_ALL_COL_DEFS: { key: string; label: string }[] = [
  { key: 'cgmp_changenumber', label: 'Change #' },
  { key: 'cgmp_title', label: 'Title' },
  { key: 'cgmp_status', label: 'Status' },
  { key: 'cgmp_risklevel', label: 'Risk' },
  { key: 'cgmp_category', label: 'Category' },
  { key: 'cgmp_starttime', label: 'Start' },
  { key: 'cgmp_createdby', label: 'Owner' },
  { key: '_queue_days', label: 'In Queue' },
  { key: '_impact_score', label: 'Score' },
  { key: '_concerns', label: 'Concerns' },
  { key: '_rereview', label: 'Re-review' },
  { key: '_valid', label: 'Valid' },
];

function StatusBadge({ code }: { code: number }) {
  return <span className={`badge badge--status ${statusColor(code)}`}>{statusLabel(code)}</span>;
}
function RiskBadge({ code }: { code: number }) {
  return <span className={`badge badge--risk ${riskColor(code)}`}>{riskIcon(code)} {riskLabel(code)}</span>;
}

interface StatChipProps { label: string; value: number; active?: boolean; onClick: () => void; accent?: string; id?: string; onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void; }
function StatChip({ label, value, active, onClick, accent, id, onKeyDown }: StatChipProps) {
  return (
    <button
      role="tab"
      aria-selected={active ?? false}
      id={id}
      tabIndex={active ? 0 : -1}
      onKeyDown={onKeyDown}
      className={`itops-stat ${active ? 'itops-stat--active' : ''}`}
      onClick={onClick}
    >
      <span className="itops-stat__value" style={{ color: active ? 'var(--primary)' : (accent ?? 'var(--text-primary)') }}>{value}</span>
      <span className="itops-stat__label">{label}</span>
    </button>
  );
}

/* Quick validation indicator for list rows */
function ValidationDot({ change, allChanges }: { change: Cgmp_changes; allChanges: Cgmp_changes[] }) {
  const blocked = hasBlockingErrors(validateForReview(change, allChanges));
  return (
    <span className={`rv-dot ${blocked ? 'rv-dot--error' : 'rv-dot--ok'}`} title={blocked ? 'Validation errors' : 'Checks passed'} />
  );
}

const RISK_OPTS = [
  { value: '100000000', label: 'Low' },
  { value: '100000001', label: 'Medium' },
  { value: '100000002', label: 'High' },
  { value: '100000003', label: 'Critical' },
];
const IMPACT_OPTS = [
  { value: '100000000', label: 'Low' },
  { value: '100000001', label: 'Medium' },
  { value: '100000002', label: 'High' },
  { value: '100000003', label: 'Critical' },
];

/* Detect pending reschedule proposals that are older than 24 hours */
function findExpiredProposals(versionHistory: string | undefined): Array<{ timestamp: string }> {
  try {
    const arr: { _type: string; timestamp?: string; originalProposalAt?: string }[] = JSON.parse(versionHistory ?? '[]');
    const alreadyExpiredAt = new Set(
      arr.filter(e => e._type === 'reschedule_expired').map(e => e.originalProposalAt ?? '')
    );
    return arr.filter(e =>
      e._type === 'rescheduleProposed' &&
      e.timestamp !== undefined &&
      !alreadyExpiredAt.has(e.timestamp) &&
      Date.now() - new Date(e.timestamp).getTime() > 86_400_000
    ) as Array<{ timestamp: string }>;
  } catch { return []; }
}

/* Parse ISM concerns from version history */
function parseConcernsFromHistory(versionHistory: string | undefined): { concernType: string; remarks?: string; raisedBy?: string }[] {
  try {
    const arr: any[] = JSON.parse(versionHistory ?? '[]');
    return arr.filter(e => e._type === 'concern' && !e._deleted);
  } catch { return []; }
}

/* Composite impact score: RiskLevel (1-4) × ImpactLevel (1-4) × max(1, projectCount) */
function impactScore(change: Cgmp_changes, totalProjects: number): number {
  const riskIdx = (change.cgmp_risklevel as unknown as number) - 100000000 + 1;  // 1-4
  const impIdx = (change.cgmp_impactlevel as unknown as number) - 100000000 + 1; // 1-4
  return Math.max(1, riskIdx) * Math.max(1, impIdx) * Math.max(1, totalProjects);
}

/* Days a Published change has been waiting for review */
function daysInReviewQueue(change: Cgmp_changes): number {
  const ref = change.modifiedon ?? change.createdon;
  if (!ref) return 0;
  return Math.floor((Date.now() - new Date(ref).getTime()) / 86400000);
}

export default function ITOpsWorkspace() {
  const { showToast, currentUserName, currentUserUpn, userProfile, isAdmin } = useApp();
  const { changes, loading, error, refresh } = useChangeList();
  const { projects } = useProjects();
  const { profiles: allProfiles } = useAllUserProfiles();

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    try { return (localStorage.getItem('cgmp-tab-itops') as Tab | null) ?? 'pending'; } catch { return 'pending'; }
  });
  const handleActiveTabChange = useCallback((val: Tab) => {
    try { localStorage.setItem('cgmp-tab-itops', val); } catch {}
    setActiveTab(val);
  }, []);
  const handleChipKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>, chipKey: string) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const idx = ITOPS_CHIP_KEYS.indexOf(chipKey);
    const nextIdx = e.key === 'ArrowRight'
      ? (idx + 1) % ITOPS_CHIP_KEYS.length
      : (idx - 1 + ITOPS_CHIP_KEYS.length) % ITOPS_CHIP_KEYS.length;
    document.getElementById(`itops-tab-${ITOPS_CHIP_KEYS[nextIdx]}`)?.focus();
  }, []);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [riskFilter, setRiskFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /* Review panel */
  const [reviewChange, setReviewChange] = useState<Cgmp_changes | null>(null);
  /* Revert to PMO state */
  const [revertTarget, setRevertTarget] = useState<Cgmp_changes | null>(null);
  const [revertReason, setRevertReason] = useState('');
  const [reverting, setReverting] = useState(false);
  /* Reschedule Flow (#25) */
  const [reschedTarget, setReschedTarget] = useState<Cgmp_changes | null>(null);
  const [reschedStart, setReschedStart] = useState('');
  const [reschedEnd, setReschedEnd] = useState('');
  const [reschedReason, setReschedReason] = useState('');
  const [reschedWorking, setReschedWorking] = useState(false);
  /* Impact analysis */
  const [impactOpen, setImpactOpen] = useState(false);
  /* Bulk approve confirm */
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkWorking, setBulkWorking] = useState(false);
  /* Bulk Re-assign POC (#28) */
  const [bulkReassignOpen, setBulkReassignOpen] = useState(false);
  const [bulkReassignTarget, setBulkReassignTarget] = useState('');
  const [bulkReassigning, setBulkReassigning] = useState(false);
  const { users: systemUsers, loading: usersLoading } = useSystemUsers();
  const { bridges: allBridges, loading: bridgesLoading } = useAllBridges(0);

  /* Column visibility (#71) */
  const [colVisOpen, setColVisOpen] = useState(false);
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(LS_ITOPS_COL_KEY);
      if (saved) return new Set(JSON.parse(saved));
    } catch {}
    return new Set<string>();
  });
  const toggleCol = useCallback((key: string) => {
    setHiddenCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem(LS_ITOPS_COL_KEY, JSON.stringify([...next]));
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

  /* Item 16 — Auto-expire reschedule proposals after 24 hours */
  const [expiredChangeIds, setExpiredChangeIds] = useState<Set<string>>(new Set());
  const expiredMarkingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const newExpired = new Set<string>();
    filtered.forEach(c => {
      const expired = findExpiredProposals((c as unknown as Record<string, unknown>).cgmp_versionhistory as string | undefined);
      if (expired.length > 0) {
        newExpired.add(c.cgmp_changeid);
        // Fire-and-forget: mark each expired proposal in version history (once per change)
        if (!expiredMarkingRef.current.has(c.cgmp_changeid)) {
          expiredMarkingRef.current.add(c.cgmp_changeid);
          expired.forEach(proposal => {
            Cgmp_changesService.update(c.cgmp_changeid, {
              cgmp_versionhistory: appendHistory(
                (c as unknown as Record<string, unknown>).cgmp_versionhistory as string | undefined,
                { _type: 'reschedule_expired', at: new Date().toISOString(), originalProposalAt: proposal.timestamp }
              ),
            } as any).catch(() => {});
          });
        }
      }
    });
    setExpiredChangeIds(newExpired);
  }, [filtered]);

  const doBulkReassign = useCallback(async () => {
    if (!bulkReassignTarget) return;
    const targets = changes.filter(c => selectedIds.has(c.cgmp_changeid));
    setBulkReassigning(true);
    try {
      await Promise.all(targets.map(c => Cgmp_changesService.update(c.cgmp_changeid, { cgmp_changepoc: bulkReassignTarget })));
      showToast('success', `Reassigned ${targets.length} change${targets.length !== 1 ? 's' : ''}`);
      setBulkReassignOpen(false);
      setBulkReassignTarget('');
      refresh();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Bulk reassign failed');
    } finally { setBulkReassigning(false); }
  }, [changes, selectedIds, bulkReassignTarget, showToast, refresh]);

  /* IT Ops Quick Edit panel */
  const [itopsEditOpen, setItopsEditOpen] = useState(false);
  const [itopsEditTarget, setItopsEditTarget] = useState<Cgmp_changes | null>(null);
  const [itopsEditForm, setItopsEditForm] = useState({ risklevel: '', impactlevel: '', description: '', projectids: '' });
  const [itopsEditSaving, setItopsEditSaving] = useState(false);

  /* KPI counts */
  const pending = useMemo(() => changes.filter(c => { const s = c.cgmp_status as unknown as number; return s === STATUS.Draft || s === STATUS.Published; }).length, [changes]);
  const underReview = useMemo(() => changes.filter(c => (c.cgmp_status as unknown as number) === STATUS.UnderReview).length, [changes]);
  const releasedToday = useMemo(() => changes.filter(c => (c.cgmp_status as unknown as number) === STATUS.Released && isToday(c.cgmp_releasedat)).length, [changes]);
  const overdue = useMemo(() => {
    const now = Date.now();
    return changes.filter(c => {
      const code = c.cgmp_status as unknown as number;
      const notStarted = code === STATUS.Draft || code === STATUS.Published || code === STATUS.UnderReview;
      return notStarted && c.cgmp_starttime && new Date(c.cgmp_starttime).getTime() < now;
    }).length;
  }, [changes]);
  const uatCollectionCount = useMemo(() => changes.filter(c => (c.cgmp_status as unknown as number) === STATUS.UATUpdates).length, [changes]);
  const handoverCount = useMemo(() => changes.filter(c => (c.cgmp_status as unknown as number) === STATUS.Locked).length, [changes]);
  const closureCount = useMemo(() => changes.filter(c => (c.cgmp_status as unknown as number) === STATUS.Completed).length, [changes]);

  /* SLA Dashboard data */
  const slaData = useMemo(() => {
    const queueChanges = changes
      .filter(c => {
        const s = c.cgmp_status as unknown as number;
        return s === STATUS.Published || s === STATUS.UnderReview;
      })
      .map(c => ({ change: c, days: daysInReviewQueue(c) }))
      .sort((a, b) => b.days - a.days);
    const avgQueueDays = queueChanges.length
      ? Math.round((queueChanges.reduce((s, r) => s + r.days, 0) / queueChanges.length) * 10) / 10
      : 0;
    const breachingCount = queueChanges.filter(r => r.days >= 2).length;
    const criticalCount = queueChanges.filter(r => r.days >= 5).length;
    const pocMap: Record<string, { name: string; count: number; criticalCount: number }> = {};
    for (const { change, days } of queueChanges) {
      const poc = (change.cgmp_changepoc as string) || (change.cgmp_createdby as string) || 'Unassigned';
      if (!pocMap[poc]) pocMap[poc] = { name: poc, count: 0, criticalCount: 0 };
      pocMap[poc].count++;
      if (days >= 5) pocMap[poc].criticalCount++;
    }
    const pocWorkload = Object.values(pocMap).sort((a, b) => b.count - a.count);
    return { queueChanges, avgQueueDays, breachingCount, criticalCount, pocWorkload };
  }, [changes]);

  /* Auto-archive: exclude Closed changes older than 2 weeks (they live in Archive Center only) */
  const twoWeeksAgo = useMemo(() => Date.now() - 14 * 86400000, []);
  const activeChanges = useMemo(() =>
    changes.filter(c => {
      if ((c.cgmp_status as unknown as number) !== STATUS.Closed) return true;
      const closedAt = c.cgmp_actualendtime ? new Date(c.cgmp_actualendtime).getTime() : 0;
      return !closedAt || closedAt >= twoWeeksAgo;
    }),
    [changes, twoWeeksAgo]
  );

  /* Location-based filtering for IT Ops POC role (100000002) */
  const visibleChanges = useMemo(() => {
    const role = (userProfile?.cgmp_role as unknown as number);
    if (role === 100000002) {
      const assignedLocs = ((userProfile as any)?.cgmp_assignedlocations ?? '')
        .split(',').map((l: string) => l.trim()).filter(Boolean);
      if (assignedLocs.length === 0) return activeChanges; // no assignment = see all (fallback)
      return activeChanges.filter(c => {
        const changeLocs = (c.cgmp_location ?? '').split(',').map((l: string) => l.trim()).filter(Boolean);
        return changeLocs.length === 0 || changeLocs.some((loc: string) => assignedLocs.includes(loc));
      });
    }
    return activeChanges;
  }, [activeChanges, userProfile]);

  /* Bridges visible to IT Ops — read-only view of bridges linked to changes in this user's purview */
  const itopsBridges = useMemo(() => {
    const changeIds = new Set(visibleChanges.map(c => c.cgmp_changeid));
    return allBridges.filter(b => b.cgmp_changeid && changeIds.has(b.cgmp_changeid));
  }, [allBridges, visibleChanges]);

  /* Tab filtering */
  const tabFiltered = useMemo(() => {
    return visibleChanges.filter(c => {
      const code = c.cgmp_status as unknown as number;
      if (activeTab === 'pending') return code === STATUS.Draft || code === STATUS.Published;
      if (activeTab === 'review') return code === STATUS.UnderReview;
      if (activeTab === 'released') return code === STATUS.Released && isToday(c.cgmp_releasedat);
      if (activeTab === 'uatcollection') return code === STATUS.UATUpdates;
      if (activeTab === 'handover') return code === STATUS.Locked;
      if (activeTab === 'closure') return code === STATUS.Completed;
      return true;
    });
  }, [visibleChanges, activeTab]);

  /* Search + risk + category filter */
  const filtered = useMemo(() => {
    return tabFiltered.filter(c => {
      if (riskFilter && String(c.cgmp_risklevel as unknown as number) !== riskFilter) return false;
      if (categoryFilter && String(c.cgmp_category as unknown as number) !== categoryFilter) return false;
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        if (!c.cgmp_changenumber?.toLowerCase().includes(q) && !c.cgmp_title?.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [tabFiltered, debouncedSearch, riskFilter, categoryFilter]);

  const asChange = (row: AnyRow) => row as unknown as Cgmp_changes;

  const columns = useMemo((): Column<AnyRow>[] => {
    const allCols: Column<AnyRow>[] = [
    {
      key: 'cgmp_changenumber', label: 'Change #', width: 160, sortable: true,
      render: (_: unknown, row: AnyRow) => {
        const c = asChange(row);
        return (
          <>
            <span className="change-number">{c.cgmp_changenumber}</span>
            {c.cgmp_isemergency && (
              <span
                className="badge"
                style={{ marginLeft: 4, background: 'var(--danger)', color: '#fff', fontSize: 10, padding: '1px 5px', borderRadius: 3, verticalAlign: 'middle', fontWeight: 700, letterSpacing: '0.02em' }}
                title={(c as any).cgmp_emergencyapprovedby ? `Emergency — approved by ${(c as any).cgmp_emergencyapprovedby}` : 'Emergency — pending Admin approval'}
              >
                EMERGENCY{(c as any).cgmp_emergencyapprovedby ? ' ✓ Approved' : ''}
              </span>
            )}
          </>
        );
      },
    },
    {
      key: 'cgmp_title', label: 'Title', sortable: true,
      render: (_: unknown, row: AnyRow) => <span className="change-title" title={asChange(row).cgmp_title}>{asChange(row).cgmp_title}</span>,
    },
    {
      key: 'cgmp_status', label: 'Status', width: 110, sortable: true,
      render: (_: unknown, row: AnyRow) => <StatusBadge code={asChange(row).cgmp_status as unknown as number} />,
    },
    {
      key: 'cgmp_risklevel', label: 'Risk', width: 80, sortable: true,
      render: (_: unknown, row: AnyRow) => <RiskBadge code={asChange(row).cgmp_risklevel as unknown as number} />,
    },
    {
      key: 'cgmp_category', label: 'Category', width: 110, sortable: true,
      render: (_: unknown, row: AnyRow) => categoryLabel(asChange(row).cgmp_category as unknown as number),
    },
    {
      key: 'cgmp_starttime', label: 'Start', width: 130, sortable: true,
      render: (_: unknown, row: AnyRow) => <span className="change-date">{fmtDate(asChange(row).cgmp_starttime)}</span>,
    },
    {
      key: 'cgmp_createdby', label: 'Owner', width: 110, sortable: true,
      render: (_: unknown, row: AnyRow) => {
        const c = asChange(row);
        return <span className="change-owner">{(c.cgmp_createdby as string | undefined) || c.owneridname || '—'}</span>;
      },
    },
    {
      key: '_queue_days', label: 'In Queue', width: 80, sortable: false,
      render: (_: unknown, row: AnyRow) => {
        const c = asChange(row);
        const code = c.cgmp_status as unknown as number;
        if (code !== STATUS.Published) return null;
        const days = daysInReviewQueue(c);
        if (days >= 5) return <span className="sla-chip sla-chip--red" title="Overdue — waiting more than 5 days">{days}d</span>;
        if (days >= 2) return <span className="sla-chip sla-chip--amber" title="Approaching SLA limit">{days}d</span>;
        return <span className="sla-chip sla-chip--green">{days}d</span>;
      },
    },
    {
      key: '_impact_score', label: 'Score', width: 64, sortable: false,
      render: (_: unknown, row: AnyRow) => {
        const c = asChange(row);
        const projCount = (c.cgmp_projectids ?? '').split(',').filter(Boolean).length;
        const score = impactScore(c, projCount);
        const color = score > 12 ? 'var(--danger)' : score >= 6 ? '#d97706' : 'var(--success)';
        return <span className="sla-chip" style={{ background: `${color}18`, color }} title={`Risk × Impact × Projects = ${score}`}>{score}</span>;
      },
    },
    {
      key: '_concerns', label: '', width: 28, sortable: false,
      render: (_: unknown, row: AnyRow) => {
        const c = asChange(row);
        const concerns = parseConcernsFromHistory((c as any).cgmp_versionhistory);
        if (concerns.length === 0) return null;
        return (
          <span
            className="sla-chip sla-chip--amber"
            title={`${concerns.length} ISM concern${concerns.length > 1 ? 's' : ''}: ${concerns.map(cn => cn.concernType).join(', ')}`}
            aria-label={`${concerns.length} ISM concern${concerns.length > 1 ? 's' : ''}`}
            style={{ cursor: 'help' }}
          >
            <span aria-hidden="true">⚠</span>{concerns.length}
          </span>
        );
      },
    },
    {
      key: '_rereview', label: '', width: 24,
      render: (_: unknown, row: AnyRow) => {
        const c = asChange(row);
        const code = c.cgmp_status as unknown as number;
        /* Show orange dot when previously reviewed but back in queue */
        if (c.cgmp_reviewedby && (code === STATUS.Draft || code === STATUS.Published)) {
          return <span title="Re-Review Required — previously approved but modified" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--orange)', verticalAlign: 'middle' }} />;
        }
        return null;
      },
    },
    {
      key: '_valid', label: '', width: 24,
      render: (_: unknown, row: AnyRow) => <ValidationDot change={asChange(row)} allChanges={changes} />,
    },
    ];
    return allCols.filter(col => !hiddenCols.has(col.key));
  }, [changes, hiddenCols]);

  /* ── New workflow actions ──────────────────────────────────────── */

  const [actionWorking, setActionWorking] = useState<string | null>(null);
  const [closureRemarks, setClosureRemarks] = useState<Record<string, string>>({});
  const [closureConfirm, setClosureConfirm] = useState<Cgmp_changes | null>(null);
  /* Emergency approval dialog (F-014) */
  const [emergApproveOpen, setEmergApproveOpen] = useState(false);
  const [emergApproveChange, setEmergApproveChange] = useState<Cgmp_changes | null>(null);
  const [itopsRemDrafts, setItopsRemDrafts] = useState<Record<string, { status: FailedProjectStatus; remarks: string }>>({});
  const [itopsRemSaving, setItopsRemSaving] = useState<string | null>(null);
  const [itopsHistOpen, setItopsHistOpen] = useState<Set<string>>(new Set());

  const doStatusTransition = useCallback(async (
    change: Cgmp_changes,
    newStatus: number,
    extra: Record<string, unknown> = {},
    successMsg: string,
  ): Promise<boolean> => {
    // F-014: Block emergency changes that haven't been approved by Admin
    // TODO: Replace with cgmp_emergencyapprovedby once field is added to Dataverse schema
    if (newStatus === STATUS.UnderReview && change.cgmp_isemergency && !(change as any).cgmp_emergencyapprovedby) {
      showToast('error', 'Emergency changes require Admin approval before review can begin. Use the "Approve Emergency" action.');
      return false;
    }
    const prevStatus = change.cgmp_status as unknown as number;
    setActionWorking(change.cgmp_changeid);
    try {
      const r = await Cgmp_changesService.update(change.cgmp_changeid, {
        cgmp_status: newStatus as unknown as Cgmp_changescgmp_status,
        ...extra,
      });
      if (!r.success) throw r.error ?? new Error('Update failed');
      Cgmp_auditlogsService.create({
        cgmp_auditlogname: `${change.cgmp_changenumber} status → ${statusLabel(newStatus)}`,
        cgmp_entitytype: 100000000 as unknown as Cgmp_auditlogscgmp_entitytype,
        cgmp_eventtype: 100000004 as unknown as Cgmp_auditlogscgmp_eventtype,
        cgmp_entityid: change.cgmp_changeid,
        cgmp_entityname: change.cgmp_changenumber,
        cgmp_username: currentUserName,
        cgmp_useremail: currentUserUpn,
        cgmp_ipaddress: getBrowserInfo(),
        cgmp_previousvalues: JSON.stringify({ status: statusLabel(change.cgmp_status as unknown as number) }),
        cgmp_newvalues: JSON.stringify({ status: statusLabel(newStatus), by: currentUserUpn }),
      } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch(err => { if (import.meta.env.DEV) console.error('Audit log failed:', err); });
      Cgmp_changehistoryService.create({
        cgmp_actor: currentUserUpn ?? '',
        cgmp_changeid: change.cgmp_changeid,
        cgmp_eventtype: 100000003 as any,
        cgmp_details: JSON.stringify({
          action: 'status_transition',
          from: prevStatus,
          to: newStatus,
          transitionName: `${statusLabel(prevStatus)} → ${statusLabel(newStatus)}`,
        }),
        cgmp_timestamp: new Date().toISOString(),
      } as any).catch(() => {});
      if (successMsg) showToast('success', successMsg);
      refresh();
      return true;
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Action failed');
      return false;
    } finally { setActionWorking(null); }
  }, [currentUserUpn, showToast, refresh]);

  /* Send Back to PMO — revert Published to Draft with reason */
  const doRevertToPMO = useCallback(async () => {
    if (!revertTarget || !revertReason.trim()) return;
    setReverting(true);
    try {
      const entry = { _type: 'revertedToPMO', timestamp: new Date().toISOString(), by: currentUserUpn, reason: revertReason.trim() };
      const r = await Cgmp_changesService.update(revertTarget.cgmp_changeid, {
        cgmp_status: STATUS.Draft as unknown as Cgmp_changescgmp_status,
        cgmp_versionhistory: appendHistory((revertTarget as any).cgmp_versionhistory, entry),
        cgmp_reviewnotes: `[Returned by IT Ops on ${new Date().toLocaleDateString(undefined, { timeZone: getDisplayTimezone() })}] ${revertReason.trim()}`,
      });
      if (!r.success) throw r.error ?? new Error('Update failed');
      Cgmp_auditlogsService.create({
        cgmp_auditlogname: `${revertTarget.cgmp_changenumber} Sent Back to PMO`,
        cgmp_entitytype: 100000000 as unknown as Cgmp_auditlogscgmp_entitytype,
        cgmp_eventtype: 100000004 as unknown as Cgmp_auditlogscgmp_eventtype,
        cgmp_entityid: revertTarget.cgmp_changeid,
        cgmp_entityname: revertTarget.cgmp_changenumber,
        cgmp_username: currentUserName,
        cgmp_useremail: currentUserUpn,
        cgmp_ipaddress: getBrowserInfo(),
        cgmp_previousvalues: JSON.stringify({ status: 'Published' }),
        cgmp_newvalues: JSON.stringify({ status: 'Draft', reason: revertReason.trim(), by: currentUserUpn }),
      } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch(err => { if (import.meta.env.DEV) console.error('Audit log failed:', err); });
      Cgmp_changehistoryService.create({
        cgmp_actor: currentUserUpn ?? '',
        cgmp_changeid: revertTarget.cgmp_changeid,
        cgmp_eventtype: 100000003 as any,
        cgmp_details: JSON.stringify({
          action: 'status_transition',
          from: STATUS.Published,
          to: STATUS.Draft,
          transitionName: 'Send Back to PMO',
          reason: revertReason.trim(),
        }),
        cgmp_timestamp: new Date().toISOString(),
      } as any).catch(() => {});
      /* Notify the PMO change owner */
      const ownerProfile = allProfiles.find(p =>
        p.cgmp_userprincipalname === revertTarget.cgmp_createdby ||
        p.owneridname === revertTarget.cgmp_createdby
      );
      if (ownerProfile?.cgmp_userprofileid) {
        Cgmp_notificationsService.create({
          cgmp_title: `Change Returned for Revision: ${revertTarget.cgmp_changenumber}`,
          cgmp_message: `IT Ops has returned "${revertTarget.cgmp_title}" to Draft. Reason: ${revertReason.trim()}`,
          cgmp_category: asNotifCategory(100000000),
          cgmp_priority: asNotifPriority(100000000),
          cgmp_recipientid: ownerProfile.cgmp_userprofileid,
          cgmp_relatedchangeid: revertTarget.cgmp_changeid,
          cgmp_actionurl: `#pmo?change=${revertTarget.cgmp_changenumber ?? ''}`,
          statecode: 0,
        } as unknown as Omit<Cgmp_notificationsBase, 'cgmp_notificationid'>).catch(err => { if (import.meta.env.DEV) console.error('Notification failed:', err); });
      }
      showToast('success', `${revertTarget.cgmp_changenumber} sent back to PMO as Draft`);
      setRevertTarget(null);
      setRevertReason('');
      refresh();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Revert failed');
    } finally { setReverting(false); }
  }, [revertTarget, revertReason, currentUserUpn, showToast, refresh, allProfiles]);

  /* Reschedule Flow (#25) */
  const doReschedule = useCallback(async () => {
    if (!reschedTarget || !reschedStart || !reschedEnd || !reschedReason.trim()) return;
    if (!allProfiles?.length) { showToast('error', 'User profiles not yet loaded — please try again.'); return; }
    setReschedWorking(true);
    try {
      const entry = { _type: 'rescheduleProposed', timestamp: new Date().toISOString(), by: currentUserUpn, byProfileId: userProfile?.cgmp_userprofileid, proposedStart: reschedStart, proposedEnd: reschedEnd, reason: reschedReason.trim() };
      await Cgmp_changesService.update(reschedTarget.cgmp_changeid, {
        cgmp_versionhistory: appendHistory((reschedTarget as any).cgmp_versionhistory, entry),
      } as any);
      // Notify PMO owner + Admins
      const pmoPoc = allProfiles.find((p: any) => p.cgmp_userprincipalname === reschedTarget.cgmp_createdby);
      const admins = allProfiles.filter((p: any) =>
        (p.cgmp_role as unknown as number) === 100000000 && p.cgmp_userprofileid !== pmoPoc?.cgmp_userprofileid
      );
      const notifyList = [pmoPoc, ...admins].filter(Boolean);
      const msg = `IT Ops has proposed a reschedule for ${reschedTarget.cgmp_changenumber}: New window ${fmtDate(reschedStart)} – ${fmtDate(reschedEnd)}. Reason: ${reschedReason.trim()}`;
      notifyList.forEach((recipient: any) => {
        Cgmp_notificationsService.create({
          cgmp_title: `Reschedule Proposed: ${reschedTarget!.cgmp_changenumber}`,
          cgmp_category: asNotifCategory(100000000),
          cgmp_priority: asNotifPriority(100000001),
          cgmp_message: msg,
          cgmp_relatedchangeid: reschedTarget!.cgmp_changeid,
          cgmp_actionurl: `#pmo?change=${reschedTarget!.cgmp_changenumber ?? ''}`,
          cgmp_recipientid: recipient.cgmp_userprofileid,
          ownerid: recipient.cgmp_userprofileid,
          statecode: 0,
        } as unknown as Omit<Cgmp_notificationsBase, 'cgmp_notificationid'>).catch(err => { if (import.meta.env.DEV) console.error('Background operation failed:', err); });
      });
      showToast('success', `Reschedule proposal sent for ${reschedTarget.cgmp_changenumber}`);
      setReschedTarget(null);
      setReschedStart(''); setReschedEnd(''); setReschedReason('');
      refresh();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Reschedule proposal failed');
    } finally { setReschedWorking(false); }
  }, [reschedTarget, reschedStart, reschedEnd, reschedReason, currentUserUpn, showToast, refresh, allProfiles]);

  /* IT Ops Quick Edit — open panel */
  const openItopsEdit = (change: Cgmp_changes) => {
    setItopsEditTarget(change);
    setItopsEditForm({
      risklevel: String(change.cgmp_risklevel as unknown as number ?? ''),
      impactlevel: String(change.cgmp_impactlevel as unknown as number ?? ''),
      description: change.cgmp_description ?? '',
      projectids: change.cgmp_projectids ?? '',
    });
    setItopsEditOpen(true);
  };

  /* IT Ops Quick Edit — save */
  const saveItopsEdit = async () => {
    if (!itopsEditTarget) return;
    setItopsEditSaving(true);
    try {
      const r = await Cgmp_changesService.update(itopsEditTarget.cgmp_changeid, {
        cgmp_risklevel: parseInt(itopsEditForm.risklevel) as unknown as Cgmp_changescgmp_risklevel,
        cgmp_impactlevel: parseInt(itopsEditForm.impactlevel) as unknown as Cgmp_changescgmp_impactlevel,
        cgmp_description: itopsEditForm.description || undefined,
        cgmp_projectids: itopsEditForm.projectids || undefined,
      });
      if (!r.success) throw r.error ?? new Error('Failed to save');
      Cgmp_auditlogsService.create({
        cgmp_auditlogname: `${itopsEditTarget.cgmp_changenumber} Fields Updated by IT Ops`,
        cgmp_entitytype: 100000000 as unknown as Cgmp_auditlogscgmp_entitytype,
        cgmp_eventtype: 100000003 as unknown as Cgmp_auditlogscgmp_eventtype,
        cgmp_entityid: itopsEditTarget.cgmp_changeid,
        cgmp_entityname: itopsEditTarget.cgmp_changenumber,
        cgmp_username: currentUserName,
        cgmp_useremail: currentUserUpn,
        cgmp_ipaddress: getBrowserInfo(),
      } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch(err => { if (import.meta.env.DEV) console.error('Audit log failed:', err); });
      showToast('success', 'Change updated');
      setItopsEditOpen(false);
      refresh();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Update failed');
    } finally {
      setItopsEditSaving(false);
    }
  };

  /* downloadingAll tracks which changeId is bulk-downloading */
  const [downloadingAll, setDownloadingAll] = useState<string | null>(null);

  const downloadAllFiles = useCallback(async (changeId: string) => {
    setDownloadingAll(changeId);
    try {
      const files = await loadAnnotations(changeId);
      if (files.length === 0) { showToast('info', 'No files attached to this change'); return; }
      for (let i = 0; i < files.length; i++) {
        downloadAnnotation(files[i]);
        if (i < files.length - 1) await new Promise(r => setTimeout(r, 400));
      }
      showToast('success', `Downloaded ${files.length} file${files.length !== 1 ? 's' : ''}`);
    } catch { showToast('error', 'Download failed'); }
    finally { setDownloadingAll(null); }
  }, [showToast]);

  /* Move Released → UATUpdates (open ISM UAT collection phase) and notify ISMs */
  const moveToUATCollection = useCallback(async (change: Cgmp_changes) => {
    const ok = await doStatusTransition(change, STATUS.UATUpdates, {},
      `${change.cgmp_changenumber} moved to UAT Collection`);
    if (!ok) return;

    /* Collect unique ISM contacts from impacted projects */
    const projectIds = (change.cgmp_projectids ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const impacted = projects.filter(p => projectIds.includes(p.cgmp_projectid));
    const ismSet = new Set<string>();
    impacted.forEach(p => { if (p.cgmp_primaryism) ismSet.add(p.cgmp_primaryism); if (p.cgmp_backupism) ismSet.add(p.cgmp_backupism); });

    const deadline = change.cgmp_starttime ? ismFreezeDate(change.cgmp_starttime).toLocaleDateString(undefined, { timeZone: getDisplayTimezone() }) : 'T-3 days';
    await Promise.allSettled(Array.from(ismSet).map(ism =>
      Cgmp_notificationsService.create({
        cgmp_title: `UAT Users Required — ${change.cgmp_changenumber}`,
        cgmp_message: `Please update UAT users for "${change.cgmp_title}" (${change.cgmp_changenumber}). Deadline: ${deadline}.`,
        cgmp_category: asNotifCategory(100000001),
        cgmp_priority: asNotifPriority(100000001),
        cgmp_recipientid: ism,
        cgmp_relatedchangeid: change.cgmp_changeid,
        cgmp_actionurl: `#pmo?change=${change.cgmp_changenumber ?? ''}`,
        cgmp_isdismissed: false,
        cgmp_isread: false,
        statecode: 0,
      } as unknown as Omit<Cgmp_notificationsBase, 'cgmp_notificationid'>)
    ));
    showToast('success', `ISMs notified (${ismSet.size} contact${ismSet.size !== 1 ? 's' : ''})`);
  }, [doStatusTransition, projects, showToast]);

  /* Lock UAT: UATUpdates → Locked — do NOT overwrite cgmp_reviewedby/reviewedat (those record the IT Ops reviewer, not the UAT lock action) */
  const lockUAT = useCallback(async (change: Cgmp_changes) => {
    const uatData = parseChangeUATData((change as any).cgmp_uatusers);
    const hasContacts = Object.values(uatData).some(e => e.contacts.length > 0);
    if (!hasContacts) {
      if (!window.confirm(
        'No UAT contacts are assigned for any project. Locking without contacts will leave GIICC without UAT contact information. Proceed anyway?'
      )) return;
    }
    await doStatusTransition(change, STATUS.Locked, {}, `UAT locked for ${change.cgmp_changenumber}`);
  }, [doStatusTransition]);

  /* Handover to GIICC: Locked/Released → InProgress (with ISM sign-off and UAT contacts gates) */
  const handoverToGIICC = useCallback(async (change: Cgmp_changes) => {
    // ISM sign-off gate
    let hist: any[] = [];
    try { hist = JSON.parse((change as any).cgmp_versionhistory ?? '[]'); } catch {}
    const hasIsmSignoff = hist.some((entry: any) => entry._type === 'ism-signoff');
    if (!hasIsmSignoff) {
      showToast('error', 'ISM has not signed off on this change. Ask the ISM team to sign off before handover.');
      return;
    }

    // UAT contacts check (only for UAT-required changes)
    if ((change as any).cgmp_uatrequired) {
      const uatData = parseChangeUATData(change.cgmp_uatusers);
      const projectIds = (change.cgmp_projectids ?? '').split(',').map(s => s.trim()).filter(Boolean);
      const hasUatGap = projectIds.some(pid => {
        const entry = uatData[pid];
        return !entry || entry.contacts.length === 0;
      });
      if (hasUatGap) {
        showToast('error', 'Some projects have no UAT contacts assigned. Update UAT contacts before handover.');
        return;
      }
    }

    await doStatusTransition(change, STATUS.InProgress, { cgmp_releasedby: currentUserUpn, cgmp_releasedat: new Date().toISOString(), cgmp_actualstarttime: new Date().toISOString() },
      `${change.cgmp_changenumber} handed over to GIICC Command Center`);
  }, [doStatusTransition, showToast, currentUserUpn]);

  const actions = useCallback((row: AnyRow): ReactNode => {
    const c = asChange(row);
    const sc = c.cgmp_status as unknown as number;
    const isWorking = actionWorking === c.cgmp_changeid;
    return (
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <button className="btn btn--outline btn--sm" onClick={() => setReviewChange(c)}>Review</button>
        {/* F-014: Approve Emergency button — Admin only, unapproved emergency changes */}
        {c.cgmp_isemergency && !(c as any).cgmp_emergencyapprovedby && isAdmin && (
          <button
            className="btn btn--sm"
            style={{ background: 'var(--danger)', color: '#fff', border: 'none' }}
            title="Approve this emergency change designation for expedited processing"
            onClick={e => { e.stopPropagation(); setEmergApproveChange(c); setEmergApproveOpen(true); }}
          >
            Approve Emergency
          </button>
        )}
        {(sc === 100000001 || sc === 100000002) && (
          <button className="btn btn--sm btn--outline" onClick={() => openItopsEdit(c)}>Edit Fields</button>
        )}
        {sc === STATUS.Published && (
          <button className="btn btn--sm btn--outline" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
            title="Send back to PMO as Draft — requires a reason"
            onClick={e => { e.stopPropagation(); setRevertTarget(c); setRevertReason(''); }}>
            ↩ Send Back
          </button>
        )}
        {(sc === STATUS.Published || sc === STATUS.UnderReview) && (
          expiredChangeIds.has(c.cgmp_changeid)
            ? <span className="badge badge--default" style={{ fontSize: 10, padding: '1px 6px', verticalAlign: 'middle' }} title="Reschedule proposal has expired (over 24 hours with no response)">Proposal Expired</span>
            : <button className="btn btn--sm btn--outline" title="Propose a new schedule to PMO"
                onClick={e => {
                  e.stopPropagation();
                  setReschedTarget(c);
                  setReschedStart(c.cgmp_starttime ? new Date(c.cgmp_starttime).toISOString().slice(0, 16) : '');
                  setReschedEnd(c.cgmp_endtime ? new Date(c.cgmp_endtime).toISOString().slice(0, 16) : '');
                  setReschedReason('');
                }}>
                ⏱ Reschedule
              </button>
        )}
        {sc === STATUS.Released && !!(c as any).cgmp_uatrequired && (
          <button className="btn btn--sm" style={{ background: 'var(--orange)', color: '#fff', border: 'none' }}
            disabled={isWorking} onClick={() => moveToUATCollection(c)}>
            {isWorking ? '…' : 'To UAT Collection'}
          </button>
        )}
        {sc === STATUS.Released && !(c as any).cgmp_uatrequired && (
          <button className="btn btn--sm btn--primary" disabled={isWorking} onClick={() => handoverToGIICC(c)}>
            {isWorking ? '…' : 'Handover to GIICC'}
          </button>
        )}
        {sc === STATUS.UATUpdates && !!(c as any).cgmp_uatrequired && (
          <button className="btn btn--sm btn--outline" disabled={isWorking} onClick={() => lockUAT(c)}>
            {isWorking ? '…' : 'Lock UAT'}
          </button>
        )}
        {sc === STATUS.Locked && !!(c as any).cgmp_uatrequired && (
          <button className="btn btn--sm btn--primary" disabled={isWorking} onClick={() => handoverToGIICC(c)}>
            {isWorking ? '…' : 'Handover to GIICC'}
          </button>
        )}
        {sc === STATUS.Completed && (
          <button className="btn btn--sm btn--primary" onClick={() => setClosureConfirm(c)}>Close Change</button>
        )}
      </div>
    );
  }, [actionWorking, moveToUATCollection, lockUAT, handoverToGIICC, isAdmin, expiredChangeIds]);

  /* Close change: Completed → Closed */
  const doCloseChange = useCallback(async () => {
    if (!closureConfirm) return;
    const change = closureConfirm;
    const remarks = closureRemarks[change.cgmp_changeid] ?? '';
    if (!remarks.trim()) { showToast('error', 'Closure remarks are required before closing a change.'); return; }
    // PIR notes are required before closing UAT changes
    if ((change as any).cgmp_uatrequired && !change.cgmp_pirnotes?.trim()) {
      showToast('error', 'PIR notes are required before closing UAT changes. Ask GIICC to complete the PIR first.');
      return;
    }
    setActionWorking(change.cgmp_changeid);
    try {
      const r = await Cgmp_changesService.update(change.cgmp_changeid, {
        cgmp_status: STATUS.Closed as unknown as Cgmp_changescgmp_status,
        cgmp_closureremarks: remarks,
        cgmp_actualendtime: new Date().toISOString(),
      });
      if (!r.success) throw r.error ?? new Error('Close failed');
      Cgmp_auditlogsService.create({
        cgmp_auditlogname: `${change.cgmp_changenumber} Officially Closed`,
        cgmp_entitytype: 100000000 as unknown as Cgmp_auditlogscgmp_entitytype,
        cgmp_eventtype: 100000009 as unknown as Cgmp_auditlogscgmp_eventtype,
        cgmp_entityid: change.cgmp_changeid,
        cgmp_entityname: change.cgmp_changenumber,
        cgmp_username: currentUserName,
        cgmp_useremail: currentUserUpn,
        cgmp_ipaddress: getBrowserInfo(),
        cgmp_newvalues: JSON.stringify({ status: 'Closed', by: currentUserUpn, remarks }),
      } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch(err => { if (import.meta.env.DEV) console.error('Audit log failed:', err); });
      Cgmp_changehistoryService.create({
        cgmp_actor: currentUserUpn ?? '',
        cgmp_changeid: change.cgmp_changeid,
        cgmp_eventtype: 100000003 as any,
        cgmp_details: JSON.stringify({
          action: 'status_transition',
          from: STATUS.Completed,
          to: STATUS.Closed,
          transitionName: 'Close Change',
        }),
        cgmp_timestamp: new Date().toISOString(),
      } as any).catch(() => {});
      showToast('success', `${change.cgmp_changenumber} officially closed`);
      setClosureConfirm(null);
      refresh();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to close change');
    } finally { setActionWorking(null); }
  }, [closureConfirm, closureRemarks, currentUserUpn, showToast, refresh]);

  /* F-014: Admin approval of emergency change designation */
  const handleApproveEmergency = useCallback(async (change: Cgmp_changes) => {
    try {
      // TODO: Replace with cgmp_emergencyapprovedby once field is added to Dataverse schema
      await Cgmp_changesService.update(change.cgmp_changeid, {
        cgmp_emergencyapprovedby: currentUserName,
      } as any);
      // Audit log — fire-and-forget
      Cgmp_auditlogsService.create({
        cgmp_actor: currentUserUpn ?? '',
        cgmp_eventtype: 100000003 as any, // ChangeUpdated
        cgmp_details: `Emergency change approved by Admin. Change: ${change.cgmp_changenumber}`,
        cgmp_timestamp: new Date().toISOString() as any,
        cgmp_changeid: change.cgmp_changeid,
      } as any).catch(() => {});
      setEmergApproveOpen(false);
      setEmergApproveChange(null);
      refresh();
    } catch (err) {
      if (import.meta.env.DEV) console.error('Emergency approval failed', err);
      showToast('error', 'Emergency approval failed. Please try again.');
    }
  }, [currentUserName, currentUserUpn, showToast, refresh]);

  /* IT Ops remediation status update (cannot set Closed — GIICC only) */
  const saveItopsRemediation = useCallback(async (change: Cgmp_changes, pid: string) => {
    const key = `${change.cgmp_changeid}::${pid}`;
    const draft = itopsRemDrafts[key];
    if (!draft) return;
    setItopsRemSaving(key);
    try {
      const uatData = parseChangeUATData(change.cgmp_uatusers);
      const entry = uatData[pid] ?? defaultUATEntry();
      const prevStatus = entry.remediationStatus ?? 'Failed';
      const histEntry: RemediationHistoryEntry = {
        status: draft.status,
        previousStatus: prevStatus,
        updatedBy: currentUserUpn ?? '',
        timestamp: new Date().toISOString(),
        remarks: draft.remarks,
      };
      const updatedData = {
        ...uatData,
        [pid]: { ...entry, remediationStatus: draft.status, remediationHistory: [...(entry.remediationHistory ?? []), histEntry] },
      };
      const r = await Cgmp_changesService.update(change.cgmp_changeid, { cgmp_uatusers: JSON.stringify(updatedData) });
      if (!r.success) throw r.error ?? new Error('Save failed');
      Cgmp_auditlogsService.create({
        cgmp_auditlogname: `Remediation status update: ${pid} → ${draft.status}`,
        cgmp_entitytype: 100000000 as unknown as Cgmp_auditlogscgmp_entitytype,
        cgmp_eventtype: 100000004 as unknown as Cgmp_auditlogscgmp_eventtype,
        cgmp_entityid: change.cgmp_changeid,
        cgmp_entityname: change.cgmp_changenumber,
        cgmp_username: currentUserName,
        cgmp_useremail: currentUserUpn,
        cgmp_ipaddress: getBrowserInfo(),
        cgmp_previousvalues: JSON.stringify({ remediationStatus: prevStatus }),
        cgmp_newvalues: JSON.stringify({ remediationStatus: draft.status, by: currentUserUpn, remarks: draft.remarks }),
      } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch(err => { if (import.meta.env.DEV) console.error('Audit log failed:', err); });
      setItopsRemDrafts(prev => { const n = { ...prev }; delete n[key]; return n; });
      refresh();
      showToast('success', `Remediation → ${remStatusLabel(draft.status)}`);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Save failed');
    } finally { setItopsRemSaving(null); }
  }, [itopsRemDrafts, currentUserUpn, refresh, showToast]);

  /* Bulk approve — only UnderReview changes may be batch-released */
  const eligibleBulk = useMemo(() => {
    return changes.filter(c =>
      selectedIds.has(c.cgmp_changeid) &&
      (c.cgmp_status as unknown as number) === STATUS.UnderReview &&
      !hasBlockingErrors(validateForReview(c, changes))
    );
  }, [changes, selectedIds]);

  const doBulkApprove = useCallback(async () => {
    /* Warn about selected changes skipped because they are not in UnderReview */
    const skipped = changes.filter(c =>
      selectedIds.has(c.cgmp_changeid) &&
      (c.cgmp_status as unknown as number) !== STATUS.UnderReview
    );
    if (skipped.length > 0) {
      showToast('warning', `${skipped.length} change${skipped.length !== 1 ? 's' : ''} skipped — must be in UnderReview status to approve`);
    }

    setBulkWorking(true);
    const now = new Date().toISOString();
    let success = 0;
    try {
      await Promise.all(eligibleBulk.map(async c => {
        try {
          const r = await Cgmp_changesService.update(c.cgmp_changeid, {
            cgmp_status: STATUS.Released as unknown as Cgmp_changescgmp_status,
            cgmp_reviewedby: currentUserUpn,
            cgmp_reviewedat: now,
            cgmp_reviewnotes: 'Bulk approved',
          });
          if (!r.success) throw r.error ?? new Error('Update failed');
          Cgmp_auditlogsService.create({
            cgmp_auditlogname: `${c.cgmp_changenumber} Bulk Approved`,
            cgmp_entitytype: 100000000 as unknown as Cgmp_auditlogscgmp_entitytype,
            cgmp_eventtype: 100000005 as unknown as Cgmp_auditlogscgmp_eventtype,
            cgmp_entityid: c.cgmp_changeid,
            cgmp_entityname: c.cgmp_changenumber,
            cgmp_username: currentUserName,
            cgmp_useremail: currentUserUpn,
            cgmp_ipaddress: getBrowserInfo(),
            cgmp_previousvalues: JSON.stringify({ status: c.cgmp_statusname }),
            cgmp_newvalues: JSON.stringify({ status: 'Released', note: 'Bulk approved' }),
          } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch(err => { if (import.meta.env.DEV) console.error('Audit log failed:', err); });
          Cgmp_changehistoryService.create({
            cgmp_actor: currentUserUpn ?? '',
            cgmp_changeid: c.cgmp_changeid,
            cgmp_eventtype: 100000003 as any,
            cgmp_details: JSON.stringify({
              action: 'status_transition',
              from: STATUS.UnderReview,
              to: STATUS.Released,
              transitionName: 'Bulk Approve',
            }),
            cgmp_timestamp: now,
          } as any).catch(() => {});
          success++;
        } catch { /* count failures */ }
      }));
      showToast('success', `Approved ${success} of ${eligibleBulk.length} change${eligibleBulk.length !== 1 ? 's' : ''}`);
      setSelectedIds(new Set());
      refresh();
    } catch { /* handled per-item */ } finally {
      setBulkWorking(false);
      setBulkConfirmOpen(false);
    }
  }, [changes, selectedIds, eligibleBulk, showToast, refresh, currentUserUpn]);

  /* Impact analysis uses selected rows */
  const selectedChanges = useMemo(() => changes.filter(c => selectedIds.has(c.cgmp_changeid)), [changes, selectedIds]);

  const clearFilters = () => { setSearch(''); setRiskFilter(''); setCategoryFilter(''); };
  const hasFilter = search || riskFilter || categoryFilter;

  if (error && changes.length === 0) return (
    <div className="module-empty" role="alert">
      <p style={{ color: 'var(--danger)' }}>Failed to load changes: {error}</p>
      <button className="btn btn--outline" onClick={refresh}>Retry</button>
    </div>
  );

  return (
    <div className="itops-workspace">
      {/* Header */}
      <div className="pmo-header">
        <div>
          <h1 className="pmo-header__title">IT Ops Workspace</h1>
          <p className="pmo-header__sub">Review, validate, and approve change requests</p>
        </div>
        <div className="pmo-header__actions">
          {selectedIds.size > 0 && (
            <button className="btn btn--outline" onClick={() => setBulkReassignOpen(true)}>
              Reassign POC ({selectedIds.size})
            </button>
          )}
          {selectedIds.size > 0 && (
            <button className="btn btn--outline" onClick={() => setImpactOpen(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-6h2v6zm0-8h-2V7h2v2z" />
              </svg>
              Impact Analysis ({selectedIds.size})
            </button>
          )}
          {eligibleBulk.length > 0 && (
            <button className="btn btn--primary" onClick={() => setBulkConfirmOpen(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
              </svg>
              Bulk Approve ({eligibleBulk.length})
            </button>
          )}
        </div>
      </div>

      {/* KPI tabs */}
      <div className="itops-stats" role="tablist" aria-label="IT Ops change views">
        <StatChip label="Pending Review" value={pending} active={activeTab === 'pending'} onClick={() => handleActiveTabChange('pending')} accent="var(--primary)" id="itops-tab-pending" onKeyDown={e => handleChipKeyDown(e, 'pending')} />
        <StatChip label="Under Review" value={underReview} active={activeTab === 'review'} onClick={() => handleActiveTabChange('review')} id="itops-tab-review" onKeyDown={e => handleChipKeyDown(e, 'review')} />
        <StatChip label="Released Today" value={releasedToday} active={activeTab === 'released'} onClick={() => handleActiveTabChange('released')} accent="var(--success)" id="itops-tab-released" onKeyDown={e => handleChipKeyDown(e, 'released')} />
        <StatChip label="Overdue" value={overdue} active={false} onClick={() => handleActiveTabChange('all')} accent={overdue > 0 ? 'var(--danger)' : undefined} id="itops-tab-overdue" onKeyDown={e => handleChipKeyDown(e, 'overdue')} />
        <StatChip label="UAT Collection" value={uatCollectionCount} active={activeTab === 'uatcollection'} onClick={() => handleActiveTabChange('uatcollection')} accent="var(--orange)" id="itops-tab-uatcollection" onKeyDown={e => handleChipKeyDown(e, 'uatcollection')} />
        <StatChip label="GIICC Handover" value={handoverCount} active={activeTab === 'handover'} onClick={() => handleActiveTabChange('handover')} accent="#8764B8" id="itops-tab-handover" onKeyDown={e => handleChipKeyDown(e, 'handover')} />
        <StatChip label="Pending Closure" value={closureCount} active={activeTab === 'closure'} onClick={() => handleActiveTabChange('closure')} accent="var(--success)" id="itops-tab-closure" onKeyDown={e => handleChipKeyDown(e, 'closure')} />
        <StatChip label="All Changes" value={changes.length} active={activeTab === 'all'} onClick={() => handleActiveTabChange('all')} id="itops-tab-all" onKeyDown={e => handleChipKeyDown(e, 'all')} />
        <StatChip label="SLA Dashboard" value={slaData.breachingCount} active={activeTab === 'sla'} onClick={() => handleActiveTabChange('sla')} accent={slaData.criticalCount > 0 ? 'var(--danger)' : slaData.breachingCount > 0 ? 'var(--orange)' : undefined} id="itops-tab-sla" onKeyDown={e => handleChipKeyDown(e, 'sla')} />
        <StatChip label="Bridge Activity" value={itopsBridges.length} active={activeTab === 'bridges'} onClick={() => handleActiveTabChange('bridges')} accent={itopsBridges.some(b => (b.cgmp_status as unknown as number) === BRIDGE_STATUS.Failed) ? 'var(--danger)' : itopsBridges.some(b => (b.cgmp_status as unknown as number) === BRIDGE_STATUS.InProgress) ? '#8764B8' : undefined} id="itops-tab-bridges" onKeyDown={e => handleChipKeyDown(e, 'bridges')} />
      </div>

      {/* Table card — hidden for new workflow tabs */}
      {activeTab !== 'uatcollection' && activeTab !== 'handover' && activeTab !== 'closure' && activeTab !== 'sla' && activeTab !== 'bridges' && <div className="pmo-table-card" role="tabpanel" id="itops-panel-changes" aria-labelledby={`itops-tab-${activeTab}`}>
        {/* Filters */}
        <div className="filter-bar">
          <SearchInput value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by title or change number…" style={{ width: 240 }} />
          <Select value={riskFilter} onChange={e => setRiskFilter(e.target.value)} options={RISK_FILTER} style={{ width: 120 }} />
          <Select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} options={CATEGORY_FILTER} style={{ width: 140 }} />
          {hasFilter && <button className="btn btn--outline btn--sm" onClick={clearFilters}>Clear</button>}
          {/* Column Visibility Toggle (#71) */}
          <div style={{ position: 'relative' }} ref={colVisRef}>
            <button className="btn btn--outline btn--sm" onClick={() => setColVisOpen(o => !o)} title="Show/hide columns">
              Columns
            </button>
            {colVisOpen && (
              <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 200, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px', minWidth: 160, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', marginTop: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>VISIBLE COLUMNS</div>
                {ITOPS_ALL_COL_DEFS.map(def => (
                  <label key={def.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!hiddenCols.has(def.key)} onChange={() => toggleCol(def.key)} />
                    {def.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <span className="filter-count">{filtered.length} of {tabFiltered.length}</span>
        </div>

        <DataTable
          columns={columns}
          rows={filtered as unknown as AnyRow[]}
          loading={loading}
          selectable
          selectedIds={selectedIds}
          idKey="cgmp_changeid"
          onSelectionChange={setSelectedIds}
          onRowClick={(row) => { const change = row as unknown as Cgmp_changes; setReviewChange(change); }}
          pageSize={25}
          emptyMessage={activeTab === 'pending' ? 'No changes pending review.' : 'No changes in this view.'}
          actions={actions}
        />
      </div>}

      {/* ── SLA Dashboard panel ── */}
      {activeTab === 'sla' && (
        <div className="itops-sla-panel" role="tabpanel" id="itops-panel-sla" aria-labelledby="itops-tab-sla">
          <div className="itops-sla-kpis">
            <div className="itops-sla-kpi">
              <span className="itops-sla-kpi__value">{slaData.queueChanges.length}</span>
              <span className="itops-sla-kpi__label">In Queue</span>
            </div>
            <div className="itops-sla-kpi">
              <span className="itops-sla-kpi__value" style={{ color: slaData.avgQueueDays >= 5 ? 'var(--danger)' : slaData.avgQueueDays >= 2 ? 'var(--orange)' : 'var(--success)' }}>{slaData.avgQueueDays}d</span>
              <span className="itops-sla-kpi__label">Avg Queue Days</span>
            </div>
            <div className="itops-sla-kpi">
              <span className="itops-sla-kpi__value" style={{ color: slaData.breachingCount > 0 ? 'var(--orange)' : 'var(--success)' }}>{slaData.breachingCount}</span>
              <span className="itops-sla-kpi__label">Breaching SLA (&ge;2d)</span>
            </div>
            <div className="itops-sla-kpi">
              <span className="itops-sla-kpi__value" style={{ color: slaData.criticalCount > 0 ? 'var(--danger)' : 'var(--success)' }}>{slaData.criticalCount}</span>
              <span className="itops-sla-kpi__label">Critical (&ge;5d)</span>
            </div>
          </div>

          <div className="itops-sla-tables">
            {/* Review Queue */}
            <div className="itops-sla-section">
              <h3 className="itops-sla-section__title">Review Queue ({slaData.queueChanges.length})</h3>
              {slaData.queueChanges.length === 0 ? (
                <div className="module-empty">No changes currently in review queue.</div>
              ) : (
                <table className="itops-sla-table">
                  <thead>
                    <tr>
                      <th>Change</th>
                      <th>Title</th>
                      <th>Status</th>
                      <th>Days in Queue</th>
                      <th>Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slaData.queueChanges.map(({ change, days }) => {
                      const slaClass = days >= 5 ? 'sla-red' : days >= 2 ? 'sla-amber' : 'sla-green';
                      return (
                        <tr key={change.cgmp_changeid} className="itops-sla-table__row" onClick={() => setReviewChange(change)} style={{ cursor: 'pointer' }}>
                          <td><span className="change-number">{change.cgmp_changenumber}</span></td>
                          <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{change.cgmp_title}</td>
                          <td><span className={`badge badge--status ${statusColor(change.cgmp_status as unknown as number)}`}>{statusLabel(change.cgmp_status as unknown as number)}</span></td>
                          <td>
                          <span className={`itops-sla-days itops-sla-days--${slaClass}`}>
                            {days >= 2 && <span aria-label="SLA breach — deadline exceeded" role="img" style={{ marginRight: 2 }}>⚠</span>}
                            {days}d
                          </span>
                        </td>
                          <td><span style={{ fontSize: 12 }}>{change.cgmp_risklevel ?? '—'}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* POC Workload */}
            <div className="itops-sla-section">
              <h3 className="itops-sla-section__title">POC Workload</h3>
              {slaData.pocWorkload.length === 0 ? (
                <div className="module-empty">No POC data available.</div>
              ) : (
                <table className="itops-sla-table">
                  <thead>
                    <tr>
                      <th>POC / Owner</th>
                      <th>Changes in Queue</th>
                      <th>Critical (&ge;5d)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slaData.pocWorkload.map(poc => (
                      <tr key={poc.name} className="itops-sla-table__row">
                        <td style={{ fontWeight: 500 }}>{poc.name}</td>
                        <td>
                          <span style={{ fontWeight: 600 }}>{poc.count}</span>
                          <span className="itops-sla-bar" style={{ '--fill': `${Math.min(100, poc.count * 10)}%` } as React.CSSProperties} />
                        </td>
                        <td>
                          {poc.criticalCount > 0
                            ? <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{poc.criticalCount} critical</span>
                            : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Bridge Activity panel (read-only — IT Ops can view, GIICC executes) ── */}
      {activeTab === 'bridges' && (
        <div className="itops-sla-panel" role="tabpanel" id="itops-panel-bridges" aria-labelledby="itops-tab-bridges">
          <div className="itops-sla-section">
            <h3 className="itops-sla-section__title">Bridge Activity ({itopsBridges.length})</h3>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
              Read-only view of bridge executions linked to changes in your purview. Bridge execution is managed in the GIICC workspace.
            </p>
            {bridgesLoading ? (
              <div className="module-empty">Loading bridge data…</div>
            ) : itopsBridges.length === 0 ? (
              <div className="module-empty">No bridge activity found for changes in your purview.</div>
            ) : (
              <table className="itops-sla-table">
                <thead>
                  <tr>
                    <th>Bridge</th>
                    <th>Change</th>
                    <th>Status</th>
                    <th>Scheduled Start</th>
                    <th>Actual Start</th>
                    <th>Actual End</th>
                  </tr>
                </thead>
                <tbody>
                  {itopsBridges.map(bridge => {
                    const bsc = bridge.cgmp_status as unknown as number;
                    const badgeBg =
                      bsc === BRIDGE_STATUS.Completed ? 'var(--success)' :
                      bsc === BRIDGE_STATUS.Failed    ? 'var(--danger)'  :
                      bsc === BRIDGE_STATUS.Cancelled ? '#605E5C'        :
                      bsc === BRIDGE_STATUS.Scheduled ? '#0078D4'        :
                      '#8764B8'; /* Active */
                    return (
                      <tr key={bridge.cgmp_bridgeid} className="itops-sla-table__row">
                        <td style={{ fontWeight: 500 }}>{bridge.cgmp_title}</td>
                        <td><span className="change-number">{bridge.cgmp_changenumber ?? '—'}</span></td>
                        <td>
                          <span className="badge" style={{ background: badgeBg, color: '#fff', fontSize: 11 }}>
                            {bridgeStatusLabel(bsc)}
                          </span>
                        </td>
                        <td className="change-date">{fmtDate(bridge.cgmp_schedstart)}</td>
                        <td className="change-date">{bridge.cgmp_actualstart ? fmtDate(bridge.cgmp_actualstart) : '—'}</td>
                        <td className="change-date">{bridge.cgmp_actualend ? fmtDate(bridge.cgmp_actualend) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── UAT Collection details panel (shown inline when tab = uatcollection or handover) ── */}
      {(activeTab === 'uatcollection' || activeTab === 'handover' || activeTab === 'closure') && (
        <div className="itops-uat-panel" role="tabpanel" id="itops-panel-uat" aria-labelledby={`itops-tab-${activeTab}`}>
          {tabFiltered.length === 0 ? (
            <div className="module-empty">
              {activeTab === 'uatcollection' && 'No changes in UAT Collection phase. Approve and release changes first, then click "To UAT Collection".'}
              {activeTab === 'handover' && 'No changes awaiting GIICC handover. Lock UAT for UATUpdates changes first.'}
              {activeTab === 'closure' && 'No changes pending closure. GIICC marks changes as Completed when UAT is done.'}
            </div>
          ) : tabFiltered.map(change => {
            const sc = change.cgmp_status as unknown as number;
            const uatData = parseChangeUATData(change.cgmp_uatusers);
            const projectIds = (change.cgmp_projectids ?? '').split(',').map(s => s.trim()).filter(Boolean);
            const freezeDate = change.cgmp_starttime ? itopsFreezeDate(change.cgmp_starttime) : null;
            const isPastFreeze = freezeDate ? new Date() >= freezeDate : false;
            const isWorking = actionWorking === change.cgmp_changeid;

            return (
              <div key={change.cgmp_changeid} className="itops-uat-change-card">
                {/* Change header */}
                <div className="itops-uat-header">
                  <div>
                    <span className="change-number">{change.cgmp_changenumber}</span>
                    <span style={{ marginLeft: 8, fontWeight: 600, fontSize: 14 }}>{change.cgmp_title}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`badge badge--status ${statusColor(sc)}`}>{statusLabel(sc)}</span>
                    {change.cgmp_starttime && (
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                        Change: {fmtShortDate(change.cgmp_starttime)}
                      </span>
                    )}
                    {freezeDate && !isPastFreeze && (
                      <span className="itops-freeze-warn">
                        IT Ops freeze: {freezeDate.toLocaleDateString(undefined, { timeZone: getDisplayTimezone() })}
                      </span>
                    )}
                    {freezeDate && isPastFreeze && (
                      <span className="itops-frozen-badge">UAT Freeze Passed</span>
                    )}
                    {/* Actions */}
                    {sc === STATUS.UATUpdates && (
                      <button className="btn btn--sm btn--outline" disabled={isWorking}
                        onClick={() => lockUAT(change)}>
                        {isWorking ? 'Locking…' : 'Lock UAT'}
                      </button>
                    )}
                    {sc === STATUS.Locked && (
                      <button className="btn btn--sm btn--primary" disabled={isWorking}
                        onClick={() => handoverToGIICC(change)}>
                        {isWorking ? 'Handing over…' : '🔁 Handover to GIICC'}
                      </button>
                    )}
                    {sc === STATUS.Completed && (
                      <button className="btn btn--sm btn--primary" onClick={() => setClosureConfirm(change)}>
                        Close Change
                      </button>
                    )}
                    {/* Download all GIICC-uploaded files for this change */}
                    <button
                      className="btn btn--sm btn--outline"
                      disabled={downloadingAll === change.cgmp_changeid}
                      onClick={() => downloadAllFiles(change.cgmp_changeid)}
                      title="Download all attached files for this change"
                    >
                      {downloadingAll === change.cgmp_changeid ? 'Downloading…' : (
                        <><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 4 }}><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg>All Files</>
                      )}
                    </button>
                  </div>
                </div>

                {/* Per-project UAT summary */}
                {projectIds.length > 0 && (
                  <div className="itops-uat-projects">
                    {projectIds.map(pid => {
                      const proj = projects.find(p => p.cgmp_projectid === pid);
                      const entry = uatData[pid] ?? defaultUATEntry();
                      const uatStatusColor = ({ Pending: '#999', Success: 'var(--success)', Failed: 'var(--danger)', Rollback: 'var(--orange)', NotApplicable: '#aaa', PartialSuccess: '#f59e0b' } as Record<UATStatus, string>)[entry.postStatus];
                      const isFailed = entry.postStatus === 'Failed' || entry.postStatus === 'Rollback';
                      const remKey = `${change.cgmp_changeid}::${pid}`;
                      const remDraft = itopsRemDrafts[remKey];
                      const currentRemStatus = entry.remediationStatus ?? 'Failed';
                      const isHistOpen = itopsHistOpen.has(remKey);
                      const isRemSaving = itopsRemSaving === remKey;
                      return (
                        <div key={pid} className="itops-uat-proj-row" style={{ flexDirection: 'column', gap: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', flexWrap: 'wrap' }}>
                            <div className="itops-uat-proj-name" style={{ flex: 1 }}>
                              <strong>{proj?.cgmp_name ?? pid}</strong>
                              {proj?.cgmp_pidbnumber && <span className="proj-pidb">{proj.cgmp_pidbnumber}</span>}
                              {proj?.cgmp_primaryism && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 4 }}>{proj.cgmp_primaryism}</span>}
                            </div>
                            <div className="itops-uat-proj-contacts">
                              {entry.contacts.length === 0 ? (
                                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>No UAT contacts assigned</span>
                              ) : (
                                <div className="itops-uat-contacts-list">
                                  {entry.contacts.map((ct, ci) => (
                                    <span key={ci} className="itops-uat-contact-chip" title={[ct.name, ct.email, ct.phone].filter(Boolean).join(' · ')}>
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0 }}>
                                        <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                                      </svg>
                                      <span className="itops-uat-contact-chip__name">{ct.name}</span>
                                      {ct.email && <span className="itops-uat-contact-chip__email">{ct.email}</span>}
                                      {ct.phone && <span className="itops-uat-contact-chip__phone">{ct.phone}</span>}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <span className="itops-uat-status-pill" style={{ background: `${uatStatusColor}22`, color: uatStatusColor }}>{entry.preStatus}</span>
                              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>→</span>
                              <span className="itops-uat-status-pill" style={{ background: `${uatStatusColor}22`, color: uatStatusColor }}>{entry.postStatus}</span>
                              {isFailed && (
                                <span className="rem-status-pill" style={{ background: `${remStatusColor(currentRemStatus)}20`, color: remStatusColor(currentRemStatus), fontSize: 10 }}>
                                  {remStatusLabel(currentRemStatus)}
                                </span>
                              )}
                            </div>
                            {isFailed && (
                              <button
                                className={`btn btn--xs btn--outline ${isHistOpen ? 'btn--active' : ''}`}
                                onClick={() => setItopsHistOpen(prev => { const s = new Set(prev); s.has(remKey) ? s.delete(remKey) : s.add(remKey); return s; })}
                              >Hist ({(entry.remediationHistory ?? []).length})</button>
                            )}
                          </div>

                          {/* Remediation history (read-only timeline) */}
                          {isFailed && isHistOpen && (entry.remediationHistory ?? []).length > 0 && (
                            <div style={{ padding: '8px 12px', background: 'var(--page-bg)', borderRadius: 6, marginBottom: 6, border: '1px solid var(--border-light)' }}>
                              <RemediationHistory history={entry.remediationHistory ?? []} />
                            </div>
                          )}

                          {/* Remediation status update form — cannot set Closed */}
                          {isFailed && currentRemStatus !== 'Closed' && (sc === STATUS.Completed || sc === STATUS.InProgress || sc === STATUS.Locked) && (
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', flexWrap: 'wrap' }}>
                              <select
                                className="giicc-status-sel"
                                style={{ fontSize: 12, padding: '4px 8px', flex: '0 0 180px' }}
                                value={remDraft?.status ?? currentRemStatus}
                                onChange={e => setItopsRemDrafts(prev => ({
                                  ...prev, [remKey]: { status: e.target.value as FailedProjectStatus, remarks: prev[remKey]?.remarks ?? '' }
                                }))}
                              >
                                {ITOPS_REM_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                              </select>
                              <input
                                className="giicc-comment-inp"
                                style={{ fontSize: 12, flex: 1, minWidth: 140 }}
                                placeholder="Remarks…"
                                value={remDraft?.remarks ?? ''}
                                onChange={e => setItopsRemDrafts(prev => ({
                                  ...prev, [remKey]: { status: prev[remKey]?.status ?? currentRemStatus, remarks: e.target.value }
                                }))}
                              />
                              <button
                                className="btn btn--xs btn--primary"
                                disabled={isRemSaving || !remDraft || (remDraft.status === currentRemStatus && !remDraft.remarks)}
                                onClick={() => saveItopsRemediation(change, pid)}
                              >{isRemSaving ? '…' : 'Save'}</button>
                            </div>
                          )}

                          {(sc === STATUS.Completed || sc === STATUS.Closed) && entry.comments && (
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', paddingBottom: 4 }}>
                              {entry.comments}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {projectIds.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '8px 0' }}>No impacted projects linked.</div>
                )}

                {/* Closure remarks (only shown for Completed changes) */}
                {sc === STATUS.Completed && (
                  <div className="itops-closure-remarks">
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Closure Remarks</label>
                    <textarea
                      className="ff-input"
                      rows={2}
                      placeholder="Add closure remarks before officially closing the change…"
                      value={closureRemarks[change.cgmp_changeid] ?? ''}
                      onChange={e => setClosureRemarks(prev => ({ ...prev, [change.cgmp_changeid]: e.target.value }))}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modals — always rendered */}
      <ReviewPanel
        open={!!reviewChange}
        onClose={() => setReviewChange(null)}
        change={reviewChange}
        allChanges={changes}
        allProjects={projects}
        onReviewed={refresh}
      />
      <ImpactAnalysis
        open={impactOpen}
        onClose={() => setImpactOpen(false)}
        selectedChanges={selectedChanges}
        allProjects={projects}
      />
      <ConfirmDialog
        open={bulkConfirmOpen}
        onClose={() => setBulkConfirmOpen(false)}
        onConfirm={doBulkApprove}
        title="Bulk Approve Changes"
        message={`Approve and release ${eligibleBulk.length} change${eligibleBulk.length !== 1 ? 's' : ''} that have passed all validation checks? Changes with errors are excluded.`}
        confirmLabel="Approve All"
        loading={bulkWorking}
      />
      <ConfirmDialog
        open={!!closureConfirm}
        onClose={() => setClosureConfirm(null)}
        onConfirm={doCloseChange}
        title="Close Change Officially"
        message={`Mark "${closureConfirm?.cgmp_changenumber} — ${closureConfirm?.cgmp_title}" as officially Closed? This action finalizes the end-to-end change lifecycle.`}
        confirmLabel="Close Change"
        loading={actionWorking === closureConfirm?.cgmp_changeid}
      />
      {/* Bulk Re-assign IT Ops POC (#28) */}
      <SlidePanel
        open={bulkReassignOpen}
        onClose={() => { setBulkReassignOpen(false); setBulkReassignTarget(''); }}
        title={`Re-assign POC — ${selectedIds.size} Change${selectedIds.size !== 1 ? 's' : ''}`}
        width={360}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn--outline" onClick={() => setBulkReassignOpen(false)}>Cancel</button>
            <button className="btn btn--primary" onClick={doBulkReassign} disabled={bulkReassigning || !bulkReassignTarget}>
              {bulkReassigning ? 'Reassigning…' : 'Reassign'}
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
            Select the new IT Ops POC for the {selectedIds.size} selected change{selectedIds.size !== 1 ? 's' : ''}.
          </p>
          <div className="ff-group">
            <label className="ff-label">New IT Ops POC</label>
            <UserPickerSelect
              users={systemUsers}
              loading={usersLoading}
              value={bulkReassignTarget}
              onChange={setBulkReassignTarget}
            />
          </div>
        </div>
      </SlidePanel>

      {/* Send Back to PMO panel */}
      <SlidePanel
        open={!!revertTarget}
        onClose={() => { setRevertTarget(null); setRevertReason(''); }}
        title={`Send Back to PMO — ${revertTarget?.cgmp_changenumber ?? ''}`}
        width={420}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn--outline" onClick={() => { setRevertTarget(null); setRevertReason(''); }}>Cancel</button>
            <button className="btn btn--primary" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}
              disabled={reverting || !revertReason.trim()} onClick={doRevertToPMO}>
              {reverting ? 'Sending…' : 'Send Back to PMO'}
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '20px' }}>
          <div style={{ background: 'var(--danger-faint)', border: '1px solid var(--border-danger, rgba(209,52,56,0.25))', borderRadius: 6, padding: '10px 14px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            This will revert <strong>{revertTarget?.cgmp_changenumber}</strong> to <strong>Draft</strong> status. The PMO will be able to edit and republish it.
          </div>
          <div className="ff-group" style={{ margin: 0 }}>
            <label className="ff-label" style={{ marginBottom: 6 }}>Rejection Reason <span style={{ color: 'var(--danger)' }}>*</span></label>
            <textarea
              className="ff-input ff-textarea"
              rows={4}
              placeholder="Describe why this change is being sent back to PMO…"
              value={revertReason}
              onChange={e => setRevertReason(e.target.value)}
              autoFocus
              style={{ resize: 'vertical' }}
            />
          </div>
        </div>
      </SlidePanel>

      {/* Reschedule Flow (#25) */}
      <SlidePanel
        open={!!reschedTarget}
        onClose={() => { setReschedTarget(null); setReschedStart(''); setReschedEnd(''); setReschedReason(''); }}
        title={`Propose Reschedule — ${reschedTarget?.cgmp_changenumber ?? ''}`}
        width={460}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn--outline" onClick={() => setReschedTarget(null)}>Cancel</button>
            <button className="btn btn--primary"
              disabled={reschedWorking || !reschedStart || !reschedEnd || !reschedReason.trim()}
              onClick={doReschedule}>
              {reschedWorking ? 'Sending…' : 'Send Proposal to PMO'}
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '20px' }}>
          <div style={{ background: 'rgba(13,110,253,0.07)', border: '1px solid rgba(13,110,253,0.25)', borderRadius: 6, padding: '10px 14px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Propose a new schedule for <strong>{reschedTarget?.cgmp_changenumber}</strong>. A notification will be sent to PMO — the change dates <strong>will not be updated</strong> until PMO approves.
          </div>
          <div className="ff-row" style={{ gap: 12 }}>
            <div className="ff-group" style={{ flex: 1, margin: 0 }}>
              <label htmlFor="reschedule-start" className="ff-label" style={{ marginBottom: 6 }}>Proposed Start Time <span style={{ color: 'var(--danger)' }}>*</span></label>
              <DateTimeInput id="reschedule-start" value={reschedStart} onChange={e => setReschedStart(e.target.value)} aria-label="Proposed start time" />
            </div>
            <div className="ff-group" style={{ flex: 1, margin: 0 }}>
              <label htmlFor="reschedule-end" className="ff-label" style={{ marginBottom: 6 }}>Proposed End Time <span style={{ color: 'var(--danger)' }}>*</span></label>
              <DateTimeInput id="reschedule-end" value={reschedEnd} onChange={e => setReschedEnd(e.target.value)} aria-label="Proposed end time" />
            </div>
          </div>
          <div className="ff-group" style={{ margin: 0 }}>
            <label className="ff-label" style={{ marginBottom: 6 }}>Reason for Reschedule <span style={{ color: 'var(--danger)' }}>*</span></label>
            <textarea className="ff-input ff-textarea" rows={4} value={reschedReason} onChange={e => setReschedReason(e.target.value)} placeholder="Explain why the change needs to be rescheduled…" autoFocus style={{ resize: 'vertical' }} />
          </div>
        </div>
      </SlidePanel>

      {/* F-014: Emergency approval dialog — Admin only */}
      <Dialog
        open={emergApproveOpen}
        onClose={() => { setEmergApproveOpen(false); setEmergApproveChange(null); }}
        title="Approve Emergency Change"
        maxWidth={480}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn--outline" onClick={() => { setEmergApproveOpen(false); setEmergApproveChange(null); }}>Cancel</button>
            <button
              className="btn btn--primary"
              style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}
              onClick={() => emergApproveChange && handleApproveEmergency(emergApproveChange)}
            >
              Approve Emergency Designation
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>
            {emergApproveChange?.cgmp_changenumber} — {emergApproveChange?.cgmp_title}
          </p>
          <div style={{ background: 'var(--danger-faint)', border: '1px solid rgba(209,52,56,0.25)', borderRadius: 6, padding: '10px 14px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Approving this emergency designation will mark the change for expedited 4-hour SLA processing.
            This action will be recorded in the audit log and cannot be undone.
          </div>
        </div>
      </Dialog>

      <SlidePanel
        open={itopsEditOpen}
        onClose={() => setItopsEditOpen(false)}
        title={`Edit Fields — ${itopsEditTarget?.cgmp_changenumber ?? ''}`}
        width={480}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn--outline" onClick={() => setItopsEditOpen(false)}>Cancel</button>
            <button className="btn btn--primary" onClick={saveItopsEdit} disabled={itopsEditSaving}>
              {itopsEditSaving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '20px' }}>
          <div className="ff-row" style={{ gap: 16 }}>
            <div className="ff-group" style={{ flex: 1, margin: 0 }}>
              <label className="ff-label" style={{ marginBottom: 6 }}>Risk Level</label>
              <Select
                options={RISK_OPTS}
                value={itopsEditForm.risklevel}
                onChange={e => setItopsEditForm(f => ({ ...f, risklevel: e.target.value }))}
              />
            </div>
            <div className="ff-group" style={{ flex: 1, margin: 0 }}>
              <label className="ff-label" style={{ marginBottom: 6 }}>Impact Level</label>
              <Select
                options={IMPACT_OPTS}
                value={itopsEditForm.impactlevel}
                onChange={e => setItopsEditForm(f => ({ ...f, impactlevel: e.target.value }))}
              />
            </div>
          </div>
          <div className="ff-group" style={{ margin: 0 }}>
            <label className="ff-label" style={{ marginBottom: 6 }}>Description</label>
            <Textarea
              rows={3}
              value={itopsEditForm.description}
              onChange={e => setItopsEditForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="ff-group" style={{ margin: 0 }}>
            <label className="ff-label" style={{ marginBottom: 6 }}>Impacted Projects</label>
            <ProjectMultiSelect
              projects={projects}
              value={itopsEditForm.projectids}
              onChange={v => setItopsEditForm(f => ({ ...f, projectids: v }))}
            />
          </div>
        </div>
      </SlidePanel>
    </div>
  );
}
