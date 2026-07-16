import { useState, useEffect, useCallback, useMemo } from 'react';
import { SlidePanel } from '../ui/Modal';
import { getBrowserInfo, fmtDateTime as fmtDate, getDisplayTimezone } from '../../utils/format';
import { useApp } from '../../context/AppContext';
import { Cgmp_changesService, Cgmp_auditlogsService, Cgmp_changehistoryService } from '../../generated';
import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';
import type {
  Cgmp_changescgmp_status,
  Cgmp_changescgmp_risklevel,
  Cgmp_changescgmp_impactlevel,
} from '../../generated/models/Cgmp_changesModel';
import type { Cgmp_auditlogsBase } from '../../generated/models/Cgmp_auditlogsModel';
import type {
  Cgmp_auditlogscgmp_entitytype,
  Cgmp_auditlogscgmp_eventtype,
} from '../../generated/models/Cgmp_auditlogsModel';
import { STATUS, statusLabel, statusColor, riskLabel, riskColor, appendHistory } from '../../hooks/useDataverse';
import AttachmentPanel from '../ui/AttachmentPanel';
import { ProjectMultiSelect } from '../ui/ProjectMultiSelect';
import { validateForReview, hasBlockingErrors } from './validation';
import type { ValidationResult } from './validation';
import type { Cgmp_projects } from '../../generated/models/Cgmp_projectsModel';
import { categoryLabel, changeTypeLabel } from '../pmo/ChangeForm';
import { IMPACT_OPTIONS, RISK_OPTIONS } from '../pmo/options';

function impactLabel(code: number): string {
  return IMPACT_OPTIONS.find((o) => o.value === String(code))?.label ?? '—';
}

/* ── Concern helpers (duplicated from ISMWorkspace for isolation) ── */
type ConcernSeverity = 'Low' | 'Medium' | 'High' | 'Critical';
type ConcernEntry = {
  _type: 'concern';
  concernType: string;
  severity?: ConcernSeverity;
  projectId: string;
  projectName: string;
  remarks: string;
  raisedBy: string;
  timestamp: string;
  resolvedBy?: string;
  resolvedAt?: string;
  resolution?: string;
};

const CONCERN_LABELS: Record<string, string> = {
  QueryRaised: 'Query Raised',
  BusinessConcernRaised: 'Business Concern Raised',
  BusinessApprovalPending: 'Business Approval Pending',
  BusinessRestrictionIdentified: 'Business Restriction Identified',
};

const CONCERN_COLORS: Record<string, string> = {
  QueryRaised: 'var(--warning)',
  BusinessConcernRaised: 'var(--danger)',
  BusinessApprovalPending: 'var(--primary)',
  BusinessRestrictionIdentified: '#b45309',
};

/* Derive severity from concern type when not explicitly set */
const CONCERN_TYPE_SEVERITY: Record<string, ConcernSeverity> = {
  QueryRaised: 'Low',
  BusinessConcernRaised: 'High',
  BusinessApprovalPending: 'Medium',
  BusinessRestrictionIdentified: 'High',
};

function severityClass(sev: ConcernSeverity | undefined): string {
  if (sev === 'Critical') return 'danger';
  if (sev === 'High') return 'danger';
  if (sev === 'Medium') return 'warning';
  return 'default';
}
function severityLabel(sev: ConcernSeverity | undefined): string {
  if (sev === 'Critical') return 'Critical';
  if (sev === 'High') return 'High';
  if (sev === 'Medium') return 'Medium';
  return 'Low';
}

function parseConcerns(versionHistory: string | undefined | null): ConcernEntry[] {
  try {
    const entries = JSON.parse(versionHistory ?? '[]');
    return (Array.isArray(entries) ? entries : []).filter((e: any) => e._type === 'concern') as ConcernEntry[];
  } catch {
    return [];
  }
}

/* ── Validation item row ── */
function ValidationRow({ result }: { result: ValidationResult }) {
  const { severity, message } = result;
  const icon =
    severity === 'pass' ? (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
      </svg>
    ) : severity === 'warning' ? (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
      </svg>
    ) : (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
      </svg>
    );

  const color = severity === 'pass' ? 'var(--success)' : severity === 'warning' ? 'var(--orange)' : 'var(--danger)';
  return (
    <div className="rv-check">
      <span className="rv-check__icon" style={{ color }}>
        {icon}
      </span>
      <span className={`rv-check__msg rv-check__msg--${severity}`}>{message}</span>
    </div>
  );
}

