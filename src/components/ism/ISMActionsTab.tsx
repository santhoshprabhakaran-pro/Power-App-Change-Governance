import { useState, useCallback } from 'react';
import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';
import type { Cgmp_projects } from '../../generated/models/Cgmp_projectsModel';
import type { Systemusers } from '../../generated/models/SystemusersModel';
import {
  STATUS, statusLabel, statusColor,
  isIsmFrozen, daysUntilIsmFreeze,
} from '../../hooks/useDataverse';
import { Cgmp_changesService, Cgmp_notificationsService, Cgmp_projectsService } from '../../generated';
import { appendHistory } from '../../utils/business';
import { getDisplayTimezone } from '../../utils/format';
import { asNotifCategory, asNotifPriority } from '../../utils/optionSets';
import { SlidePanel } from '../ui/Modal';
import FilteredSelect from '../ui/FilteredSelect';

/* ─── Props ─────────────────────────────────────────────────────── */

export interface ISMActionsTabProps {
  /** Pre-computed action items sorted by urgency */
  actionItems: Array<{
    change: Cgmp_changes;
    projects: Cgmp_projects[];
    urgency: 'critical' | 'warning' | 'info';
    daysToFreeze: number | null;
    frozen: boolean;
  }>;
  changes: Cgmp_changes[];
  ismProjects: Cgmp_projects[];
  systemUsers: Systemusers[];
  currentUserName: string;
  currentUserUpn: string;
  userProfileId?: string;
  showToast: (type: 'success' | 'error' | 'info' | 'warning', msg: string) => void;
  onRefresh: () => void;
}

/* ─── ISM Sign-Off Panel (new feature) ──────────────────────────── */

