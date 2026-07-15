import { useState, useEffect } from 'react';
import { SlidePanel } from '../ui/Modal';
import { getBrowserInfo } from '../../utils/format';
import { useApp } from '../../context/AppContext';
import { Cgmp_bridgesService, Cgmp_auditlogsService, Cgmp_changesService } from '../../generated';
import type { Cgmp_bridges } from '../../generated/models/Cgmp_bridgesModel';
import type { Cgmp_bridgescgmp_status } from '../../generated/models/Cgmp_bridgesModel';
import type { Cgmp_auditlogsBase } from '../../generated/models/Cgmp_auditlogsModel';
import { BRIDGE_STATUS, bridgeStatusLabel, ROLES } from '../../hooks/useDataverse';
import { asAuditEntityType, asAuditEventType, asPirStatus } from '../../utils/optionSets';

type PirTab = 'pir' | 'lessons' | 'closure' | 'downtime';

interface Props {
  open: boolean;
  onClose: () => void;
  bridge: Cgmp_bridges | null;
  onUpdated: () => void;
  changeId?: string;
}

export default function PIRForm({ open, onClose, bridge, onUpdated, changeId }: Props) {
  const { showToast, currentUserName, currentUserUpn, userProfile } = useApp();
  const userRole = Number(userProfile?.cgmp_role);
  const [tab, setTab] = useState<PirTab>('pir');
  const [pirNotes, setPirNotes] = useState('');
  const [lessonsLearned, setLessonsLearned] = useState('');
  const [closureRemarks, setClosureRemarks] = useState('');
  const [downtimeMinutes, setDowntimeMinutes] = useState('');
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState<'completed' | 'failed' | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelInput, setShowCancelInput] = useState(false);

  useEffect(() => {
    if (open && bridge) {
      setPirNotes(bridge.cgmp_pirnotes ?? '');
      setLessonsLearned(bridge.cgmp_lessonslearned ?? '');
      setClosureRemarks(bridge.cgmp_closureremarks ?? '');
      setDowntimeMinutes(bridge.cgmp_downtimeminutes != null ? String(bridge.cgmp_downtimeminutes) : '');
      setTab('pir');
    }
  }, [open, bridge]);

  const handleSave = async () => {
    if (!bridge) return;
    if (userRole !== ROLES.GIICC && userRole !== ROLES.Admin) {
      showToast('error', 'Only GIICC team members can save PIR notes');
      return;
    }
    if (downtimeMinutes !== '') {
      const minutes = parseInt(downtimeMinutes, 10);
      if (isNaN(minutes) || minutes < 0 || minutes > 10080) {
        showToast('error', 'Downtime must be between 0 and 10,080 minutes (7 days)');
        return;
      }
    }
    setSaving(true);
    try {
      const r = await Cgmp_bridgesService.update(bridge.cgmp_bridgeid, {
        cgmp_pirnotes: pirNotes.trim() || undefined,
        cgmp_lessonslearned: lessonsLearned.trim() || undefined,
        cgmp_closureremarks: closureRemarks.trim() || undefined,
        cgmp_downtimeminutes: downtimeMinutes ? parseInt(downtimeMinutes) : undefined,
      });
      if (!r.success) throw r.error ?? new Error('Failed to save PIR');
      if (changeId) {
        Cgmp_changesService.update(changeId, { cgmp_pirstatus: asPirStatus(100000001) }).catch(() => {});
      }
      showToast('success', 'PIR saved');
      onUpdated();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save PIR');
    } finally { setSaving(false); }
  };

  const handleClose = async (outcome: 'completed' | 'failed') => {
    if (!bridge) return;
    if (userRole !== ROLES.GIICC && userRole !== ROLES.Admin) {
      showToast('error', 'Only GIICC team members can close a bridge');
      return;
    }
    if (downtimeMinutes !== '') {
      const minutes = parseInt(downtimeMinutes, 10);
      if (isNaN(minutes) || minutes < 0 || minutes > 10080) {
        showToast('error', 'Downtime must be between 0 and 10,080 minutes (7 days)');
        return;
      }
    }
    setClosing(outcome);
    const newStatus = outcome === 'completed' ? BRIDGE_STATUS.Completed : BRIDGE_STATUS.Failed;
    try {
      const now = new Date().toISOString();
      const r2 = await Cgmp_bridgesService.update(bridge.cgmp_bridgeid, {
        cgmp_status: newStatus as unknown as Cgmp_bridgescgmp_status,
        cgmp_actualend: bridge.cgmp_actualend ?? now,
        cgmp_pirnotes: pirNotes.trim() || undefined,
        cgmp_lessonslearned: lessonsLearned.trim() || undefined,
        cgmp_closureremarks: closureRemarks.trim() || undefined,
        cgmp_downtimeminutes: downtimeMinutes ? parseInt(downtimeMinutes) : undefined,
      });
      if (!r2.success) throw r2.error ?? new Error('Failed to close bridge');
      Cgmp_auditlogsService.create({
        cgmp_auditlogname: `Bridge ${outcome === 'completed' ? 'Completed' : 'Failed'}: ${bridge.cgmp_title}`,
        cgmp_entitytype: asAuditEntityType(100000002),
        cgmp_eventtype: asAuditEventType(outcome === 'completed' ? 100000013 : 100000008),
        cgmp_entityid: bridge.cgmp_bridgeid,
        cgmp_entityname: bridge.cgmp_title,
        cgmp_username: currentUserName,
        cgmp_useremail: currentUserUpn,
        cgmp_ipaddress: getBrowserInfo(),
        cgmp_previousvalues: JSON.stringify({ status: bridgeStatusLabel(bridge.cgmp_status as unknown as number) }),
        cgmp_newvalues: JSON.stringify({ status: outcome, downtimeMinutes }),
      } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch(err => { if (import.meta.env.DEV) console.error('Audit log failed:', err); });
      showToast(outcome === 'completed' ? 'success' : 'error', `Bridge ${outcome}`);
      onUpdated();
      onClose();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to close bridge');
    } finally { setClosing(null); }
  };

  const bridgeStatus = bridge ? (bridge.cgmp_status as unknown as number) : -1;
  const canClose = bridgeStatus === BRIDGE_STATUS.InProgress;
  const canCancel = bridgeStatus === BRIDGE_STATUS.Scheduled;

  const handleCancelBridge = async () => {
    if (!bridge) return;
    if (!cancelReason.trim()) { showToast('error', 'Cancellation reason is required.'); return; }
    setCancelling(true);
    try {
      const existing = bridge.cgmp_pirnotes ?? '';
      const cancelNote = existing ? `[CANCELLED: ${cancelReason.trim()}]\n${existing}` : `Cancelled: ${cancelReason.trim()}`;
      const r = await Cgmp_bridgesService.update(bridge.cgmp_bridgeid, {
        cgmp_status: BRIDGE_STATUS.Cancelled as unknown as Cgmp_bridgescgmp_status,
        cgmp_rollbackreason: cancelReason.trim(),
        cgmp_pirnotes: cancelNote,
      });
      if (!r.success) throw r.error ?? new Error('Failed to cancel bridge');
      showToast('success', 'Bridge cancelled');
      onUpdated();
      onClose();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to cancel bridge');
    } finally { setCancelling(false); setShowCancelInput(false); setCancelReason(''); }
  };

  const footer = (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', width: '100%' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {canCancel && (
          <>
            {showCancelInput ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  className="ff-input"
                  style={{ fontSize: 12, padding: '4px 8px', minWidth: 200 }}
                  placeholder="Cancellation reason (required)"
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  autoFocus
                />
                <button className="btn btn--xs btn--danger" onClick={handleCancelBridge} disabled={cancelling || !cancelReason.trim()}>
                  {cancelling ? 'Cancelling…' : 'Confirm Cancel'}
                </button>
                <button className="btn btn--xs btn--outline" onClick={() => { setShowCancelInput(false); setCancelReason(''); }}>
                  Back
                </button>
              </div>
            ) : (
              <button className="btn btn--outline" onClick={() => setShowCancelInput(true)} disabled={cancelling || saving}>
                Cancel Bridge
              </button>
            )}
          </>
        )}
        {canClose && (
          <>
            <button className="btn btn--danger" onClick={() => handleClose('failed')} disabled={!!closing}>
              {closing === 'failed' ? 'Closing…' : 'Close as Failed'}
            </button>
            <button className="btn btn--secondary" onClick={() => handleClose('completed')} disabled={!!closing}>
              {closing === 'completed' ? 'Closing…' : 'Close as Completed'}
            </button>
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn--outline" onClick={onClose} disabled={saving || !!closing || cancelling}>Cancel</button>
        <button
          className="btn btn--primary"
          onClick={handleSave}
          disabled={saving || !!closing || !pirNotes.trim()}
          title={!pirNotes.trim() ? 'PIR Notes are required before saving' : undefined}
        >
          {saving ? 'Saving…' : 'Save PIR'}
        </button>
      </div>
    </div>
  );

  if (!bridge) return null;

  return (
    <SlidePanel open={open} onClose={onClose} title="PIR & Closure" subtitle={bridge.cgmp_title} width={560} footer={footer}>
      <div className="pir-panel">
        {/* PIR tabs */}
        <div className="pir-tabs">
          {([
            { id: 'pir', label: 'PIR Notes' },
            { id: 'lessons', label: 'Lessons Learned' },
            { id: 'closure', label: 'Closure Remarks' },
            { id: 'downtime', label: 'Downtime' },
          ] as { id: PirTab; label: string }[]).map(t => (
            <button key={t.id} className={`pir-tab ${tab === t.id ? 'pir-tab--active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="pir-body">
          {tab === 'pir' && (
            <div className="ff-group">
              <label className="ff-label">Post-Implementation Review Notes <span className="ff-required">*</span></label>
              <textarea
                className="ff-input ff-textarea pir-textarea"
                rows={12}
                value={pirNotes}
                onChange={e => setPirNotes(e.target.value)}
                placeholder="Document what happened during the change window, any issues encountered, and how they were resolved…"
              />
              {!pirNotes.trim() && <span className="ff-error">PIR Notes are required before saving.</span>}
            </div>
          )}
          {tab === 'lessons' && (
            <div className="ff-group">
              <label className="ff-label">Lessons Learned</label>
              <textarea
                className="ff-input ff-textarea pir-textarea"
                rows={12}
                value={lessonsLearned}
                onChange={e => setLessonsLearned(e.target.value)}
                placeholder="Document what went well, what could be improved, and recommendations for future changes…"
              />
            </div>
          )}
          {tab === 'closure' && (
            <div className="ff-group">
              <label className="ff-label">Closure Remarks</label>
              <textarea
                className="ff-input ff-textarea pir-textarea"
                rows={12}
                value={closureRemarks}
                onChange={e => setClosureRemarks(e.target.value)}
                placeholder="Final closure comments and sign-off notes…"
              />
            </div>
          )}
          {tab === 'downtime' && (
            <div style={{ padding: '8px 0' }}>
              <div className="ff-group">
                <label className="ff-label">Total Downtime (minutes)</label>
                <input
                  type="number"
                  className="ff-input"
                  value={downtimeMinutes}
                  onChange={e => setDowntimeMinutes(e.target.value)}
                  placeholder="Enter total downtime in minutes"
                  min={0}
                  max={10080}
                  aria-describedby="pir-downtime-hint"
                  style={{ maxWidth: 200 }}
                />
                <span id="pir-downtime-hint" className="ff-hint">Enter downtime in minutes (0–10,080 max / 7 days)</span>
              </div>
              {downtimeMinutes && (
                <div className="pir-downtime-display">
                  {Math.floor(parseInt(downtimeMinutes) / 60)}h {parseInt(downtimeMinutes) % 60}m total downtime
                </div>
              )}
              <div className="pir-hint">
                Record the total cumulative downtime experienced across all affected systems during this change window.
              </div>
            </div>
          )}
        </div>
      </div>
    </SlidePanel>
  );
}