/* ── Pen icon button ── */
function PenBtn({ onClick, title = 'Edit' }: { onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '1px 3px',
        color: 'var(--text-tertiary)',
        display: 'inline-flex',
        alignItems: 'center',
        opacity: 0.65,
        flexShrink: 0,
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
      </svg>
    </button>
  );
}

/* ── Read-only field pair ── */
function RVField({
  label,
  children,
  actions,
}: {
  label: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="rv-field">
      <span className="rv-field__label">{label}</span>
      <span className="rv-field__value" style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
        <span style={{ flex: 1, minWidth: 0 }}>{children ?? '—'}</span>
        {actions}
      </span>
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  change: Cgmp_changes | null;
  allChanges: Cgmp_changes[];
  allProjects: Cgmp_projects[];
  onReviewed: () => void;
}

interface QuickNote {
  _type: 'itops_note';
  text: string;
  savedBy: string;
  savedAt: string;
}

function parseQuickNotes(versionHistory: string | undefined | null): QuickNote[] {
  try {
    const arr: any[] = JSON.parse(versionHistory ?? '[]');
    return arr.filter((e: any) => e._type === 'itops_note') as QuickNote[];
  } catch {
    return [];
  }
}

export default function ReviewPanel({ open, onClose, change, allChanges, allProjects, onReviewed }: Props) {
  const { showToast, currentUserName, currentUserUpn } = useApp();
  const [notes, setNotes] = useState('');
  const [notesError, setNotesError] = useState('');
  const [working, setWorking] = useState<'approve' | 'reject' | 'start-review' | null>(null);
  const [resolvingIdx, setResolvingIdx] = useState<number | null>(null);
  const [resolutionText, setResolutionText] = useState('');
  const [resolving, setResolving] = useState(false);
  const [quickNoteText, setQuickNoteText] = useState('');
  const [quickNoteSaving, setQuickNoteSaving] = useState(false);

  /* Inline field editing */
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editRisk, setEditRisk] = useState('');
  const [editImpact, setEditImpact] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editProjectIds, setEditProjectIds] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setNotes('');
      setNotesError('');
      setResolvingIdx(null);
      setResolutionText('');
      setQuickNoteText('');
      setEditingField(null);
    }
  }, [open]);

  const saveQuickNote = useCallback(async () => {
    if (!change || !quickNoteText.trim()) return;
    setQuickNoteSaving(true);
    try {
      const latest = await Cgmp_changesService.get(change.cgmp_changeid, { select: ['cgmp_versionhistory'] as any });
      const existingHistory = (latest.data as any)?.cgmp_versionhistory ?? change.cgmp_versionhistory;
      const entry: QuickNote = {
        _type: 'itops_note',
        text: quickNoteText.trim(),
        savedBy: currentUserUpn ?? 'IT Ops',
        savedAt: new Date().toISOString(),
      };
      const r = await Cgmp_changesService.update(change.cgmp_changeid, {
        cgmp_versionhistory: appendHistory(existingHistory, entry),
      });
      if (!r.success) throw r.error ?? new Error('Save failed');
      setQuickNoteText('');
      showToast('success', 'Note saved');
      onReviewed();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save note');
    } finally {
      setQuickNoteSaving(false);
    }
  }, [change, quickNoteText, currentUserUpn, showToast, onReviewed]);

  const startEdit = useCallback(
    (field: string) => {
      if (!change) return;
      setEditRisk(String((change.cgmp_risklevel as unknown as number) ?? ''));
      setEditImpact(String((change.cgmp_impactlevel as unknown as number) ?? ''));
      setEditDescription(change.cgmp_description ?? '');
      setEditProjectIds(change.cgmp_projectids ?? '');
      setEditingField(field);
    },
    [change]
  );

  const saveFieldEdit = useCallback(async () => {
    if (!change || !editingField) return;
    setEditSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      if (editingField === 'risk') updates.cgmp_risklevel = parseInt(editRisk) as unknown as Cgmp_changescgmp_risklevel;
      else if (editingField === 'impact')
        updates.cgmp_impactlevel = parseInt(editImpact) as unknown as Cgmp_changescgmp_impactlevel;
      else if (editingField === 'description') updates.cgmp_description = editDescription || undefined;
      else if (editingField === 'projectids') updates.cgmp_projectids = editProjectIds || undefined;
      const r = await Cgmp_changesService.update(
        change.cgmp_changeid,
        updates as Parameters<typeof Cgmp_changesService.update>[1]
      );
      if (!r.success) throw r.error ?? new Error('Save failed');
      Cgmp_auditlogsService.create({
        cgmp_auditlogname: `${change.cgmp_changenumber} field updated via IT Ops`,
        cgmp_entitytype: 100000000 as unknown as Cgmp_auditlogscgmp_entitytype,
        cgmp_eventtype: 100000003 as unknown as Cgmp_auditlogscgmp_eventtype,
        cgmp_entityid: change.cgmp_changeid,
        cgmp_entityname: change.cgmp_changenumber,
        cgmp_username: currentUserName,
        cgmp_useremail: currentUserUpn,
        cgmp_ipaddress: getBrowserInfo(),
        cgmp_newvalues: JSON.stringify({ field: editingField, ...updates }),
      } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch((err) => {
        if (import.meta.env.DEV) console.error('Audit log failed:', err);
      });
      showToast('success', 'Field updated');
      setEditingField(null);
      onReviewed();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Update failed');
    } finally {
      setEditSaving(false);
    }
  }, [change, editingField, editRisk, editImpact, editDescription, editProjectIds, showToast, onReviewed]);

  // G2-24: Secondary review for Critical changes
  const handleSecondaryReview = useCallback(async () => {
    if (!change) return;
    try {
      await Cgmp_changesService.update(change.cgmp_changeid, {
        cgmp_secondaryreviewedby: currentUserUpn,
        cgmp_secondaryreviewedat: new Date().toISOString(),
      } as any);
      showToast('success', 'Secondary review recorded.');
      onReviewed();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Secondary review failed');
    }
  }, [change, currentUserUpn, showToast, onReviewed]);

  const doResolveConcern = useCallback(
    async (concernOriginalTimestamp: string) => {
      if (!change || !resolutionText.trim()) return;
      setResolving(true);
      try {
        let history: any[] = [];
        try {
          history = JSON.parse(change.cgmp_versionhistory ?? '[]');
        } catch {}
        const idx = history.findIndex((e: any) => e._type === 'concern' && e.timestamp === concernOriginalTimestamp);
        if (idx === -1) throw new Error('Concern not found in version history');
        history[idx] = {
          ...history[idx],
          resolvedBy: currentUserUpn,
          resolvedAt: new Date().toISOString(),
          resolution: resolutionText.trim(),
        };
        const r = await Cgmp_changesService.update(change.cgmp_changeid, {
          cgmp_versionhistory: JSON.stringify(history),
        });
        if (!r.success) throw r.error ?? new Error('Save failed');
        showToast('success', 'Concern marked as resolved');
        setResolvingIdx(null);
        setResolutionText('');
        onReviewed();
      } catch (err) {
        showToast('error', err instanceof Error ? err.message : 'Failed to resolve concern');
      } finally {
        setResolving(false);
      }
    },
    [change, resolutionText, currentUserUpn, showToast, onReviewed]
  );

  const handleClose = () => {
    if (notes.trim() && !window.confirm('Discard your review notes?')) return;
    setNotes('');
    setNotesError('');
    onClose();
  };

  const validation: ValidationResult[] = change ? validateForReview(change, allChanges) : [];
  const blocked = hasBlockingErrors(validation);
  const errorCount = validation.filter((v) => v.severity === 'error').length;
  const warnCount = validation.filter((v) => v.severity === 'warning').length;

  const doStartReview = useCallback(async () => {
    if (!change) return;
    setWorking('start-review');
    try {
      const result = await Cgmp_changesService.update(change.cgmp_changeid, {
        cgmp_status: STATUS.UnderReview as unknown as Cgmp_changescgmp_status,
      });
      if (!result.success) throw result.error ?? new Error('Failed to start review');
      Cgmp_auditlogsService.create({
        cgmp_auditlogname: `${change.cgmp_changenumber} Under Review`,
        cgmp_entitytype: 100000000 as unknown as Cgmp_auditlogscgmp_entitytype,
        cgmp_eventtype: 100000003 as unknown as Cgmp_auditlogscgmp_eventtype,
        cgmp_entityid: change.cgmp_changeid,
        cgmp_entityname: change.cgmp_changenumber,
        cgmp_username: currentUserName,
        cgmp_useremail: currentUserUpn,
        cgmp_ipaddress: getBrowserInfo(),
        cgmp_previousvalues: JSON.stringify({ status: 'Published' }),
        cgmp_newvalues: JSON.stringify({ status: 'Under Review', by: currentUserUpn }),
      } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch((err) => {
        if (import.meta.env.DEV) console.error('Audit log failed:', err);
      });
      Cgmp_changehistoryService.create({
        cgmp_actor: currentUserUpn ?? '',
        cgmp_changeid: change.cgmp_changeid,
        cgmp_eventtype: 100000003 as any,
        cgmp_details: JSON.stringify({
          action: 'status_transition',
          from: STATUS.Published,
          to: STATUS.UnderReview,
          transitionName: 'Start Review',
        }),
        cgmp_timestamp: new Date().toISOString(),
      } as any).catch(() => {});
      showToast('success', `${change.cgmp_changenumber} is now Under Review`);
      onReviewed();
      onClose();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to start review');
    } finally {
      setWorking(null);
    }
  }, [change, showToast, onReviewed, onClose, currentUserUpn, currentUserName]);

  const doReview = useCallback(
    async (approve: boolean) => {
      if (!change) return;
      const currentStatus = change.cgmp_status as unknown as number;
      if (currentStatus !== STATUS.UnderReview) {
        showToast('error', 'Only changes in Under Review status can be approved or rejected');
        return;
      }
      if (!approve && !notes.trim()) {
        setNotesError('Review notes are required for rejection');
        return;
      }
      if (approve && blocked) {
        showToast('error', 'Resolve validation errors before approving');
        return;
      }

      setWorking(approve ? 'approve' : 'reject');
      const now = new Date().toISOString();
      try {
        const result = await Cgmp_changesService.update(change.cgmp_changeid, {
          cgmp_status: (approve ? STATUS.Released : STATUS.Draft) as unknown as Cgmp_changescgmp_status,
          cgmp_reviewedby: approve ? currentUserUpn : null,
          cgmp_reviewedat: approve ? now : null,
          cgmp_reviewnotes: notes.trim() || undefined,
        } as any);
        if (!result.success) throw result.error ?? new Error('Review action failed in Dataverse');
        Cgmp_auditlogsService.create({
          cgmp_auditlogname: `${change.cgmp_changenumber} ${approve ? 'Approved' : 'Rejected'}`,
          cgmp_entitytype: 100000000 as unknown as Cgmp_auditlogscgmp_entitytype,
          cgmp_eventtype: (approve ? 100000005 : 100000004) as unknown as Cgmp_auditlogscgmp_eventtype,
          cgmp_entityid: change.cgmp_changeid,
          cgmp_entityname: change.cgmp_changenumber,
          cgmp_username: currentUserName,
          cgmp_useremail: currentUserUpn,
          cgmp_ipaddress: getBrowserInfo(),
          cgmp_previousvalues: JSON.stringify({ status: change.cgmp_statusname }),
          cgmp_newvalues: JSON.stringify({ status: approve ? 'Released' : 'Draft', notes }),
        } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch((err) => {
          if (import.meta.env.DEV) console.error('Audit log failed:', err);
        });
        Cgmp_changehistoryService.create({
          cgmp_actor: currentUserUpn ?? '',
          cgmp_changeid: change.cgmp_changeid,
          cgmp_eventtype: 100000003 as any,
          cgmp_details: JSON.stringify({
            action: 'status_transition',
            from: STATUS.UnderReview,
            to: approve ? STATUS.Released : STATUS.Draft,
            transitionName: approve ? 'Approve & Release' : 'Reject',
          }),
          cgmp_timestamp: now,
        } as any).catch(() => {});

        showToast(
          approve ? 'success' : 'info',
          approve
            ? `${change.cgmp_changenumber} approved and released`
            : `${change.cgmp_changenumber} rejected and returned to Draft`
        );
        onReviewed();
        onClose();
      } catch (err) {
        showToast('error', err instanceof Error ? err.message : 'Review action failed');
      } finally {
        setWorking(null);
      }
    },
    [change, notes, blocked, showToast, onReviewed, onClose, currentUserUpn]
  );

  const currentStatus = change ? (change.cgmp_status as unknown as number) : -1;

  const footer = (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
      <button className="btn btn--outline" onClick={handleClose} disabled={!!working}>
        Cancel
      </button>
      {currentStatus === STATUS.Published && (
        <button className="btn btn--primary" onClick={doStartReview} disabled={!!working}>
          {working === 'start-review' ? 'Starting…' : 'Start Review'}
        </button>
      )}
      {currentStatus === STATUS.UnderReview && (
        <>
          <button className="btn btn--danger" onClick={() => doReview(false)} disabled={!!working}>
            {working === 'reject' ? 'Rejecting…' : 'Reject'}
          </button>
          <button className="btn btn--primary" onClick={() => doReview(true)} disabled={!!working || blocked}>
            {working === 'approve' ? 'Approving…' : 'Approve & Release'}
          </button>
        </>
      )}
    </div>
  );

  /* #23 Scheduling Conflict Alert — Released changes at same location overlapping in time */
  const schedulingConflicts = useMemo(() => {
    if (!change || !change.cgmp_location || !change.cgmp_starttime || !change.cgmp_endtime) return [];
    const startMs = new Date(change.cgmp_starttime).getTime();
    const endMs = new Date(change.cgmp_endtime).getTime();
    return allChanges.filter((c) => {
      if (c.cgmp_changeid === change.cgmp_changeid) return false;
      if ((c.cgmp_status as unknown as number) !== STATUS.Released) return false;
      const changeLocs = (change.cgmp_location ?? '')
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean);
      const cLocs = (c.cgmp_location ?? '')
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean);
      if (!changeLocs.some((loc) => cLocs.includes(loc))) return false;
      if (!c.cgmp_starttime || !c.cgmp_endtime) return false;
      const cStart = new Date(c.cgmp_starttime).getTime();
      const cEnd = new Date(c.cgmp_endtime).getTime();
      return cStart < endMs && cEnd > startMs;
    });
  }, [change, allChanges]);

  if (!change) return null;

  const statusCode = change.cgmp_status as unknown as number;
  const riskCode = change.cgmp_risklevel as unknown as number;

  return (
    <SlidePanel
      open={open}
      onClose={handleClose}
      title={`Review: ${change.cgmp_changenumber}`}
      subtitle={change.cgmp_title}
      width={540}
      footer={footer}
    >
      <div className="review-panel">
        {/* Validation banner */}
        <div
          className={`rv-banner ${blocked ? 'rv-banner--error' : warnCount > 0 ? 'rv-banner--warn' : 'rv-banner--ok'}`}
        >
          {blocked ? (
            <>
              <strong>
                {errorCount} error{errorCount > 1 ? 's' : ''}
              </strong>{' '}
              must be fixed before approval
            </>
          ) : warnCount > 0 ? (
            <>
              <strong>
                {warnCount} warning{warnCount > 1 ? 's' : ''}
              </strong>{' '}
              — approval is allowed
            </>
          ) : (
            <strong>All checks passed — ready to approve</strong>
          )}
        </div>

        {/* Re-review banner — shown when change was previously approved but is no longer Released */}
        {change.cgmp_reviewedby && statusCode !== 100000003 /* Released */ && (
          <div className="rv-rereview-banner">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
            </svg>
            <span>
              <strong>Re-Review Required</strong> — Previously approved by <strong>{change.cgmp_reviewedby}</strong>
              {change.cgmp_reviewedat
                ? ` on ${new Date(change.cgmp_reviewedat).toLocaleDateString(undefined, { timeZone: getDisplayTimezone() })}`
                : ''}
              . The change was modified after approval.
            </span>
          </div>
        )}

        {/* G2-24: Secondary review banner for Critical changes */}
        {(change.cgmp_risklevel as unknown as number) === 100000003 && !(change as any).cgmp_secondaryreviewedby && (
          <div role="alert" className="banner banner--warning">
            ⚠ Critical change requires a second reviewer before handover.
            <button className="btn btn--sm btn--primary" style={{ marginLeft: 8 }} onClick={handleSecondaryReview}>
              Mark as Secondary Reviewed
            </button>
          </div>
        )}

        {/* Validation results */}
        <div className="rv-section">
          <div className="rv-section__title">Validation Checks</div>
          <div className="rv-checks">
            {validation.map((v) => (
              <ValidationRow key={v.field} result={v} />
            ))}
          </div>
        </div>

        {/* Change details */}
        <div className="rv-section">
          <div className="rv-section__title">Change Details</div>
          <div className="rv-grid">
            <RVField label="Status">
              <span className={`badge badge--status ${statusColor(statusCode)}`}>{statusLabel(statusCode)}</span>
            </RVField>
            <RVField
              label="Risk"
              actions={
                editingField === 'risk' ? (
                  <>
                    <button
                      className="btn btn--xs btn--primary"
                      onClick={saveFieldEdit}
                      disabled={editSaving}
                      style={{ padding: '1px 6px' }}
                    >
                      {editSaving ? '…' : '✓'}
                    </button>
                    <button
                      className="btn btn--xs btn--ghost"
                      onClick={() => setEditingField(null)}
                      style={{ padding: '1px 6px' }}
                    >
                      ✕
                    </button>
                  </>
                ) : !editingField ? (
                  <PenBtn onClick={() => startEdit('risk')} />
                ) : null
              }
            >
              {editingField === 'risk' ? (
                <select
                  className="ff-input ff-select"
                  style={{ fontSize: 12, padding: '2px 4px', height: 26, minWidth: 80 }}
                  value={editRisk}
                  onChange={(e) => setEditRisk(e.target.value)}
                >
                  {RISK_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className={`badge badge--risk ${riskColor(riskCode)}`}>{riskLabel(riskCode)}</span>
              )}
            </RVField>
            <RVField label="Category">
              {change.cgmp_categoryname || categoryLabel(change.cgmp_category as unknown as number)}
            </RVField>
            <RVField label="Change Type">
              {change.cgmp_changetypename || changeTypeLabel(change.cgmp_changetype as unknown as number)}
            </RVField>
            <RVField
              label="Impact"
              actions={
                editingField === 'impact' ? (
                  <>
                    <button
                      className="btn btn--xs btn--primary"
                      onClick={saveFieldEdit}
                      disabled={editSaving}
                      style={{ padding: '1px 6px' }}
                    >
                      {editSaving ? '…' : '✓'}
                    </button>
                    <button
                      className="btn btn--xs btn--ghost"
                      onClick={() => setEditingField(null)}
                      style={{ padding: '1px 6px' }}
                    >
                      ✕
                    </button>
                  </>
                ) : !editingField ? (
                  <PenBtn onClick={() => startEdit('impact')} />
                ) : null
              }
            >
              {editingField === 'impact' ? (
                <select
                  className="ff-input ff-select"
                  style={{ fontSize: 12, padding: '2px 4px', height: 26, minWidth: 80 }}
                  value={editImpact}
                  onChange={(e) => setEditImpact(e.target.value)}
                >
                  {IMPACT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                impactLabel(change.cgmp_impactlevel as unknown as number)
              )}
            </RVField>
            <RVField label="Owner">{change.cgmp_createdby || change.owneridname || '—'}</RVField>
            <RVField label="Start">{fmtDate(change.cgmp_starttime)}</RVField>
            <RVField label="End">{fmtDate(change.cgmp_endtime)}</RVField>
            <RVField label="Location">{change.cgmp_location || '—'}</RVField>
            <RVField label="Region">{change.cgmp_region || '—'}</RVField>
            {change.cgmp_isemergency && (
              <RVField label="Emergency">
                <span className="badge badge--risk risk-critical">Emergency</span>
              </RVField>
            )}
          </div>
        </div>

        {/* Scheduling Conflict Alert (#23) */}
        {schedulingConflicts.length > 0 && (
          <div
            className="rv-section"
            style={{
              border: '1px solid var(--danger)',
              borderRadius: 6,
              padding: 10,
              background: 'var(--danger-bg, rgba(220,53,69,0.05))',
            }}
          >
            <div className="rv-section__title" style={{ color: 'var(--danger)' }}>
              ⚠ Scheduling Conflict — {schedulingConflicts.length} Released Change
              {schedulingConflicts.length > 1 ? 's' : ''} at Same Location
            </div>
            {schedulingConflicts.map((c) => (
              <div
                key={c.cgmp_changeid}
                style={{
                  fontSize: 12,
                  padding: '4px 0',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ fontWeight: 600 }}>{c.cgmp_changenumber}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{c.cgmp_title?.slice(0, 40)}</span>
                <span style={{ color: 'var(--text-tertiary)' }}>
                  {fmtDate(c.cgmp_starttime)} – {fmtDate(c.cgmp_endtime)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Description — always shown so IT Ops can edit even if empty */}
        <div className="rv-section">
          <div
            className="rv-section__title"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <span>Description</span>
            {editingField === 'description' ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn--xs btn--primary" onClick={saveFieldEdit} disabled={editSaving}>
                  {editSaving ? 'Saving…' : 'Save'}
                </button>
                <button className="btn btn--xs btn--ghost" onClick={() => setEditingField(null)}>
                  Cancel
                </button>
              </div>
            ) : !editingField ? (
              <PenBtn onClick={() => startEdit('description')} title="Edit description" />
            ) : null}
          </div>
          {editingField === 'description' ? (
            <textarea
              className="ff-input ff-textarea"
              rows={4}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              style={{ fontSize: 13, width: '100%', marginTop: 4 }}
              autoFocus
            />
          ) : (
            <p
              className="rv-text"
              style={{
                color: change.cgmp_description ? undefined : 'var(--text-tertiary)',
                fontStyle: change.cgmp_description ? undefined : 'italic',
              }}
            >
              {change.cgmp_description || 'No description'}
            </p>
          )}
        </div>

        {/* Impacted Projects — with pen-icon inline edit */}
        <div className="rv-section">
          <div
            className="rv-section__title"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <span>Impacted Projects</span>
            {editingField === 'projectids' ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn--xs btn--primary" onClick={saveFieldEdit} disabled={editSaving}>
                  {editSaving ? 'Saving…' : 'Save'}
                </button>
                <button className="btn btn--xs btn--ghost" onClick={() => setEditingField(null)}>
                  Cancel
                </button>
              </div>
            ) : !editingField ? (
              <PenBtn onClick={() => startEdit('projectids')} title="Edit impacted projects" />
            ) : null}
          </div>
          {editingField === 'projectids' ? (
            <div style={{ marginTop: 6 }}>
              <ProjectMultiSelect projects={allProjects} value={editProjectIds} onChange={setEditProjectIds} />
            </div>
          ) : change.cgmp_projectids ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
              {change.cgmp_projectids
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
                .map((id) => {
                  const proj = allProjects.find((p) => p.cgmp_projectid === id);
                  return (
                    <span key={id} className="rv-text" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        style={{ color: 'var(--primary)', flexShrink: 0 }}
                      >
                        <path d="M20 6h-2.18c.07-.44.18-.88.18-1.34 0-2.58-2.09-4.66-4.66-4.66-1.55 0-2.96.76-3.84 1.94L8 3.62l-1.5-1.68C5.62 1.01 4.22.36 2.66.36 0 .36-2.01 2.44-2.01 5.02c0 .46.11.9.18 1.34H-2v2h22V6z" />
                      </svg>
                      {proj ? (
                        proj.cgmp_name
                      ) : (
                        <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>{id}</span>
                      )}
                    </span>
                  );
                })}
            </div>
          ) : (
            <p className="rv-text" style={{ color: 'var(--text-tertiary)', fontStyle: 'italic', marginTop: 4 }}>
              No impacted projects
            </p>
          )}
        </div>

        {/* Project Concerns */}
        {(() => {
          const concerns = parseConcerns(change.cgmp_versionhistory);
          if (concerns.length === 0) return null;
          const unresolvedCount = concerns.filter((c) => !c.resolvedAt).length;
          return (
            <div className="rv-section" style={{ marginTop: 16 }}>
              <div className="rv-section__title">
                Project Concerns ({concerns.length})
                {unresolvedCount > 0 && (
                  <span style={{ marginLeft: 6, color: 'var(--danger)', fontSize: 11 }}>• {unresolvedCount} open</span>
                )}
              </div>
              {concerns.map((ce, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 12,
                    padding: '8px 10px',
                    borderRadius: 4,
                    marginBottom: 4,
                    background: 'var(--surface-alt)',
                    borderLeft: `3px solid ${ce.resolvedAt ? 'var(--success)' : (CONCERN_COLORS[ce.concernType] ?? 'var(--border)')}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <strong>{ce.projectName}</strong>
                      {' — '}
                      <span style={{ color: CONCERN_COLORS[ce.concernType] }}>
                        {CONCERN_LABELS[ce.concernType] ?? ce.concernType}
                      </span>
                      {(() => {
                        const effectiveSev = ce.severity ?? CONCERN_TYPE_SEVERITY[ce.concernType];
                        return (
                          <span
                            className={`badge badge--${severityClass(effectiveSev)}`}
                            style={{ fontSize: 10, padding: '1px 5px', marginRight: 4 }}
                          >
                            {severityLabel(effectiveSev)}
                          </span>
                        );
                      })()}
                      {ce.remarks && <span style={{ color: 'var(--text-secondary)' }}>: {ce.remarks}</span>}
                      <div style={{ color: 'var(--text-tertiary)', fontSize: 11, marginTop: 2 }}>
                        Raised by {ce.raisedBy} · {fmtDate(ce.timestamp)}
                      </div>
                      {ce.resolvedAt && (
                        <div style={{ color: 'var(--success)', fontSize: 11, marginTop: 2 }}>
                          ✓ Resolved by {ce.resolvedBy} · {ce.resolution}
                        </div>
                      )}
                      {resolvingIdx === i && (
                        <div
                          style={{
                            marginTop: 6,
                            display: 'flex',
                            gap: 6,
                            alignItems: 'flex-start',
                            flexDirection: 'column',
                          }}
                        >
                          <textarea
                            className="ff-input ff-textarea"
                            rows={2}
                            placeholder="Describe the resolution…"
                            value={resolutionText}
                            onChange={(e) => setResolutionText(e.target.value)}
                            style={{ fontSize: 12, width: '100%' }}
                          />
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              className="btn btn--xs btn--primary"
                              onClick={() => doResolveConcern(ce.timestamp)}
                              disabled={resolving || !resolutionText.trim()}
                            >
                              {resolving ? 'Saving…' : 'Confirm Resolve'}
                            </button>
                            <button
                              className="btn btn--xs btn--ghost"
                              onClick={() => {
                                setResolvingIdx(null);
                                setResolutionText('');
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    {!ce.resolvedAt && resolvingIdx !== i && (
                      <button
                        className="btn btn--xs btn--outline"
                        onClick={() => {
                          setResolvingIdx(i);
                          setResolutionText('');
                        }}
                      >
                        Resolve
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* IT Ops Quick Notes */}
        <div className="rv-section" style={{ marginTop: 16 }}>
          <div className="rv-section__title">
            IT Ops Quick Notes <span className="rv-section__hint"> — internal, not visible to PMO</span>
          </div>
          {parseQuickNotes(change.cgmp_versionhistory).map((qn, i) => (
            <div
              key={i}
              style={{
                fontSize: 12,
                padding: '6px 10px',
                background: 'var(--surface-alt)',
                borderRadius: 4,
                marginBottom: 6,
                borderLeft: '3px solid var(--primary)',
              }}
            >
              <div style={{ color: 'var(--text-primary)' }}>{qn.text}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11, marginTop: 2 }}>
                {qn.savedBy} · {fmtDate(qn.savedAt)}
              </div>
            </div>
          ))}
          <textarea
            className="ff-input ff-textarea"
            rows={2}
            value={quickNoteText}
            onChange={(e) => setQuickNoteText(e.target.value)}
            placeholder="Add an internal note visible only to IT Ops…"
            style={{ fontSize: 12, width: '100%', marginTop: 4 }}
          />
          <button
            className="btn btn--xs btn--primary"
            style={{ marginTop: 6 }}
            disabled={!quickNoteText.trim() || quickNoteSaving}
            onClick={saveQuickNote}
          >
            {quickNoteSaving ? 'Saving…' : 'Save Note'}
          </button>
        </div>

        {/* Attachments */}
        <div className="rv-section">
          <AttachmentPanel objectId={change.cgmp_changeid} />
        </div>

        {/* Review notes */}
        <div className="rv-section">
          <label htmlFor="rv-notes" className="rv-section__title">
            Review Notes
            <span className="rv-section__hint"> — required for rejection</span>
          </label>
          <textarea
            id="rv-notes"
            className={`ff-input ff-textarea ${notesError ? 'ff-input--error' : ''}`}
            rows={4}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setNotesError('');
            }}
            placeholder="Add review notes, comments, or rejection reason…"
          />
          {notesError && <span className="ff-error">{notesError}</span>}
        </div>
      </div>
    </SlidePanel>
  );
}