function ISMSignOffPanel({
  changes,
  currentUserName,
  showToast,
  onRefresh,
}: {
  changes: Cgmp_changes[];
  currentUserName: string;
  showToast: (type: 'success' | 'error' | 'info' | 'warning', msg: string) => void;
  onRefresh: () => void;
}) {
  const [selectedChangeId, setSelectedChangeId] = useState('');
  const [signOffNotes, setSignOffNotes] = useState('');
  const [signing, setSigning] = useState(false);

  const eligibleChanges = changes.filter(c => {
    const s = c.cgmp_status as unknown as number;
    return s === STATUS.Released || s === STATUS.UATUpdates;
  });

  const eligibleOptions = eligibleChanges.map(c => ({
    value: c.cgmp_changeid,
    label: `${c.cgmp_changenumber ?? '—'} — ${c.cgmp_title ?? ''}`,
  }));

  const handleSignOff = useCallback(async () => {
    if (!selectedChangeId) return;
    const change = changes.find(c => c.cgmp_changeid === selectedChangeId);
    if (!change) return;
    setSigning(true);
    try {
      const newHistory = appendHistory(change.cgmp_versionhistory, {
        _type: 'ism-signoff',
        at: new Date().toISOString(),
        by: currentUserName,
        notes: signOffNotes.trim() || undefined,
      });
      const r = await Cgmp_changesService.update(selectedChangeId, { cgmp_versionhistory: newHistory });
      if (!r.success) throw r.error ?? new Error('Update failed');
      showToast('success', 'ISM sign-off recorded.');
      setSelectedChangeId('');
      setSignOffNotes('');
      onRefresh();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to record sign-off');
    } finally {
      setSigning(false);
    }
  }, [selectedChangeId, signOffNotes, changes, currentUserName, showToast, onRefresh]);

  return (
    <div className="ism-action-section">
      <div className="ism-action-section__title">ISM Sign-Off</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520 }}>
        <div className="ff-group">
          <label className="ff-label">Select Change to Sign Off</label>
          {eligibleChanges.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
              No changes in Released or UAT Updates status available for sign-off.
            </div>
          ) : (
            <FilteredSelect
              options={eligibleOptions}
              value={selectedChangeId}
              onChange={setSelectedChangeId}
              placeholder="— Search and select a change —"
            />
          )}
        </div>
        {selectedChangeId && (
          <>
            <div className="ff-group">
              <label className="ff-label">Notes (optional)</label>
              <textarea
                className="ff-input ff-textarea"
                rows={3}
                placeholder="Add any sign-off notes or observations…"
                value={signOffNotes}
                onChange={e => setSignOffNotes(e.target.value)}
              />
            </div>
            <button
              className="btn btn--primary"
              style={{ alignSelf: 'flex-start' }}
              onClick={handleSignOff}
              disabled={signing}
            >
              {signing ? 'Signing…' : 'Sign Off UAT'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Handover Wizard ─────────────────────────────────────────────── */

function HandoverPanel({
  open,
  onClose,
  ismProjects,
  systemUsers,
  currentUserName,
  userProfileId,
  showToast,
  onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  ismProjects: Cgmp_projects[];
  systemUsers: Systemusers[];
  currentUserName: string;
  userProfileId?: string;
  showToast: (type: 'success' | 'error' | 'info' | 'warning', msg: string) => void;
  onRefresh: () => void;
}) {
  const [handoverTargetId, setHandoverTargetId] = useState('');
  const [handoverStartDate, setHandoverStartDate] = useState('');
  const [handoverEndDate, setHandoverEndDate] = useState('');
  const [handoverNotes, setHandoverNotes] = useState('');
  const [handoverSaving, setHandoverSaving] = useState(false);

  const handleHandover = useCallback(async () => {
    if (!handoverTargetId || !handoverStartDate || !handoverEndDate) {
      showToast('error', 'Target ISM, start date, and end date are required');
      return;
    }
    setHandoverSaving(true);
    try {
      const myProjects = ismProjects;
      if (myProjects.length === 0) {
        showToast('info', 'No projects found where you are the primary ISM');
        onClose();
        return;
      }
      const handoverEntry = {
        _type: 'handover',
        from: userProfileId, to: handoverTargetId,
        startDate: handoverStartDate, endDate: handoverEndDate,
        notes: handoverNotes, createdAt: new Date().toISOString(),
      };
      await Promise.all(myProjects.map(p =>
        Cgmp_projectsService.update(p.cgmp_projectid, {
          cgmp_backupismid: handoverTargetId,
          cgmp_ownershiphistory: JSON.stringify([
            ...(() => { try { return JSON.parse(p.cgmp_ownershiphistory ?? '[]'); } catch { return []; } })(),
            handoverEntry,
          ]),
        } as never)
      ));

      const startFmt = new Date(handoverStartDate).toLocaleDateString(undefined, { timeZone: getDisplayTimezone() });
      const endFmt = new Date(handoverEndDate).toLocaleDateString(undefined, { timeZone: getDisplayTimezone() });
      Cgmp_notificationsService.create({
        cgmp_title: `ISM Handover — ${myProjects.length} project${myProjects.length !== 1 ? 's' : ''} assigned to you`,
        cgmp_message: `${currentUserName} has handed over ${myProjects.length} project${myProjects.length !== 1 ? 's' : ''} to you as backup ISM from ${startFmt} to ${endFmt}.${handoverNotes ? ` Notes: ${handoverNotes}` : ''}`,
        cgmp_category: asNotifCategory(100000002),
        cgmp_priority: asNotifPriority(100000001),
        cgmp_recipientid: handoverTargetId,
        cgmp_isdismissed: false,
        cgmp_isread: false,
        cgmp_actionurl: '#pmo',
        statecode: 0 as never,
      } as never).catch(err => { if (import.meta.env.DEV) console.error('Background notification failed:', err); });

      showToast('success', `Handover configured for ${myProjects.length} project${myProjects.length > 1 ? 's' : ''}`);
      onClose();
      setHandoverTargetId(''); setHandoverStartDate(''); setHandoverEndDate(''); setHandoverNotes('');
      onRefresh();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Handover failed');
    } finally { setHandoverSaving(false); }
  }, [handoverTargetId, handoverStartDate, handoverEndDate, handoverNotes, ismProjects, currentUserName, userProfileId, showToast, onClose, onRefresh]);

  return (
    <SlidePanel
      open={open}
      onClose={onClose}
      title="ISM Handover"
      subtitle="Transfer project responsibility to a backup ISM"
      width={400}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={handleHandover} disabled={handoverSaving}>
            {handoverSaving ? 'Saving…' : 'Confirm Handover'}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' }}>
        <div className="ff-group">
          <label className="ff-label">Backup ISM <span className="ff-required">*</span></label>
          <select className="ff-input ff-select" value={handoverTargetId} onChange={e => setHandoverTargetId(e.target.value)}>
            <option value="">Select ISM…</option>
            {systemUsers.map(u => (
              <option key={u.systemuserid} value={u.systemuserid}>{u.fullname ?? u.domainname}</option>
            ))}
          </select>
        </div>
        <div className="ff-row">
          <div className="ff-group">
            <label className="ff-label">Handover Start <span className="ff-required">*</span></label>
            <input type="date" className="ff-input" value={handoverStartDate} onChange={e => setHandoverStartDate(e.target.value)} />
          </div>
          <div className="ff-group">
            <label className="ff-label">Handover End <span className="ff-required">*</span></label>
            <input type="date" className="ff-input" value={handoverEndDate} onChange={e => setHandoverEndDate(e.target.value)} />
          </div>
        </div>
        <div className="ff-group">
          <label className="ff-label">Notes</label>
          <textarea className="ff-input ff-textarea" rows={3} value={handoverNotes}
            onChange={e => setHandoverNotes(e.target.value)}
            placeholder="Add handover notes, special instructions, ongoing issues…" />
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'var(--surface-alt)', padding: '8px 10px', borderRadius: 6 }}>
          This will update all {ismProjects.length} of your assigned projects to record this backup ISM assignment.
        </div>
      </div>
    </SlidePanel>
  );
}

/* ─── Urgency Label (accessible emoji + screen-reader text) ──────── */

function UrgencyLabel({ emoji, label }: { emoji: string; label: string }) {
  return <><span aria-hidden="true">{emoji}</span><span> {label}</span></>;
}

/* ─── Main Tab Component ─────────────────────────────────────────── */

export default function ISMActionsTab({
  actionItems,
  changes,
  ismProjects,
  systemUsers,
  currentUserName,
  userProfileId,
  showToast,
  onRefresh,
}: ISMActionsTabProps) {
  const [handoverOpen, setHandoverOpen] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* ── Action items list ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>My Action Items</h3>
          <button className="btn btn--outline btn--sm" onClick={() => setHandoverOpen(true)}>
            ↔ Handover
          </button>
        </div>

        {actionItems.length === 0 ? (
          <div className="ism-empty">No pending action items. All changes are on track.</div>
        ) : (
          <div className="ism-action-list">
            <div className="ism-action-summary">
              {actionItems.filter(i => i.urgency === 'critical').length > 0 && (
                <span className="ism-action-badge ism-action-badge--critical">
                  {actionItems.filter(i => i.urgency === 'critical').length} Critical
                </span>
              )}
              {actionItems.filter(i => i.urgency === 'warning').length > 0 && (
                <span className="ism-action-badge ism-action-badge--warning">
                  {actionItems.filter(i => i.urgency === 'warning').length} Warning
                </span>
              )}
              {actionItems.filter(i => i.urgency === 'info').length > 0 && (
                <span className="ism-action-badge ism-action-badge--info">
                  {actionItems.filter(i => i.urgency === 'info').length} Info
                </span>
              )}
            </div>
            {actionItems.map(({ change: c, projects, urgency, daysToFreeze, frozen }) => {
              const sc = c.cgmp_status as unknown as number;
              return (
                <div key={c.cgmp_changeid} className={`ism-action-card ism-action-card--${urgency}`}>
                  <div className="ism-action-card__left">
                    <span className={`ism-action-urgency ism-action-urgency--${urgency}`}>
                      {urgency === 'critical' ? <UrgencyLabel emoji="🔴" label="Critical" /> :
                       urgency === 'warning' ? <UrgencyLabel emoji="🟡" label="Warning" /> :
                       <UrgencyLabel emoji="🔵" label="Info" />}
                    </span>
                    <span className="change-number">{c.cgmp_changenumber}</span>
                    <span className="ism-action-title">{c.cgmp_title}</span>
                  </div>
                  <div className="ism-action-card__right">
                    <span className={`badge badge--status ${statusColor(sc)}`}>{statusLabel(sc)}</span>
                    {frozen ? (
                      <span className="sla-chip sla-chip--red">UAT Frozen</span>
                    ) : daysToFreeze !== null ? (
                      <span className={`sla-chip ${daysToFreeze <= 3 ? 'sla-chip--red' : daysToFreeze <= 7 ? 'sla-chip--amber' : 'sla-chip--green'}`}>
                        {daysToFreeze}d to freeze
                      </span>
                    ) : null}
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {projects.length} project{projects.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── ISM Sign-Off section ── */}
      <ISMSignOffPanel
        changes={changes}
        currentUserName={currentUserName}
        showToast={showToast}
        onRefresh={onRefresh}
      />

      {/* ── Handover Panel ── */}
      <HandoverPanel
        open={handoverOpen}
        onClose={() => setHandoverOpen(false)}
        ismProjects={ismProjects}
        systemUsers={systemUsers}
        currentUserName={currentUserName}
        userProfileId={userProfileId}
        showToast={showToast}
        onRefresh={onRefresh}
      />
    </div>
  );
}

/* Re-export helpers used by ISMWorkspace parent for KPI display */
export { isIsmFrozen, daysUntilIsmFreeze };
