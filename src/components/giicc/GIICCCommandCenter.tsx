import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  useAllBridges, useChangeList, useProjects,
  BRIDGE_STATUS, bridgeStatusLabel, useCountdown,
  STATUS, statusLabel, statusColor, riskLabel, riskColor,
  useAllUserProfiles, ROLES,
} from '../../hooks/useDataverse';
import type { Cgmp_bridges } from '../../generated/models/Cgmp_bridgesModel';
import type { Cgmp_bridgescgmp_status } from '../../generated/models/Cgmp_bridgesModel';
import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';
import type { Cgmp_changescgmp_status } from '../../generated/models/Cgmp_changesModel';
import type { Cgmp_projects } from '../../generated/models/Cgmp_projectsModel';
import { Cgmp_bridgesService, Cgmp_changesService, Cgmp_auditlogsService, Cgmp_notificationsService } from '../../generated';
import type { Cgmp_auditlogsBase } from '../../generated/models/Cgmp_auditlogsModel';
import type { Cgmp_notificationsBase } from '../../generated/models/Cgmp_notificationsModel';
import type { Cgmp_userprofiles } from '../../generated/models/Cgmp_userprofilesModel';
import type { Cgmp_notificationsstatecode } from '../../generated/models/Cgmp_notificationsModel';
import { getBrowserInfo, fmtShortDate as fmtDate, fmtDateTime, fmtDateTimeShort, isToday, getDisplayTimezone, isValidTeamsUrl } from '../../utils/format';
import { asAuditEntityType, asAuditEventType, asNotifCategory, asNotifPriority } from '../../utils/optionSets';
import { exportCSV } from '../../utils/csv';
import { useApp } from '../../context/AppContext';
import AttachmentPanel from '../ui/AttachmentPanel';
import BridgeForm from './BridgeForm';
import BridgeExecution from './BridgeExecution';
import PIRForm from './PIRForm';
import ConfirmDialog from '../ui/ConfirmDialog';

/* ── UAT types ──────────────────────────────────────────────────── */

export type UATStatus = 'Pending' | 'Success' | 'Failed' | 'Rollback' | 'NotApplicable' | 'PartialSuccess';

export type FailedProjectStatus =
  'Failed' | 'UnderInvestigation' | 'InProgress' | 'P1Initiated' |
  'VendorEngaged' | 'RollbackInitiated' | 'RollbackCompleted' |
  'WaitingForUserConfirmation' | 'Resolved' | 'Closed';

export interface RemediationHistoryEntry {
  status: FailedProjectStatus;
  previousStatus: FailedProjectStatus | '';
  updatedBy: string;
  timestamp: string;
  remarks: string;
}

export interface RCAEntry {
  category: string;
  description: string;
  preventiveAction: string;
  owner: string;
  savedBy: string;
  savedAt: string;
}

export interface ProjectUATEntry {
  contacts: Array<{ name: string; email: string; phone?: string }>;
  preStatus: UATStatus;
  postStatus: UATStatus;
  comments: string;
  failureReason: string;
  rollback: boolean;
  updatedBy: string;
  updatedAt: string;
  remediationStatus?: FailedProjectStatus;
  remediationHistory?: RemediationHistoryEntry[];
  rca?: RCAEntry;
}
export type ChangeUATData = Record<string, ProjectUATEntry>;

const UAT_STATUS_OPTS: { value: UATStatus; label: string }[] = [
  { value: 'Pending',        label: 'Pending' },
  { value: 'Success',        label: 'Success' },
  { value: 'Failed',         label: 'Failed' },
  { value: 'Rollback',       label: 'Rollback' },
  { value: 'NotApplicable',  label: 'Not Applicable' },
  { value: 'PartialSuccess', label: 'Partial Success' },
];

export function parseChangeUATData(json: string | undefined): ChangeUATData {
  if (!json?.trim()) return {};
  try { return JSON.parse(json) as ChangeUATData; } catch { return {}; }
}
export function defaultUATEntry(): ProjectUATEntry {
  return { contacts: [], preStatus: 'Pending', postStatus: 'Pending', comments: '', failureReason: '', rollback: false, updatedBy: '', updatedAt: '', remediationStatus: undefined, remediationHistory: [] };
}

export const FAILED_PROJECT_STATUS_CONFIG: { value: FailedProjectStatus; label: string; color: string }[] = [
  { value: 'Failed',                    label: 'Failed',                          color: 'var(--chart-3)'  },
  { value: 'UnderInvestigation',        label: 'Under Investigation',             color: 'var(--warning)'  },
  { value: 'InProgress',                label: 'In Progress',                     color: 'var(--chart-1)'  },
  { value: 'P1Initiated',               label: 'P1 Initiated',                    color: 'var(--chart-4)'  },
  { value: 'VendorEngaged',             label: 'Vendor Engaged',                  color: 'var(--chart-6)'  },
  { value: 'RollbackInitiated',         label: 'Rollback Initiated',              color: 'var(--chart-5)'  },
  { value: 'RollbackCompleted',         label: 'Rollback Completed',              color: 'var(--success)'  },
  { value: 'WaitingForUserConfirmation',label: 'Waiting for User Confirmation',   color: 'var(--chart-7)'  },
  { value: 'Resolved',                  label: 'Resolved',                        color: 'var(--chart-9)'  },
  { value: 'Closed',                    label: 'Closed',                          color: 'var(--chart-10)' },
];

export const ITOPS_REM_STATUSES = FAILED_PROJECT_STATUS_CONFIG.filter(s => s.value !== 'Closed');

export function remStatusLabel(s: FailedProjectStatus | undefined): string {
  return FAILED_PROJECT_STATUS_CONFIG.find(c => c.value === s)?.label ?? s ?? '—';
}
export function remStatusColor(s: FailedProjectStatus | undefined): string {
  return FAILED_PROJECT_STATUS_CONFIG.find(c => c.value === s)?.color ?? '#999';
}

/* ── Contacts tooltip (portal-based to escape overflow:hidden parents) ── */
function ContactsTooltip({ contacts }: { contacts: Array<{ name: string; email: string; phone?: string }> }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const chipRef = useRef<HTMLSpanElement>(null);

  const openTooltip = () => {
    if (chipRef.current) {
      const r = chipRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener('click', close, true);
    document.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('click', close, true); document.removeEventListener('scroll', close, true); };
  }, [open]);

  if (contacts.length === 0) return <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>—</span>;

  return (
    <>
      <span
        ref={chipRef}
        className="uat-contacts-chip"
        onClick={e => { e.stopPropagation(); open ? setOpen(false) : openTooltip(); }}
        onMouseEnter={openTooltip}
        onMouseLeave={() => setOpen(false)}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" /></svg>
        {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
      </span>
      {open && createPortal(
        <div
          className="uat-contacts-tooltip"
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          {contacts.length === 0
            ? <div className="uat-contacts-tooltip__empty">No contacts added</div>
            : contacts.map((c, i) => (
              <div key={i} className="uat-contacts-tooltip__item">
                <span className="uat-contacts-tooltip__name">{c.name || '—'}</span>
                {c.email && <span className="uat-contacts-tooltip__email">{c.email}</span>}
                {c.phone && <span className="uat-contacts-tooltip__phone">{c.phone}</span>}
              </div>
            ))
          }
        </div>,
        document.body
      )}
    </>
  );
}

/* ── Remediation History Timeline ───────────────────────────────── */
export function RemediationHistory({ history }: { history: RemediationHistoryEntry[] }) {
  if (!history || history.length === 0) return <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>No history yet</span>;
  return (
    <div className="rem-history">
      {[...history].reverse().map((h, i) => (
        <div key={i} className="rem-history__entry">
          <div className="rem-history__dot" style={{ background: remStatusColor(h.status) }} />
          <div className="rem-history__body">
            <div className="rem-history__row">
              <span className="rem-status-pill" style={{ background: `${remStatusColor(h.status)}20`, color: remStatusColor(h.status) }}>{remStatusLabel(h.status)}</span>
              {h.previousStatus && <span className="rem-history__from">from {remStatusLabel(h.previousStatus as FailedProjectStatus)}</span>}
            </div>
            <div className="rem-history__meta">
              <span>{h.updatedBy || 'System'}</span>
              <span>·</span>
              <span>{fmtDateTime(h.timestamp)}</span>
            </div>
            {h.remarks && <div className="rem-history__remarks">{h.remarks}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function uatStatusClass(s: UATStatus): string {
  const m: Record<UATStatus, string> = {
    Pending: 'uat-s--pending', Success: 'uat-s--success', Failed: 'uat-s--failed',
    Rollback: 'uat-s--rollback', NotApplicable: 'uat-s--na', PartialSuccess: 'uat-s--partial',
  };
  return m[s] ?? '';
}

/* ── Bridges helpers ────────────────────────────────────────────── */

const TEMPLATE_LABEL: Record<number, string> = {
  100000000: 'Network', 100000001: 'Citrix', 100000002: 'VMware',
  100000003: 'Firewall', 100000004: 'Patch Activities', 100000005: 'Custom',
};
function fmtTime(iso: string | undefined): string {
  return fmtDateTimeShort(iso);
}
function bridgeStatusClass(code: number): string {
  return ({ 100000000: 'bridge--active', 100000001: 'bridge--completed', 100000002: 'bridge--failed', 100000003: 'bridge--cancelled', 100000004: 'bridge--scheduled' } as Record<number, string>)[code] ?? '';
}
function bridgeBadgeClass(code: number): string {
  return ({ 100000000: 'status-inprogress', 100000001: 'status-completed', 100000002: 'status-failed', 100000003: 'status-cancelled', 100000004: 'status-published' } as Record<number, string>)[code] ?? 'status-draft';
}

function BridgeCountdown({ schedstart }: { schedstart: string }) {
  const remaining = useCountdown(schedstart);
  return <span className="bridge-countdown">{remaining}</span>;
}

function BridgeCard({ bridge, onExecution, onPIR, onEdit, onStart }: {
  bridge: Cgmp_bridges; onExecution(b: Cgmp_bridges): void;
  onPIR(b: Cgmp_bridges): void; onEdit(b: Cgmp_bridges): void; onStart(b: Cgmp_bridges): void;
}) {
  const status = bridge.cgmp_status as unknown as number;
  const template = bridge.cgmp_template as unknown as number;
  const isActive = status === BRIDGE_STATUS.InProgress;
  const isScheduled = status === BRIDGE_STATUS.Scheduled;
  return (
    <div className={`bridge-card ${bridgeStatusClass(status)}`}>
      <div className="bridge-card__header">
        <div className="bridge-card__title-row">
          <span className="bridge-card__title">{bridge.cgmp_title}</span>
          <span className={`badge badge--status ${bridgeBadgeClass(status)}`}>{bridgeStatusLabel(status)}</span>
        </div>
        {bridge.cgmp_changenumber && <span className="bridge-card__change-ref">Change: {bridge.cgmp_changenumber}</span>}
      </div>
      <div className="bridge-card__meta">
        <span className="bridge-meta-item">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z" /></svg>
          {fmtTime(bridge.cgmp_schedstart)} → {fmtTime(bridge.cgmp_schedend)}
        </span>
        <span className="bridge-meta-chip">{TEMPLATE_LABEL[template] ?? 'Custom'}</span>
        {isScheduled && <BridgeCountdown schedstart={bridge.cgmp_schedstart} />}
        {isActive && bridge.cgmp_actualstart && (
          <span className="bridge-live-badge"><span className="bridge-live-dot" />Live since {fmtTime(bridge.cgmp_actualstart)}</span>
        )}
        {isValidTeamsUrl(bridge.cgmp_teamsurl) ? (
          <a href={bridge.cgmp_teamsurl} target="_blank" rel="noopener noreferrer" className="bridge-teams-link" onClick={e => e.stopPropagation()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-7 3.5c1.38 0 2.5 1.12 2.5 2.5S14.38 12.5 13 12.5 10.5 11.38 10.5 10 11.62 7.5 13 7.5zM8 16c0-2.33 3.34-3.5 5-3.5s5 1.17 5 3.5H8z" /></svg>
            Join Teams
          </a>
        ) : bridge.cgmp_teamsurl ? (
          <span title="Invalid Teams URL" className="bridge-teams-link bridge-teams-link--invalid">{bridge.cgmp_teamsurl}</span>
        ) : null}
      </div>
      {bridge.cgmp_rollbackinitiated && (
        <div className="bridge-rollback-banner">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" /></svg>
          Rollback initiated
        </div>
      )}
      <div className="bridge-card__actions">
        <button className="btn btn--xs btn--outline" onClick={() => onEdit(bridge)}>Edit</button>
        {isScheduled && <button className="btn btn--xs btn--primary" onClick={() => onStart(bridge)}>Start Bridge</button>}
        {(isActive || isScheduled) && <button className="btn btn--xs btn--secondary" onClick={() => onExecution(bridge)}>Execution</button>}
        {isActive && <button className="btn btn--xs btn--primary" onClick={() => onPIR(bridge)}>PIR</button>}
        {(status === BRIDGE_STATUS.Completed || status === BRIDGE_STATUS.Failed) && (
          <button className="btn btn--xs btn--outline" onClick={() => onPIR(bridge)}>View PIR</button>
        )}
      </div>
    </div>
  );
}

function ColHeader({ title, count, accent }: { title: string; count: number; accent?: string }) {
  return (
    <div className="giicc-col-header" style={{ borderTopColor: accent }}>
      <span className="giicc-col-title">{title}</span>
      <span className="giicc-col-count" style={{ background: accent }}>{count}</span>
    </div>
  );
}

/* ── Export CSV ─────────────────────────────────────────────────── */

function exportUATReport(changes: Cgmp_changes[], projects: Cgmp_projects[]) {
  const headers = [
    'Change #', 'Title', 'Start Date', 'Project', 'PIDB', 'Primary ISM',
    'Contact Count', 'Contact 1 Name', 'Contact 1 Email', 'Contact 1 Phone',
    'Contact 2 Name', 'Contact 2 Email', 'Contact 2 Phone',
    'Pre-UAT', 'Post-UAT', 'Comments', 'Failure Reason', 'Rollback', 'Remediation Status',
  ];
  const rows: string[][] = [];
  changes.forEach(c => {
    const uatData = parseChangeUATData(c.cgmp_uatusers);
    const ids = (c.cgmp_projectids ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      rows.push([c.cgmp_changenumber ?? '', c.cgmp_title ?? '', fmtDate(c.cgmp_starttime), ...Array(16).fill('')]);
      return;
    }
    ids.forEach(pid => {
      const p = projects.find(pr => pr.cgmp_projectid === pid);
      const e = uatData[pid] ?? defaultUATEntry();
      const c1 = e.contacts[0]; const c2 = e.contacts[1];
      rows.push([
        c.cgmp_changenumber ?? '', c.cgmp_title ?? '', fmtDate(c.cgmp_starttime),
        p?.cgmp_name ?? pid, p?.cgmp_pidbnumber ?? '', p?.cgmp_primaryism ?? '',
        String(e.contacts.length),
        c1?.name ?? '', c1?.email ?? '', c1?.phone ?? '',
        c2?.name ?? '', c2?.email ?? '', c2?.phone ?? '',
        e.preStatus, e.postStatus, e.comments, e.failureReason, e.rollback ? 'Yes' : 'No',
        remStatusLabel(e.remediationStatus),
      ]);
    });
  });
  exportCSV(`giicc-uat-${new Date().toISOString().slice(0, 10)}`, headers, rows);
}

/* ── Scheduled Changes pane ─────────────────────────────────────── */

function ScheduledChangesPaneInner({
  changes, projects, refresh, currentUserName, currentUserUpn, showToast, allProfiles,
}: {
  changes: Cgmp_changes[]; projects: Cgmp_projects[]; allProfiles: Cgmp_userprofiles[];
  refresh(): void; currentUserName: string; currentUserUpn: string; showToast(type: string, msg: string): void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, ChangeUATData>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [confirmComplete, setConfirmComplete] = useState<Cgmp_changes | null>(null);
  const [completing, setCompleting] = useState(false);
  const [checkedChanges, setCheckedChanges] = useState<Set<string>>(new Set());
  const [bulkCompleting, setBulkCompleting] = useState(false);
  const toggleChecked = (id: string) => setCheckedChanges(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const [selectedRows, setSelectedRows] = useState<Record<string, Set<string>>>({}); // changeId → Set<projectId>
  /* Per-change bulk bar state — prevents shared state across simultaneously expanded changes */
  type BulkState = { field: 'preStatus' | 'postStatus'; status: UATStatus };
  const [bulkStates, setBulkStates] = useState<Record<string, BulkState>>({});
  const getBulkState = (changeId: string): BulkState => bulkStates[changeId] ?? { field: 'postStatus', status: 'Success' };
  const setBulkField = (changeId: string, field: 'preStatus' | 'postStatus') =>
    setBulkStates(prev => ({ ...prev, [changeId]: { ...getBulkState(changeId), field } }));
  const setBulkStatus = (changeId: string, status: UATStatus) =>
    setBulkStates(prev => ({ ...prev, [changeId]: { ...getBulkState(changeId), status } }));
  /* changeId-projectId keys for open attachment panels */
  const [attachOpen, setAttachOpen] = useState<Set<string>>(new Set());
  const toggleAttach = (changeId: string, projectId: string) => {
    const key = `${changeId}::${projectId}`;
    setAttachOpen(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });
  };

  const toggle = (id: string) => setExpanded(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
  });

  const getEntry = (changeId: string, projectId: string, originalJson: string | undefined): ProjectUATEntry => {
    const draft = drafts[changeId];
    if (draft?.[projectId]) return draft[projectId];
    return parseChangeUATData(originalJson)[projectId] ?? defaultUATEntry();
  };

  const patchEntry = (changeId: string, projectId: string, patch: Partial<ProjectUATEntry>, originalJson: string | undefined) => {
    const original = parseChangeUATData(originalJson);
    setDrafts(prev => ({
      ...prev,
      [changeId]: {
        ...(prev[changeId] ?? original),
        [projectId]: { ...(prev[changeId]?.[projectId] ?? original[projectId] ?? defaultUATEntry()), ...patch },
      },
    }));
  };

  const hasDraft = (changeId: string, originalJson: string | undefined) => {
    if (!drafts[changeId]) return false;
    return JSON.stringify(drafts[changeId]) !== JSON.stringify(parseChangeUATData(originalJson));
  };

  const saveDraft = async (change: Cgmp_changes) => {
    const changeId = change.cgmp_changeid;
    const original = parseChangeUATData(change.cgmp_uatusers);
    const merged = { ...original, ...(drafts[changeId] ?? {}) };
    setSaving(changeId);
    try {
      const r = await Cgmp_changesService.update(changeId, { cgmp_uatusers: JSON.stringify(merged) });
      if (!r.success) throw r.error ?? new Error('Save failed');
      setDrafts(prev => { const n = { ...prev }; delete n[changeId]; return n; });
      showToast('success', 'UAT data saved');
      refresh();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save');
    } finally { setSaving(null); }
  };

  const doComplete = async () => {
    if (!confirmComplete) return;
    const change = confirmComplete;
    setCompleting(true);
    try {
      const now = new Date().toISOString();
      const original = parseChangeUATData(change.cgmp_uatusers);
      const merged = { ...original, ...(drafts[change.cgmp_changeid] ?? {}) };
      await Cgmp_changesService.update(change.cgmp_changeid, {
        cgmp_status: STATUS.Completed as unknown as Cgmp_changescgmp_status,
        cgmp_actualendtime: now,
        cgmp_uatusers: JSON.stringify(merged),
      });
      Cgmp_auditlogsService.create({
        cgmp_auditlogname: `${change.cgmp_changenumber} UAT Completed`,
        cgmp_entitytype: asAuditEntityType(100000000),
        cgmp_eventtype: asAuditEventType(100000007),
        cgmp_entityid: change.cgmp_changeid,
        cgmp_entityname: change.cgmp_changenumber,
        cgmp_username: currentUserName,
        cgmp_useremail: currentUserUpn,
        cgmp_ipaddress: getBrowserInfo(),
        cgmp_previousvalues: JSON.stringify({ status: 'InProgress' }),
        cgmp_newvalues: JSON.stringify({ status: 'Completed', by: currentUserUpn }),
      } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch(err => { if (import.meta.env.DEV) console.error('Audit log failed:', err); });
      setDrafts(prev => { const n = { ...prev }; delete n[change.cgmp_changeid]; return n; });
      // Notify IT Ops POC(s) assigned to this change's location
      const changeLoc = (change as any).cgmp_location as string | undefined;
      const itOpsPocs = allProfiles.filter(p =>
        Number(p.cgmp_role as unknown as number) === ROLES.ITOps &&
        (!changeLoc || (p.cgmp_assignedlocations ?? '').split(',').map(s => s.trim()).some(l => l === changeLoc))
      );
      itOpsPocs.forEach(poc => {
        Cgmp_notificationsService.create({
          cgmp_title: `Change Completed: ${change.cgmp_changenumber}`,
          cgmp_message: `Change ${change.cgmp_changenumber} — "${change.cgmp_title}" has been marked as Completed by GIICC.`,
          cgmp_category: asNotifCategory(100000000),
          cgmp_priority: asNotifPriority(100000002),
          cgmp_recipientid: poc.cgmp_userprofileid,
          cgmp_actionurl: `#pmo?change=${change.cgmp_changenumber ?? ''}`,
          statecode: 0 as unknown as Cgmp_notificationsstatecode,
        } as unknown as Omit<Cgmp_notificationsBase, 'cgmp_notificationid'>).catch(err => { if (import.meta.env.DEV) console.error('Background operation failed:', err); });
      });
      showToast('success', `${change.cgmp_changenumber} marked complete`);
      refresh();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to complete');
    } finally { setCompleting(false); setConfirmComplete(null); }
  };

  const doBulkComplete = async () => {
    const toComplete = inProgressChanges.filter(c => checkedChanges.has(c.cgmp_changeid));
    if (toComplete.length === 0) return;
    setBulkCompleting(true);
    const now = new Date().toISOString();
    let succeeded = 0;
    for (const change of toComplete) {
      try {
        const original = parseChangeUATData(change.cgmp_uatusers);
        const merged = { ...original, ...(drafts[change.cgmp_changeid] ?? {}) };
        await Cgmp_changesService.update(change.cgmp_changeid, {
          cgmp_status: STATUS.Completed as unknown as Cgmp_changescgmp_status,
          cgmp_actualendtime: now,
          cgmp_uatusers: JSON.stringify(merged),
        });
        Cgmp_auditlogsService.create({
          cgmp_auditlogname: `${change.cgmp_changenumber} UAT Completed (bulk)`,
          cgmp_entitytype: asAuditEntityType(100000000),
          cgmp_eventtype: asAuditEventType(100000007),
          cgmp_entityid: change.cgmp_changeid, cgmp_entityname: change.cgmp_changenumber,
          cgmp_username: currentUserName,
          cgmp_useremail: currentUserUpn,
          cgmp_ipaddress: getBrowserInfo(),
          cgmp_previousvalues: JSON.stringify({ status: 'InProgress' }),
          cgmp_newvalues: JSON.stringify({ status: 'Completed', by: currentUserUpn, bulk: true }),
        } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch(err => { if (import.meta.env.DEV) console.error('Audit log failed:', err); });
        setDrafts(prev => { const n = { ...prev }; delete n[change.cgmp_changeid]; return n; });
        succeeded++;
      } catch (err) {
        if (import.meta.env.DEV) console.error(`Bulk complete failed for ${change.cgmp_changenumber}:`, err);
      }
    }
    setBulkCompleting(false);
    setCheckedChanges(new Set());
    if (succeeded < toComplete.length) {
      showToast('warning', `${succeeded}/${toComplete.length} changes marked as Completed — ${toComplete.length - succeeded} failed. Check the console for details.`);
    } else {
      showToast('success', `${succeeded}/${toComplete.length} changes marked as Completed`);
    }
    refresh();
  };

  const applyBulkUpdate = (changeId: string, originalJson: string | undefined) => {
    const sel = selectedRows[changeId];
    if (!sel?.size) { showToast('warning', 'No projects selected'); return; }
    const { field: bulkField, status: bulkStatus } = getBulkState(changeId);
    sel.forEach(pid => patchEntry(changeId, pid, { [bulkField]: bulkStatus } as Partial<ProjectUATEntry>, originalJson));
    showToast('success', `Applied ${bulkStatus} to ${sel.size} project(s)`);
  };

  const inProgressChanges = useMemo(() =>
    changes.filter(c => (c.cgmp_status as unknown as number) === STATUS.InProgress),
    [changes]);

  const totalProjects = useMemo(() =>
    inProgressChanges.reduce((acc, c) => acc + ((c.cgmp_projectids ?? '').split(',').filter(Boolean).length), 0),
    [inProgressChanges]);

  const totalDone = useMemo(() => {
    let n = 0;
    inProgressChanges.forEach(c => {
      const d = parseChangeUATData(c.cgmp_uatusers);
      (c.cgmp_projectids ?? '').split(',').map(s => s.trim()).filter(Boolean).forEach(pid => {
        const e = drafts[c.cgmp_changeid]?.[pid] ?? d[pid];
        if (e?.postStatus && e.postStatus !== 'Pending') n++;
      });
    });
    return n;
  }, [inProgressChanges, drafts]);

  if (inProgressChanges.length === 0) {
    return (
      <div className="giicc-empty-pane">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.2 }}>
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
        </svg>
        <p>No changes handed over to GIICC yet.</p>
        <span>Changes move here when IT Ops clicks <strong>Handover to GIICC</strong>.</span>
      </div>
    );
  }

  return (
    <div>
      {/* Stats + toolbar */}
      <div className="giicc-sc-toolbar">
        <div className="giicc-sc-stats">
          <span className="giicc-sc-stat"><strong>{inProgressChanges.length}</strong> changes in progress</span>
          <span className="giicc-sc-stat"><strong>{totalProjects}</strong> projects tracked</span>
          <span className="giicc-sc-stat" style={{ color: totalDone === totalProjects && totalProjects > 0 ? 'var(--success)' : 'inherit' }}>
            <strong>{totalDone}</strong> / {totalProjects} completed
          </span>
        </div>
        <button className="btn btn--outline btn--sm" onClick={() => exportUATReport(inProgressChanges, projects)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg>
          Export CSV
        </button>
      </div>

      {/* Bulk complete bar */}
      {checkedChanges.size > 0 && (
        <div className="giicc-bulk-complete-bar">
          <span>{checkedChanges.size} change{checkedChanges.size > 1 ? 's' : ''} selected</span>
          <button className="btn btn--primary btn--sm" onClick={doBulkComplete} disabled={bulkCompleting}>
            {bulkCompleting ? 'Completing…' : `Mark ${checkedChanges.size} Complete`}
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => setCheckedChanges(new Set())}>Clear</button>
        </div>
      )}

      {/* Accordion per change */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {inProgressChanges.map(change => {
          const isOpen = expanded.has(change.cgmp_changeid);
          const sc = change.cgmp_status as unknown as number;
          const rc = change.cgmp_risklevel as unknown as number;
          const projectIds = (change.cgmp_projectids ?? '').split(',').map(s => s.trim()).filter(Boolean);
          const impProjects = projectIds.map(pid => projects.find(p => p.cgmp_projectid === pid)).filter((p): p is Cgmp_projects => !!p);
          const dirty = hasDraft(change.cgmp_changeid, change.cgmp_uatusers);
          const sel = selectedRows[change.cgmp_changeid] ?? new Set<string>();

          const allDone = impProjects.length > 0 && impProjects.every(p => {
            const e = getEntry(change.cgmp_changeid, p.cgmp_projectid, change.cgmp_uatusers);
            return e.postStatus !== 'Pending';
          });

          return (
            <div key={change.cgmp_changeid} className="giicc-change-block">
              {/* Header */}
              <div
                className={`giicc-change-header ${isOpen ? 'giicc-change-header--open' : ''}`}
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                onClick={() => toggle(change.cgmp_changeid)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(change.cgmp_changeid); } }}
              >
                <svg className={`giicc-chevron ${isOpen ? 'giicc-chevron--open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
                </svg>
                <div className="giicc-change-info">
                  <div className="giicc-change-top">
                    <span className="change-number">{change.cgmp_changenumber}</span>
                    <span className="giicc-change-title">{change.cgmp_title}</span>
                  </div>
                  <div className="giicc-change-bottom">
                    <span className={`badge badge--status ${statusColor(sc)}`}>{statusLabel(sc)}</span>
                    <span className={`badge badge--risk ${riskColor(rc)}`}>{riskLabel(rc)}</span>
                    {!!(change as any).cgmp_uatrequired && <span className="badge badge--info">UAT Required</span>}
                    {change.cgmp_starttime && (
                      <span className="giicc-change-dates">{fmtDate(change.cgmp_starttime)} → {fmtDate(change.cgmp_endtime)}</span>
                    )}
                    <span className="giicc-proj-count-chip">{impProjects.length} project{impProjects.length !== 1 ? 's' : ''}</span>
                    {allDone && <span className="giicc-all-done-chip">All UAT Done</span>}
                  </div>
                </div>
                <div className="giicc-change-actions" onClick={e => e.stopPropagation()}>
                  {allDone && (
                    <label className="giicc-bulk-check" title="Select for bulk complete">
                      <input
                        type="checkbox"
                        checked={checkedChanges.has(change.cgmp_changeid)}
                        onChange={() => toggleChecked(change.cgmp_changeid)}
                      />
                    </label>
                  )}
                  {dirty && (
                    <button className="btn btn--xs btn--outline"
                      disabled={saving === change.cgmp_changeid}
                      onClick={() => saveDraft(change)}>
                      {saving === change.cgmp_changeid ? 'Saving…' : 'Save'}
                    </button>
                  )}
                  {allDone && (
                    <button className="btn btn--xs btn--primary" onClick={() => setConfirmComplete(change)}>
                      Mark Complete
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded: per-project UAT tracking */}
              {isOpen && (
                <div className="giicc-change-projects">
                  {/* Bulk update toolbar — per-change state to prevent shared state across expanded rows */}
                  {impProjects.length > 1 && (() => {
                    const bs = getBulkState(change.cgmp_changeid);
                    return (
                    <div className="giicc-bulk-bar">
                      <span className="giicc-bulk-label">Bulk update:</span>
                      <select className="giicc-sel" value={bs.field} onChange={e => setBulkField(change.cgmp_changeid, e.target.value as 'preStatus' | 'postStatus')}>
                        <option value="preStatus">Pre-Change UAT</option>
                        <option value="postStatus">Post-Change UAT</option>
                      </select>
                      <select className="giicc-sel" value={bs.status} onChange={e => setBulkStatus(change.cgmp_changeid, e.target.value as UATStatus)}>
                        {UAT_STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <button className="btn btn--xs btn--secondary"
                        onClick={() => applyBulkUpdate(change.cgmp_changeid, change.cgmp_uatusers)}>
                        Apply to Selected ({sel.size})
                      </button>
                      <button className="btn btn--xs btn--outline" onClick={() => {
                        const all = new Set(impProjects.map(p => p.cgmp_projectid));
                        setSelectedRows(prev => ({ ...prev, [change.cgmp_changeid]: all }));
                      }}>Select All</button>
                      {sel.size > 0 && (
                        <button className="btn btn--xs btn--outline" onClick={() =>
                          setSelectedRows(prev => ({ ...prev, [change.cgmp_changeid]: new Set() }))}>
                          Clear
                        </button>
                      )}
                    </div>
                  );
                  })()}

                  {/* Column headers */}
                  <div className="giicc-proj-header-row">
                    <div className="giicc-proj-col giicc-proj-col--check" />
                    <div className="giicc-proj-col giicc-proj-col--name">Project</div>
                    <div className="giicc-proj-col giicc-proj-col--contacts">Contacts</div>
                    <div className="giicc-proj-col giicc-proj-col--status">Pre-UAT</div>
                    <div className="giicc-proj-col giicc-proj-col--status">Post-UAT</div>
                    <div className="giicc-proj-col giicc-proj-col--comments">Comments</div>
                    <div className="giicc-proj-col giicc-proj-col--files">Files</div>
                  </div>

                  {impProjects.map(project => {
                    const entry = getEntry(change.cgmp_changeid, project.cgmp_projectid, change.cgmp_uatusers);
                    const isSelected = sel.has(project.cgmp_projectid);
                    const needsReason = entry.postStatus === 'Failed' || entry.postStatus === 'Rollback';
                    const attachKey = `${change.cgmp_changeid}::${project.cgmp_projectid}`;
                    const attachPfx = `giicc-${change.cgmp_changeid}-${project.cgmp_projectid}:`;
                    const isAttachOpen = attachOpen.has(attachKey);

                    return (
                      <div key={project.cgmp_projectid}>
                      <div
                        className={`giicc-proj-row ${isSelected ? 'giicc-proj-row--selected' : ''}`}>
                        {/* Checkbox */}
                        <div className="giicc-proj-col giicc-proj-col--check">
                          <input type="checkbox" checked={isSelected}
                            onChange={e => {
                              const ns = new Set(sel);
                              e.target.checked ? ns.add(project.cgmp_projectid) : ns.delete(project.cgmp_projectid);
                              setSelectedRows(prev => ({ ...prev, [change.cgmp_changeid]: ns }));
                            }} />
                        </div>

                        {/* Project info */}
                        <div className="giicc-proj-col giicc-proj-col--name">
                          <span className="giicc-proj-name">{project.cgmp_name}</span>
                          <div className="giicc-proj-meta">
                            {project.cgmp_pidbnumber && <span className="proj-pidb">{project.cgmp_pidbnumber}</span>}
                            {project.cgmp_primaryism && <span className="proj-meta-chip">{project.cgmp_primaryism}</span>}
                            {project.cgmp_customer && <span className="proj-meta-chip">{project.cgmp_customer}</span>}
                          </div>
                          {needsReason && (
                            <input className="giicc-reason-inp"
                              value={entry.failureReason}
                              placeholder="Failure / rollback reason…"
                              onChange={e => patchEntry(change.cgmp_changeid, project.cgmp_projectid, { failureReason: e.target.value }, change.cgmp_uatusers)}
                            />
                          )}
                        </div>

                        {/* Contacts */}
                        <div className="giicc-proj-col giicc-proj-col--contacts">
                          <ContactsTooltip contacts={entry.contacts} />
                        </div>

                        {/* Pre-UAT */}
                        <div className="giicc-proj-col giicc-proj-col--status">
                          <select
                            className={`ff-input giicc-status-sel ${uatStatusClass(entry.preStatus)}`}
                            value={entry.preStatus}
                            onChange={e => patchEntry(change.cgmp_changeid, project.cgmp_projectid, { preStatus: e.target.value as UATStatus }, change.cgmp_uatusers)}
                          >
                            {UAT_STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>

                        {/* Post-UAT */}
                        <div className="giicc-proj-col giicc-proj-col--status">
                          <select
                            className={`ff-input giicc-status-sel ${uatStatusClass(entry.postStatus)}`}
                            value={entry.postStatus}
                            onChange={e => patchEntry(change.cgmp_changeid, project.cgmp_projectid, { postStatus: e.target.value as UATStatus }, change.cgmp_uatusers)}
                          >
                            {UAT_STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>

                        {/* Comments */}
                        <div className="giicc-proj-col giicc-proj-col--comments">
                          <input className="ff-input giicc-comment-inp"
                            value={entry.comments}
                            placeholder="Observations…"
                            onChange={e => patchEntry(change.cgmp_changeid, project.cgmp_projectid, { comments: e.target.value }, change.cgmp_uatusers)}
                          />
                        </div>

                        {/* Files toggle */}
                        <div className="giicc-proj-col giicc-proj-col--files">
                          <button
                            className={`attach-toggle-btn ${isAttachOpen ? 'attach-toggle-btn--open' : ''}`}
                            title={isAttachOpen ? 'Hide files' : 'Attach / view files'}
                            onClick={() => toggleAttach(change.cgmp_changeid, project.cgmp_projectid)}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V6H9v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S6 2.79 6 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/>
                            </svg>
                          </button>
                        </div>
                      </div>

                      {/* Inline attachment panel */}
                      {isAttachOpen && (
                        <div style={{ padding: '0 16px 12px 44px', background: 'var(--page-bg)', borderBottom: '1px solid var(--border-light)' }}>
                          <AttachmentPanel
                            objectId={change.cgmp_changeid}
                            subjectPrefix={attachPfx}
                            compact
                          />
                        </div>
                      )}
                      </div>
                    );
                  })}

                  {/* Save row */}
                  {dirty && (
                    <div className="giicc-save-row">
                      <button className="btn btn--sm btn--primary"
                        disabled={saving === change.cgmp_changeid}
                        onClick={() => saveDraft(change)}>
                        {saving === change.cgmp_changeid ? 'Saving…' : 'Save UAT Data'}
                      </button>
                      <button className="btn btn--sm btn--outline"
                        onClick={() => setDrafts(prev => { const n = { ...prev }; delete n[change.cgmp_changeid]; return n; })}>
                        Reset Changes
                      </button>
                    </div>
                  )}

                  {impProjects.length === 0 && (
                    <div className="giicc-empty" style={{ padding: 16 }}>No impacted projects linked to this change.</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={!!confirmComplete}
        onClose={() => setConfirmComplete(null)}
        onConfirm={doComplete}
        title="Mark Change as Completed"
        message={`Mark "${confirmComplete?.cgmp_changenumber} — ${confirmComplete?.cgmp_title}" as Completed? This will notify IT Ops for closure review and save all pending UAT data.`}
        confirmLabel="Mark Completed"
        loading={completing}
      />
    </div>
  );
}

const RCA_CATEGORIES = [
  'Configuration Error',
  'Network Failure',
  'Human Error',
  'Software Defect',
  'Vendor Issue',
  'Process Gap',
  'Environmental',
  'Other',
];

/* ── Failed Projects pane ────────────────────────────────────────── */

interface FailedProjectsPaneProps {
  changes: Cgmp_changes[];
  projects: Cgmp_projects[];
  refresh: () => void;
  currentUserName: string;
  currentUserUpn: string;
  showToast: (type: 'success' | 'error' | 'info' | 'warning', msg: string) => void;
  /** GIICC can set all statuses including Closed; IT Ops cannot set Closed */
  isGIICC?: boolean;
}

function FailedProjectsPane({ changes, projects, refresh, currentUserName, currentUserUpn, showToast, isGIICC = true }: FailedProjectsPaneProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState<Set<string>>(new Set()); // "changeId::pid"
  const [remDrafts, setRemDrafts] = useState<Record<string, { status: FailedProjectStatus; remarks: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [rcaDrafts, setRcaDrafts] = useState<Record<string, Partial<RCAEntry>>>({});
  const [rcaSaving, setRcaSaving] = useState<string | null>(null);
  const [rcaOpen, setRcaOpen] = useState<Set<string>>(new Set());

  const toggle = (id: string) => setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleHistory = (key: string) => setHistoryOpen(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });

  const statusOptions = isGIICC ? FAILED_PROJECT_STATUS_CONFIG : ITOPS_REM_STATUSES;

  const failedChanges = useMemo(() => {
    const validStatuses = new Set<number>([STATUS.InProgress, STATUS.Completed, STATUS.Closed]);
    return changes.filter(c => {
      if (!(c as any).cgmp_uatrequired) return false;
      const s = c.cgmp_status as unknown as number;
      if (!validStatuses.has(s)) return false;
      const uatData = parseChangeUATData(c.cgmp_uatusers);
      return Object.values(uatData).some(e => e.postStatus === 'Failed' || e.postStatus === 'Rollback' || e.postStatus === 'PartialSuccess');
    });
  }, [changes]);

  const saveRemediation = useCallback(async (change: Cgmp_changes, pid: string) => {
    const key = `${change.cgmp_changeid}::${pid}`;
    const draft = remDrafts[key];
    if (!draft) return;

    setSaving(key);
    try {
      const uatData = parseChangeUATData(change.cgmp_uatusers);
      const entry = uatData[pid] ?? defaultUATEntry();
      const prevStatus = entry.remediationStatus ?? 'Failed';

      const finalStatus: FailedProjectStatus = draft.status;

      const histEntry: RemediationHistoryEntry = {
        status: finalStatus,
        previousStatus: prevStatus,
        updatedBy: currentUserUpn,
        timestamp: new Date().toISOString(),
        remarks: draft.remarks,
      };
      const updatedEntry: ProjectUATEntry = {
        ...entry,
        remediationStatus: finalStatus,
        remediationHistory: [...(entry.remediationHistory ?? []), histEntry],
      };
      const updatedData = { ...uatData, [pid]: updatedEntry };

      const r = await Cgmp_changesService.update(change.cgmp_changeid, {
        cgmp_uatusers: JSON.stringify(updatedData),
      });
      if (!r.success) throw r.error ?? new Error('Save failed');

      /* Audit log */
      Cgmp_auditlogsService.create({
        cgmp_auditlogname: `Failed project status: ${entry.failureReason?.slice(0, 50) ?? pid} → ${finalStatus}`,
        cgmp_entitytype: asAuditEntityType(100000000),
        cgmp_eventtype: asAuditEventType(100000004),
        cgmp_entityid: change.cgmp_changeid,
        cgmp_entityname: change.cgmp_changenumber,
        cgmp_username: currentUserName,
        cgmp_useremail: currentUserUpn,
        cgmp_ipaddress: getBrowserInfo(),
        cgmp_previousvalues: JSON.stringify({ remediationStatus: prevStatus }),
        cgmp_newvalues: JSON.stringify({ remediationStatus: finalStatus, by: currentUserUpn, remarks: draft.remarks }),
      } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch(err => { if (import.meta.env.DEV) console.error('Audit log failed:', err); });

      /* Notifications to ISM + IT Ops */
      const proj = projects.find(p => p.cgmp_projectid === pid);
      const recipients = [proj?.cgmp_primaryism, proj?.cgmp_backupism, change.cgmp_releasedby, change.cgmp_reviewedby]
        .filter((v): v is string => !!v && v !== currentUserUpn);
      const uniqueRecipients = [...new Set(recipients)];
      const priority = (finalStatus === 'P1Initiated' || finalStatus === 'Closed') ? 100000000 : 100000001;
      await Promise.allSettled(uniqueRecipients.map(recipient =>
        Cgmp_notificationsService.create({
          cgmp_title: `Failed Project Update — ${proj?.cgmp_name ?? pid}`,
          cgmp_message: `Remediation status updated to "${remStatusLabel(finalStatus)}" for project "${proj?.cgmp_name ?? pid}" in change ${change.cgmp_changenumber}.${draft.remarks ? ' Note: ' + draft.remarks : ''}`,
          cgmp_category: asNotifCategory(100000002),
          cgmp_priority: asNotifPriority(priority),
          cgmp_recipientid: recipient,
          cgmp_relatedchangeid: change.cgmp_changeid,
          cgmp_actionurl: `#pmo?change=${change.cgmp_changenumber ?? ''}`,
          cgmp_relatedprojectid: pid,
          cgmp_isdismissed: false,
          cgmp_isread: false,
          statecode: 0 as unknown as Cgmp_notificationsstatecode,
        } as unknown as Omit<Cgmp_notificationsBase, 'cgmp_notificationid'>)
      ));

      /* Clear draft */
      setRemDrafts(prev => { const n = { ...prev }; delete n[key]; return n; });
      if (finalStatus !== prevStatus) setHistoryOpen(prev => { const s = new Set(prev); s.add(key); return s; });
      refresh();
      showToast('success', `Status → ${remStatusLabel(finalStatus)}${draft.status === 'Resolved' ? ' (auto-closed)' : ''}`);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Save failed');
    } finally { setSaving(null); }
  }, [remDrafts, currentUserUpn, projects, refresh, showToast]);

  const saveRCA = useCallback(async (change: Cgmp_changes, pid: string) => {
    const key = `${change.cgmp_changeid}::${pid}`;
    const draft = rcaDrafts[key];
    if (!draft?.category || !draft?.description) return;
    setRcaSaving(key);
    try {
      const uatData = parseChangeUATData(change.cgmp_uatusers);
      const entry = uatData[pid] ?? defaultUATEntry();
      const rcaEntry: RCAEntry = {
        category: draft.category,
        description: draft.description,
        preventiveAction: draft.preventiveAction ?? '',
        owner: draft.owner ?? '',
        savedBy: currentUserUpn,
        savedAt: new Date().toISOString(),
      };
      const updatedData = { ...uatData, [pid]: { ...entry, rca: rcaEntry } };
      const r = await Cgmp_changesService.update(change.cgmp_changeid, { cgmp_uatusers: JSON.stringify(updatedData) });
      if (!r.success) throw r.error ?? new Error('Save failed');
      Cgmp_auditlogsService.create({
        cgmp_auditlogname: `RCA saved: ${change.cgmp_changenumber} — ${pid}`,
        cgmp_entitytype: asAuditEntityType(100000000),
        cgmp_eventtype: asAuditEventType(100000003),
        cgmp_entityid: change.cgmp_changeid,
        cgmp_entityname: change.cgmp_changenumber,
        cgmp_username: currentUserName,
        cgmp_useremail: currentUserUpn,
        cgmp_ipaddress: getBrowserInfo(),
        cgmp_newvalues: JSON.stringify({ rca: rcaEntry }),
      } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch(err => { if (import.meta.env.DEV) console.error('Audit log failed:', err); });
      setRcaDrafts(prev => { const n = { ...prev }; delete n[key]; return n; });
      setRcaOpen(prev => { const s = new Set(prev); s.delete(key); return s; });
      refresh();
      showToast('success', 'Root Cause Analysis saved');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'RCA save failed');
    } finally { setRcaSaving(null); }
  }, [rcaDrafts, currentUserUpn, refresh, showToast]);

  if (failedChanges.length === 0) {
    return (
      <div className="giicc-empty-pane">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.2, color: 'var(--success)' }}>
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
        </svg>
        <p>No failed, rollback, or partial success projects.</p>
        <span>Projects with Failed, Rollback, or Partial Success post-UAT status will appear here.</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} />
          Show resolved / closed projects
        </label>
      </div>

      {failedChanges.map(change => {
        const isOpen = expanded.has(change.cgmp_changeid);
        const sc = change.cgmp_status as unknown as number;
        const uatData = parseChangeUATData(change.cgmp_uatusers);
        const projectIds = (change.cgmp_projectids ?? '').split(',').map(s => s.trim()).filter(Boolean);
        const failedEntries = projectIds
          .map(pid => ({ pid, project: projects.find(p => p.cgmp_projectid === pid), entry: uatData[pid] }))
          .filter(({ entry }) => {
            if (!entry) return false;
            if (entry.postStatus !== 'Failed' && entry.postStatus !== 'Rollback' && entry.postStatus !== 'PartialSuccess') return false;
            if (!showClosed && entry.remediationStatus === 'Closed') return false;
            return true;
          });

        if (failedEntries.length === 0) return null;
        const activeCount = failedEntries.filter(({ entry }) => entry?.remediationStatus !== 'Closed').length;

        return (
          <div key={change.cgmp_changeid} className="giicc-change-block giicc-change-block--failed">
            <div
              className={`giicc-change-header ${isOpen ? 'giicc-change-header--open' : ''}`}
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              onClick={() => toggle(change.cgmp_changeid)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(change.cgmp_changeid); } }}
            >
              <svg className={`giicc-chevron ${isOpen ? 'giicc-chevron--open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
              </svg>
              <div className="giicc-change-info">
                <div className="giicc-change-top">
                  <span className="change-number">{change.cgmp_changenumber}</span>
                  <span className="giicc-change-title">{change.cgmp_title}</span>
                </div>
                <div className="giicc-change-bottom">
                  <span className={`badge badge--status ${statusColor(sc)}`}>{statusLabel(sc)}</span>
                  <span className="giicc-failed-count-chip">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" /></svg>
                    {activeCount} active · {failedEntries.length} total
                  </span>
                  <span className="giicc-change-dates">{fmtDate(change.cgmp_starttime)}</span>
                </div>
              </div>
            </div>

            {isOpen && (
              <div className="giicc-change-projects">
                {failedEntries.map(({ pid, project, entry }) => {
                  if (!entry) return null;
                  const key = `${change.cgmp_changeid}::${pid}`;
                  const draft = remDrafts[key];
                  const currentRemStatus = entry.remediationStatus ?? 'Failed';
                  const isClosed = currentRemStatus === 'Closed';
                  const isHistOpen = historyOpen.has(key);
                  const isSaving = saving === key;

                  return (
                    <div key={pid} className={`giicc-fpc ${isClosed ? 'giicc-fpc--closed' : ''}`}>
                      {/* Left accent bar */}
                      <div className="giicc-fpc__accent" style={{ background: isClosed ? 'var(--border)' : remStatusColor(currentRemStatus) }} />

                      <div className="giicc-fpc__body">
                        {/* Top row: name + badges + history btn */}
                        <div className="giicc-fpc__top">
                          <div className="giicc-fpc__meta">
                            <span className="giicc-fpc__name">{project?.cgmp_name ?? pid}</span>
                            {project?.cgmp_pidbnumber && <span className="proj-pidb">{project.cgmp_pidbnumber}</span>}
                            {project?.cgmp_primaryism && <span className="proj-meta-chip">{project.cgmp_primaryism}</span>}
                          </div>
                          <button
                            className={`btn btn--xs ${isHistOpen ? 'btn--primary' : 'btn--outline'}`}
                            onClick={() => toggleHistory(key)}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 3 }}><path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z" /></svg>
                            History{(entry.remediationHistory ?? []).length > 0 ? ` (${(entry.remediationHistory ?? []).length})` : ''}
                          </button>
                        </div>

                        {/* Status row */}
                        <div className="giicc-fpc__statuses">
                          <div className="giicc-fpc__stat-group">
                            <span className="giicc-fpc__stat-label">Post-UAT</span>
                            <span className={`giicc-uat-badge ${uatStatusClass(entry.postStatus)}`}>{entry.postStatus}</span>
                          </div>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" /></svg>
                          <div className="giicc-fpc__stat-group">
                            <span className="giicc-fpc__stat-label">Remediation</span>
                            <span className="rem-status-pill giicc-fpc__rem-pill" style={{ background: `${remStatusColor(currentRemStatus)}18`, color: remStatusColor(currentRemStatus), borderColor: `${remStatusColor(currentRemStatus)}40` }}>
                              {remStatusLabel(currentRemStatus)}
                            </span>
                          </div>
                          {entry.failureReason && (
                            <div className="giicc-fpc__reason">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" /></svg>
                              {entry.failureReason}
                            </div>
                          )}
                        </div>

                        {/* History timeline */}
                        {isHistOpen && (
                          <div className="giicc-fpc__history">
                            {(entry.remediationHistory ?? []).length === 0
                              ? <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No history yet.</span>
                              : <RemediationHistory history={entry.remediationHistory ?? []} />
                            }
                          </div>
                        )}

                        {/* Update form */}
                        {!isClosed ? (
                          <div className="giicc-fpc__form">
                            <select
                              className="ff-input giicc-status-sel giicc-fpc__sel"
                              value={draft?.status ?? currentRemStatus}
                              onChange={e => setRemDrafts(prev => ({
                                ...prev,
                                [key]: { status: e.target.value as FailedProjectStatus, remarks: prev[key]?.remarks ?? '' }
                              }))}
                            >
                              {statusOptions.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </select>
                            <input
                              className="giicc-comment-inp giicc-fpc__inp"
                              placeholder="Add remarks…"
                              value={draft?.remarks ?? ''}
                              onChange={e => setRemDrafts(prev => ({
                                ...prev,
                                [key]: { status: prev[key]?.status ?? currentRemStatus, remarks: e.target.value }
                              }))}
                            />
                            <button
                              className="btn btn--sm btn--primary"
                              disabled={isSaving || !draft || (draft.status === currentRemStatus && !draft.remarks)}
                              onClick={() => saveRemediation(change, pid)}
                            >
                              {isSaving ? 'Saving…' : draft?.status === 'Resolved' ? 'Save & Auto-Close' : 'Save'}
                            </button>
                            {draft?.status === 'Resolved' && (
                              <span className="giicc-fpc__auto-close-hint">
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" /></svg>
                                Will auto-close
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="giicc-fpc__closed-banner">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" /></svg>
                            Remediation closed — project resolved
                          </div>
                        )}

                        {/* RCA Form */}
                        {(() => {
                          const isRcaOpen = rcaOpen.has(key);
                          const rcaDraft = rcaDrafts[key];
                          const existingRca = entry.rca;
                          const isRcaSaving = rcaSaving === key;
                          return (
                            <div style={{ marginTop: 8 }}>
                              {existingRca && !isRcaOpen ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                                  <span style={{ color: 'var(--success)', fontWeight: 600 }}>✓ RCA Filed</span>
                                  <span style={{ color: 'var(--text-secondary)' }}>{existingRca.category}</span>
                                  <button className="btn btn--xs btn--outline" onClick={() => { setRcaOpen(prev => { const s = new Set(prev); s.add(key); return s; }); setRcaDrafts(prev => ({ ...prev, [key]: { ...existingRca } })); }}>Edit</button>
                                </div>
                              ) : !isRcaOpen ? (
                                <button className="btn btn--xs btn--outline" onClick={() => setRcaOpen(prev => { const s = new Set(prev); s.add(key); return s; })}>
                                  + Root Cause Analysis
                                </button>
                              ) : (
                                <div style={{ background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>Root Cause Analysis</div>
                                  <select
                                    className="ff-input giicc-status-sel"
                                    value={rcaDraft?.category ?? ''}
                                    onChange={e => setRcaDrafts(prev => ({ ...prev, [key]: { ...prev[key], category: e.target.value } }))}
                                  >
                                    <option value="">— Select Category —</option>
                                    {RCA_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                  <textarea
                                    className="ff-input giicc-comment-inp"
                                    rows={2}
                                    placeholder="Description (what happened?)"
                                    value={rcaDraft?.description ?? ''}
                                    onChange={e => setRcaDrafts(prev => ({ ...prev, [key]: { ...prev[key], description: e.target.value } }))}
                                    style={{ resize: 'vertical', minHeight: 48 }}
                                  />
                                  <textarea
                                    className="ff-input giicc-comment-inp"
                                    rows={2}
                                    placeholder="Preventive Action (what will prevent recurrence?)"
                                    value={rcaDraft?.preventiveAction ?? ''}
                                    onChange={e => setRcaDrafts(prev => ({ ...prev, [key]: { ...prev[key], preventiveAction: e.target.value } }))}
                                    style={{ resize: 'vertical', minHeight: 48 }}
                                  />
                                  <input
                                    className="ff-input giicc-comment-inp"
                                    placeholder="Owner (responsible team/person)"
                                    value={rcaDraft?.owner ?? ''}
                                    onChange={e => setRcaDrafts(prev => ({ ...prev, [key]: { ...prev[key], owner: e.target.value } }))}
                                  />
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <button
                                      className="btn btn--xs btn--primary"
                                      disabled={isRcaSaving || !rcaDraft?.category || !rcaDraft?.description}
                                      onClick={() => saveRCA(change, pid)}
                                    >
                                      {isRcaSaving ? 'Saving…' : 'Save RCA'}
                                    </button>
                                    <button className="btn btn--xs btn--outline" onClick={() => { setRcaOpen(prev => { const s = new Set(prev); s.delete(key); return s; }); setRcaDrafts(prev => { const n = { ...prev }; delete n[key]; return n; }); }}>Cancel</button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────────────── */

type GiiccTab = 'summary' | 'scheduled' | 'bridges' | 'failed';

export default function GIICCCommandCenter() {
  const { showToast, currentUserName, currentUserUpn } = useApp();
  const { changes, loading: changesLoading, refresh: refreshChanges } = useChangeList();
  const { projects } = useProjects();
  const { bridges, loading: bridgesLoading, error, refresh: refreshBridges } = useAllBridges(30000);
  const { profiles: allProfiles } = useAllUserProfiles();

  const [tab, setTab] = useState<GiiccTab>('summary');
  const [createOpen, setCreateOpen] = useState(false);
  const [editBridge, setEditBridge] = useState<Cgmp_bridges | null>(null);
  const [execBridge, setExecBridge] = useState<Cgmp_bridges | null>(null);
  const [pirBridge, setPirBridge] = useState<Cgmp_bridges | null>(null);
  const [startTarget, setStartTarget] = useState<Cgmp_bridges | null>(null);

  /* ── #49 Escalation: auto-notify for remediations stuck in UnderInvestigation >24h ── */
  const escalatedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (changesLoading || !changes.length) return;
    const nowMs = Date.now();
    const H24_MS = 24 * 60 * 60 * 1000;
    changes.forEach(c => {
      const sc = c.cgmp_status as unknown as number;
      if (sc !== STATUS.InProgress && sc !== STATUS.Completed && sc !== STATUS.Closed) return;
      const d = parseChangeUATData(c.cgmp_uatusers);
      Object.entries(d).forEach(([pid, entry]) => {
        if (entry.remediationStatus !== 'UnderInvestigation') return;
        const history = entry.remediationHistory ?? [];
        const lastEntry = [...history].reverse().find(h => h.status === 'UnderInvestigation');
        if (!lastEntry) return;
        const enteredMs = new Date(lastEntry.timestamp).getTime();
        if (isNaN(enteredMs) || nowMs - enteredMs < H24_MS) return;
        const key = `${c.cgmp_changeid}_${pid}`;
        if (escalatedRef.current.has(key)) return;
        escalatedRef.current.add(key);
        const proj = projects.find(p => p.cgmp_projectid === pid);
        const candidates = [proj?.cgmp_primaryism, proj?.cgmp_backupism, c.cgmp_releasedby]
          .filter((v): v is string => !!v && v !== currentUserUpn);
        const uniqueRecipients = [...new Set(candidates.length ? candidates : [currentUserUpn].filter(Boolean) as string[])];
        uniqueRecipients.forEach(recipient => {
          Cgmp_notificationsService.create({
            cgmp_title: `Escalation — Remediation Stalled: ${proj?.cgmp_name ?? pid}`,
            cgmp_message: `Project "${proj?.cgmp_name ?? pid}" in change ${c.cgmp_changenumber} has been in "Under Investigation" for over 24 hours. Immediate action required.`,
            cgmp_category: asNotifCategory(100000002),
            cgmp_priority: asNotifPriority(100000000),
            cgmp_recipientid: recipient,
            cgmp_actionurl: `#pmo?change=${c.cgmp_changenumber ?? ''}`,
            statecode: 0 as unknown as Cgmp_notificationsstatecode,
          } as unknown as Omit<Cgmp_notificationsBase, 'cgmp_notificationid'>).catch(err => { if (import.meta.env.DEV) console.error('Background operation failed:', err); });
        });
      });
    });
  }, [changes, changesLoading, projects, currentUserUpn]);

  const doStartBridge = useCallback(async (bridge: Cgmp_bridges) => {
    try {
      const r = await Cgmp_bridgesService.update(bridge.cgmp_bridgeid, {
        cgmp_status: BRIDGE_STATUS.InProgress as unknown as Cgmp_bridgescgmp_status,
        cgmp_actualstart: new Date().toISOString(),
      });
      if (!r.success) throw r.error ?? new Error('Failed to start bridge');
      showToast('success', 'Bridge started');
      refreshBridges();
      Cgmp_bridgesService.update(bridge.cgmp_bridgeid, { cgmp_participants: currentUserUpn } as any).catch(() => {});
    } catch (err) { showToast('error', err instanceof Error ? err.message : 'Failed to start bridge'); }
  }, [showToast, refreshBridges, currentUserUpn]);

  const activeBridges    = useMemo(() => bridges.filter(b => (b.cgmp_status as unknown as number) === BRIDGE_STATUS.InProgress), [bridges]);
  const scheduledBridges = useMemo(() => bridges.filter(b => (b.cgmp_status as unknown as number) === BRIDGE_STATUS.Scheduled), [bridges]);
  const todayDone        = useMemo(() => bridges.filter(b => {
    const s = b.cgmp_status as unknown as number;
    return (s === BRIDGE_STATUS.Completed || s === BRIDGE_STATUS.Failed) && (isToday(b.cgmp_actualend) || isToday(b.cgmp_schedend));
  }), [bridges]);

  const inProgressCount = useMemo(() =>
    changes.filter(c => (c.cgmp_status as unknown as number) === STATUS.InProgress).length,
    [changes]);

  const failedCount = useMemo(() => {
    let count = 0;
    changes.forEach(c => {
      const sc = c.cgmp_status as unknown as number;
      if (sc !== STATUS.InProgress && sc !== STATUS.Completed && sc !== STATUS.Closed) return;
      const d = parseChangeUATData(c.cgmp_uatusers);
      Object.values(d).forEach(e => {
        if ((e.postStatus === 'Failed' || e.postStatus === 'Rollback') && e.remediationStatus !== 'Closed') count++;
      });
    });
    return count;
  }, [changes]);

  /* Summary tab data */
  const pendingHandoverCount = useMemo(() =>
    changes.filter(c => (c.cgmp_status as unknown as number) === STATUS.Locked).length, [changes]);

  const weekStartMs = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0,0,0,0); return d.getTime(); }, []);
  const thisWeekBridges = useMemo(() => bridges.filter(b => b.cgmp_schedstart && new Date(b.cgmp_schedstart).getTime() >= weekStartMs), [bridges, weekStartMs]);
  const thisWeekCompletionRate = useMemo(() => {
    const done = thisWeekBridges.filter(b => (b.cgmp_status as unknown as number) === BRIDGE_STATUS.Completed).length;
    return thisWeekBridges.length > 0 ? Math.round(done / thisWeekBridges.length * 100) : null;
  }, [thisWeekBridges]);

  const remediationBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    changes.forEach(c => {
      const sc = c.cgmp_status as unknown as number;
      if (sc !== STATUS.InProgress && sc !== STATUS.Completed && sc !== STATUS.Closed) return;
      const d = parseChangeUATData(c.cgmp_uatusers);
      Object.values(d).forEach(e => {
        if (e.postStatus === 'Failed' || e.postStatus === 'Rollback' || e.postStatus === 'PartialSuccess') {
          const status = e.remediationStatus ?? 'Unknown';
          counts[status] = (counts[status] ?? 0) + 1;
        }
      });
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [changes]);

  return (
    <div className="giicc-workspace">
      {/* Header */}
      <div className="giicc-header">
        <div>
          <h1 className="giicc-title">GIICC Command Center</h1>
          <p className="giicc-subtitle">UAT execution tracking, bridge management, and post-implementation review</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--outline btn--sm" onClick={() => { refreshChanges(); refreshBridges(); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
            </svg>
            Refresh
          </button>
          {tab === 'bridges' && (
            <button className="btn btn--primary btn--sm" onClick={() => setCreateOpen(true)}>
              + Create Bridge
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="giicc-kpis">
        <div className="giicc-kpi giicc-kpi--active">
          <span className="giicc-kpi__value">{activeBridges.length}</span>
          <span className="giicc-kpi__label">Active Bridges</span>
          {activeBridges.length > 0 && <span className="giicc-live-indicator" />}
        </div>
        <div className="giicc-kpi">
          <span className="giicc-kpi__value" style={{ color: 'var(--primary)' }}>{inProgressCount}</span>
          <span className="giicc-kpi__label">Changes In Progress</span>
        </div>
        <div className="giicc-kpi">
          <span className="giicc-kpi__value">{scheduledBridges.length}</span>
          <span className="giicc-kpi__label">Scheduled Bridges</span>
        </div>
        <div className="giicc-kpi">
          <span className="giicc-kpi__value" style={{ color: todayDone.filter(b => (b.cgmp_status as unknown as number) === BRIDGE_STATUS.Completed).length > 0 ? 'var(--success)' : undefined }}>
            {todayDone.filter(b => (b.cgmp_status as unknown as number) === BRIDGE_STATUS.Completed).length}
          </span>
          <span className="giicc-kpi__label">Bridges Done Today</span>
        </div>
        <div className="giicc-kpi">
          <span className="giicc-kpi__value" style={{ color: failedCount > 0 ? 'var(--danger)' : 'var(--text-tertiary)' }}>{failedCount}</span>
          <span className="giicc-kpi__label">Failed Projects</span>
        </div>
      </div>

      {/* Sub-pane tabs */}
      <div className="giicc-tabs">
        <button className={`giicc-tab ${tab === 'summary' ? 'giicc-tab--active' : ''}`} onClick={() => setTab('summary')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" /></svg>
          Summary
        </button>
        <button className={`giicc-tab ${tab === 'scheduled' ? 'giicc-tab--active' : ''}`} onClick={() => setTab('scheduled')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z" /></svg>
          Scheduled Changes
          {inProgressCount > 0 && <span className="giicc-tab-badge">{inProgressCount}</span>}
        </button>
        <button className={`giicc-tab ${tab === 'bridges' ? 'giicc-tab--active' : ''}`} onClick={() => setTab('bridges')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>
          UAT Bridges
          {activeBridges.length > 0 && <span className="giicc-tab-badge giicc-tab-badge--live">{activeBridges.length} live</span>}
        </button>
        <button className={`giicc-tab ${tab === 'failed' ? 'giicc-tab--active' : ''}`} onClick={() => setTab('failed')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" /></svg>
          Failed Projects
          {failedCount > 0 && <span className="giicc-tab-badge giicc-tab-badge--danger">{failedCount}</span>}
        </button>
      </div>

      {/* Tab content */}
      <div className="giicc-tab-content">

        {/* ── Summary Dashboard ── */}
        {tab === 'summary' && (
          <div className="giicc-summary">
            {/* Summary KPI cards */}
            <div className="giicc-summary-kpis">
              <div className="giicc-summary-kpi">
                <span className="giicc-summary-kpi__value" style={{ color: activeBridges.length > 0 ? 'var(--danger)' : 'var(--text-tertiary)' }}>{activeBridges.length}</span>
                <span className="giicc-summary-kpi__label">Bridges Running Now</span>
                {activeBridges.length > 0 && <span className="giicc-live-indicator" />}
              </div>
              <div className="giicc-summary-kpi">
                <span className="giicc-summary-kpi__value" style={{ color: pendingHandoverCount > 0 ? 'var(--orange)' : 'var(--text-tertiary)' }}>{pendingHandoverCount}</span>
                <span className="giicc-summary-kpi__label">Pending GIICC Handover</span>
              </div>
              <div className="giicc-summary-kpi">
                <span className="giicc-summary-kpi__value" style={{ color: failedCount > 0 ? 'var(--danger)' : 'var(--success)' }}>{failedCount}</span>
                <span className="giicc-summary-kpi__label">Open Failed Projects</span>
              </div>
              <div className="giicc-summary-kpi">
                <span className="giicc-summary-kpi__value" style={{ color: thisWeekCompletionRate !== null ? (thisWeekCompletionRate >= 80 ? 'var(--success)' : thisWeekCompletionRate >= 50 ? 'var(--orange)' : 'var(--danger)') : 'var(--text-tertiary)' }}>
                  {thisWeekCompletionRate !== null ? `${thisWeekCompletionRate}%` : '—'}
                </span>
                <span className="giicc-summary-kpi__label">Bridge Success Rate (7d)</span>
              </div>
            </div>

            <div className="giicc-summary-panels">
              {/* Active Bridges list */}
              <div className="giicc-summary-section">
                <h3 className="giicc-summary-section__title">Active Bridges ({activeBridges.length})</h3>
                {activeBridges.length === 0 ? (
                  <div className="module-empty" style={{ fontSize: 12 }}>No bridges currently running.</div>
                ) : activeBridges.map(b => (
                  <div key={b.cgmp_bridgeid} className="giicc-summary-bridge-row">
                    <span className="giicc-live-indicator" style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.cgmp_title}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        Started {b.cgmp_actualstart ? new Date(b.cgmp_actualstart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: getDisplayTimezone() }) : '—'}
                        {b.cgmp_changenumber && <span style={{ marginLeft: 6 }}>• {b.cgmp_changenumber}</span>}
                      </div>
                    </div>
                    {isValidTeamsUrl(b.cgmp_teamsurl) ? (
                      <a href={b.cgmp_teamsurl} target="_blank" rel="noopener noreferrer" className="bridge-teams-link" style={{ flexShrink: 0 }} onClick={e => e.stopPropagation()}>Join</a>
                    ) : b.cgmp_teamsurl ? (
                      <span title="Invalid Teams URL" style={{ flexShrink: 0, fontSize: 11, color: 'var(--text-secondary)' }}>{b.cgmp_teamsurl}</span>
                    ) : null}
                  </div>
                ))}
              </div>

              {/* Pending GIICC Handover */}
              <div className="giicc-summary-section">
                <h3 className="giicc-summary-section__title">Pending GIICC Handover ({pendingHandoverCount})</h3>
                {pendingHandoverCount === 0 ? (
                  <div className="module-empty" style={{ fontSize: 12 }}>No changes pending handover.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {changes.filter(c => (c.cgmp_status as unknown as number) === STATUS.Locked).slice(0, 8).map(c => {
                      const rc = c.cgmp_risklevel as unknown as number;
                      return (
                        <div key={c.cgmp_changeid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--surface-alt)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)' }}>
                          <span className="change-number" style={{ fontSize: 11, flexShrink: 0 }}>{c.cgmp_changenumber}</span>
                          <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.cgmp_title}</span>
                          <span className={`badge badge--risk ${riskColor(rc)}`} style={{ fontSize: 10, flexShrink: 0 }}>{riskLabel(rc)}</span>
                          {c.cgmp_starttime && (
                            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>{fmtDate(c.cgmp_starttime)}</span>
                          )}
                        </div>
                      );
                    })}
                    {pendingHandoverCount > 8 && (
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center' }}>+{pendingHandoverCount - 8} more — view Scheduled Changes tab</div>
                    )}
                  </div>
                )}
              </div>

              {/* Failed Projects by Remediation Status */}
              <div className="giicc-summary-section">
                <h3 className="giicc-summary-section__title">Failed Projects by Remediation Status</h3>
                {remediationBreakdown.length === 0 ? (
                  <div className="module-empty" style={{ fontSize: 12 }}>No failed or rollback projects.</div>
                ) : (
                  <table className="itops-sla-table">
                    <thead>
                      <tr><th>Status</th><th>Count</th></tr>
                    </thead>
                    <tbody>
                      {remediationBreakdown.map(([status, count]) => (
                        <tr key={status} className="itops-sla-table__row">
                          <td style={{ fontWeight: 500 }}>{remStatusLabel(status as FailedProjectStatus)}</td>
                          <td>
                            <span style={{ fontWeight: 700, color: status === 'Closed' ? 'var(--success)' : status === 'UnderInvestigation' ? 'var(--orange)' : 'var(--danger)' }}>
                              {count}
                            </span>
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

        {/* ── Scheduled Changes ── */}
        {tab === 'scheduled' && (
          changesLoading
            ? <div className="giicc-loading">Loading changes…</div>
            : <ScheduledChangesPaneInner
                changes={changes}
                projects={projects}
                refresh={refreshChanges}
                currentUserName={currentUserName ?? ''}
                currentUserUpn={currentUserUpn ?? ''}
                showToast={showToast}
                allProfiles={allProfiles}
              />
        )}

        {/* ── UAT Bridges ── */}
        {tab === 'bridges' && (
          bridgesLoading
            ? <div className="giicc-loading">Loading bridges…</div>
            : (
              <>
                {error && (
                  <div role="alert" style={{ color: 'var(--danger)', padding: 16 }}>
                    Failed to load bridges: {error}
                    <button className="btn btn--outline" onClick={refreshBridges} style={{ marginLeft: 8 }}>Retry</button>
                  </div>
                )}
                <div className="giicc-board">
                  <div className="giicc-col">
                    <ColHeader title="Active Bridges" count={activeBridges.length} accent="var(--success)" />
                    <div className="giicc-col__cards">
                      {activeBridges.length === 0 ? <div className="giicc-empty">No active bridges</div>
                        : activeBridges.map(b => <BridgeCard key={b.cgmp_bridgeid} bridge={b} onExecution={setExecBridge} onPIR={setPirBridge} onEdit={setEditBridge} onStart={setStartTarget} />)}
                    </div>
                  </div>
                  <div className="giicc-col">
                    <ColHeader title="Scheduled" count={scheduledBridges.length} accent="var(--primary)" />
                    <div className="giicc-col__cards">
                      {scheduledBridges.length === 0 ? <div className="giicc-empty">No scheduled bridges</div>
                        : scheduledBridges.map(b => <BridgeCard key={b.cgmp_bridgeid} bridge={b} onExecution={setExecBridge} onPIR={setPirBridge} onEdit={setEditBridge} onStart={setStartTarget} />)}
                    </div>
                  </div>
                  <div className="giicc-col">
                    <ColHeader title="Completed / Failed Today" count={todayDone.length} accent="var(--text-tertiary)" />
                    <div className="giicc-col__cards">
                      {todayDone.length === 0 ? <div className="giicc-empty">None today</div>
                        : todayDone.map(b => <BridgeCard key={b.cgmp_bridgeid} bridge={b} onExecution={setExecBridge} onPIR={setPirBridge} onEdit={setEditBridge} onStart={setStartTarget} />)}
                    </div>
                  </div>
                </div>

                {bridges.length > 0 && (
                  <details className="giicc-all-details">
                    <summary className="giicc-all-summary">All Bridges ({bridges.length})</summary>
                    <div className="giicc-all-table-wrap">
                      <table className="ism-table">
                        <thead><tr>
                          <th>Title</th><th>Status</th><th>Template</th><th>Change #</th>
                          <th>Sched Start</th><th>Sched End</th><th>Actual Start</th><th>Actual End</th>
                          <th>Downtime</th><th>Actions</th>
                        </tr></thead>
                        <tbody>
                          {bridges.map(b => {
                            const s = b.cgmp_status as unknown as number;
                            const t = b.cgmp_template as unknown as number;
                            return (
                              <tr key={b.cgmp_bridgeid}>
                                <td>{b.cgmp_title}</td>
                                <td><span className={`badge badge--status ${bridgeBadgeClass(s)}`}>{bridgeStatusLabel(s)}</span></td>
                                <td>{TEMPLATE_LABEL[t] ?? '—'}</td>
                                <td>{b.cgmp_changenumber || '—'}</td>
                                <td>{fmtTime(b.cgmp_schedstart)}</td><td>{fmtTime(b.cgmp_schedend)}</td>
                                <td>{fmtTime(b.cgmp_actualstart)}</td><td>{fmtTime(b.cgmp_actualend)}</td>
                                <td>{b.cgmp_downtimeminutes != null ? `${b.cgmp_downtimeminutes}m` : '—'}</td>
                                <td>
                                  <div style={{ display: 'flex', gap: 4 }}>
                                    <button className="btn btn--xs btn--outline" onClick={() => setEditBridge(b)}>Edit</button>
                                    {(s === BRIDGE_STATUS.InProgress || s === BRIDGE_STATUS.Scheduled) && (
                                      <button className="btn btn--xs btn--secondary" onClick={() => setExecBridge(b)}>Exec</button>
                                    )}
                                    {(s === BRIDGE_STATUS.InProgress || s === BRIDGE_STATUS.Completed || s === BRIDGE_STATUS.Failed) && (
                                      <button className="btn btn--xs btn--outline" onClick={() => setPirBridge(b)}>PIR</button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </>
            )
        )}

        {/* ── Failed Projects ── */}
        {tab === 'failed' && (
          changesLoading
            ? <div className="giicc-loading">Loading…</div>
            : <FailedProjectsPane changes={changes} projects={projects} refresh={refreshChanges} currentUserName={currentUserName ?? ''} currentUserUpn={currentUserUpn ?? ''} showToast={showToast} isGIICC />
        )}
      </div>

      {/* Modals & Panels */}
      <BridgeForm open={createOpen} onClose={() => setCreateOpen(false)} onSaved={refreshBridges} allChanges={changes} />
      <BridgeForm open={!!editBridge} bridge={editBridge} onClose={() => setEditBridge(null)} onSaved={refreshBridges} allChanges={changes} />
      <BridgeExecution open={!!execBridge} bridge={execBridge} onClose={() => setExecBridge(null)} onUpdated={refreshBridges} allChanges={changes} />
      <PIRForm open={!!pirBridge} bridge={pirBridge} onClose={() => setPirBridge(null)} onUpdated={refreshBridges} changeId={changes.find(c => c.cgmp_changenumber === pirBridge?.cgmp_changenumber)?.cgmp_changeid} />
      <ConfirmDialog
        open={!!startTarget}
        onClose={() => setStartTarget(null)}
        onConfirm={async () => { await doStartBridge(startTarget!); setStartTarget(null); }}
        title="Start Bridge"
        message={`Start bridge execution for "${startTarget?.cgmp_title}"? This will mark it as Active and record the actual start time.`}
        confirmLabel="Start Bridge"
      />
    </div>
  );
}
