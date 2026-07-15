import { useState, useEffect } from 'react';
import { SlidePanel } from '../ui/Modal';
import { useApp } from '../../context/AppContext';
import { Cgmp_bridgesService, Cgmp_auditlogsService, Cgmp_changesService, Cgmp_changehistoryService } from '../../generated';
import type { Cgmp_bridges } from '../../generated/models/Cgmp_bridgesModel';
import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';
import type { Cgmp_bridgescgmp_status } from '../../generated/models/Cgmp_bridgesModel';
import type { Cgmp_auditlogsBase } from '../../generated/models/Cgmp_auditlogsModel';
import { BRIDGE_STATUS, bridgeStatusLabel } from '../../hooks/useDataverse';
import { asAuditEntityType, asAuditEventType, asStatus } from '../../utils/optionSets';
import { useProjects } from '../../hooks/useDataverse';
import { getBrowserInfo } from '../../utils/format';

interface ProjectStatus {
  projectId: string;
  projectName: string;
  status: string;
  notes: string;
}

interface BridgeExecutionData {
  projects: ProjectStatus[];
  impactedServices?: string;
}

function parseBridgeExecutionData(json: string | undefined): BridgeExecutionData {
  if (!json?.trim()) return { projects: [] };
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return { projects: parsed as ProjectStatus[] };
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.projects)) return parsed as BridgeExecutionData;
  } catch { /* fall through */ }
  return { projects: [] };
}

const PROJECT_STATUS_OPTIONS = ['On Track', 'At Risk', 'Delayed', 'Completed', 'Failed', 'Rolled Back'];

interface Props {
  open: boolean;
  onClose: () => void;
  bridge: Cgmp_bridges | null;
  onUpdated: () => void;
  allChanges: Cgmp_changes[];
}

export default function BridgeExecution({ open, onClose, bridge, onUpdated, allChanges }: Props) {
  const { showToast, currentUserName, currentUserUpn } = useApp();
  const { projects } = useProjects();
  const [actualStart, setActualStart] = useState('');
  const [actualEnd, setActualEnd] = useState('');
  const [rollback, setRollback] = useState(false);
  const [rollbackReason, setRollbackReason] = useState('');
  const [projectStatuses, setProjectStatuses] = useState<ProjectStatus[]>([]);
  const [impactedServices, setImpactedServices] = useState('');
  const [saving, setSaving] = useState(false);
  const [startingBridge, setStartingBridge] = useState(false);

  useEffect(() => {
    if (open && bridge) {
      setActualStart(bridge.cgmp_actualstart ? bridge.cgmp_actualstart.slice(0, 16) : '');
      setActualEnd(bridge.cgmp_actualend ? bridge.cgmp_actualend.slice(0, 16) : '');
      setRollback(bridge.cgmp_rollbackinitiated ?? false);
      setRollbackReason(bridge.cgmp_rollbackreason ?? '');
      const data = parseBridgeExecutionData(bridge.cgmp_projectstatuses);
      setProjectStatuses(data.projects);
      setImpactedServices(data.impactedServices ?? '');
    }
    if (!open) { setActualStart(''); setActualEnd(''); setRollback(false); setRollbackReason(''); setProjectStatuses([]); setImpactedServices(''); }
  }, [open, bridge]);

  const handleStartBridge = async () => {
    if (!bridge) return;
    if (!bridge.cgmp_changenumber) {
      console.warn('[CGMP] Bridge started without a linked change number — actual start time will not be recorded on the parent change and change history will be unavailable');
    }
    setStartingBridge(true);
    try {
      const now = new Date().toISOString();
      const r = await Cgmp_bridgesService.update(bridge.cgmp_bridgeid, {
        cgmp_status: BRIDGE_STATUS.InProgress as unknown as Cgmp_bridgescgmp_status,
        cgmp_actualstart: now,
      });
      if (!r.success) throw r.error ?? new Error('Failed to start bridge');
      // QW-78: Record the current user as a bridge participant
      Cgmp_bridgesService.update(bridge.cgmp_bridgeid, { cgmp_participants: currentUserUpn } as any).catch(() => {});
      // Also record actual start time on the parent change
      const linkedStartChangeId = allChanges.find(c => c.cgmp_changenumber === bridge.cgmp_changenumber)?.cgmp_changeid;
      if (linkedStartChangeId) {
        Cgmp_changesService.update(linkedStartChangeId, { cgmp_actualstarttime: now } as any).catch(() => {});
      }
      Cgmp_auditlogsService.create({
        cgmp_auditlogname: `Bridge Started: ${bridge.cgmp_title}`,
        cgmp_entitytype: asAuditEntityType(100000002),
        cgmp_eventtype: asAuditEventType(100000012),
        cgmp_entityid: bridge.cgmp_bridgeid,
        cgmp_entityname: bridge.cgmp_title,
        cgmp_username: currentUserName,
        cgmp_useremail: currentUserUpn,
        cgmp_ipaddress: getBrowserInfo(),
        cgmp_newvalues: JSON.stringify({ status: 'Active', actualStart: now }),
      } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch(err => { if (import.meta.env.DEV) console.error('Audit log failed:', err); });
      setActualStart(now.slice(0, 16));
      showToast('success', 'Bridge started');
      onUpdated();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to start bridge');
    } finally { setStartingBridge(false); }
  };

  const updateProjectRow = (idx: number, field: keyof ProjectStatus, value: string) => {
    setProjectStatuses(prev => prev.map((row, i) => i === idx ? { ...row, [field]: value } : row));
  };

  const addProjectRow = () => {
    if (availableProjects.length === 0) return;
    const unused = availableProjects.find(p => !projectStatuses.some(ps => ps.projectId === p.cgmp_projectid));
    if (!unused) return;
    setProjectStatuses(prev => [...prev, { projectId: unused.cgmp_projectid, projectName: unused.cgmp_name, status: 'On Track', notes: '' }]);
  };

  const removeProjectRow = (idx: number) => setProjectStatuses(prev => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (!bridge) return;
    if (actualStart && actualEnd) {
      const s = new Date(actualStart), e = new Date(actualEnd);
      if (e <= s) {
        showToast('error', 'Actual end time must be after actual start time');
        return;
      }
    }
    setSaving(true);
    try {
      const r = await Cgmp_bridgesService.update(bridge.cgmp_bridgeid, {
        cgmp_actualstart: actualStart ? new Date(actualStart).toISOString() : undefined,
        cgmp_actualend: actualEnd ? new Date(actualEnd).toISOString() : undefined,
        cgmp_rollbackinitiated: rollback,
        cgmp_rollbackreason: rollbackReason.trim() || undefined,
        cgmp_projectstatuses: JSON.stringify({ projects: projectStatuses, impactedServices: impactedServices.trim() || undefined }),
      });
      if (!r.success) throw r.error ?? new Error('Failed to save execution details');
      showToast('success', 'Execution details saved');
      onUpdated();
      onClose();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save execution details');
    } finally { setSaving(false); }
  };

  const bridgeStatus = bridge ? (bridge.cgmp_status as unknown as number) : -1;
  const isScheduled = bridgeStatus === BRIDGE_STATUS.Scheduled;
  const isActive = bridgeStatus === BRIDGE_STATUS.InProgress;

  const linkedChange = allChanges.find(c => c.cgmp_changenumber === bridge?.cgmp_changenumber);
  const linkedProjectIds = linkedChange
    ? (linkedChange.cgmp_projectids ?? '').split(',').map(s => s.trim()).filter(Boolean)
    : null;
  const availableProjects = linkedProjectIds?.length
    ? projects.filter(p => linkedProjectIds.includes(p.cgmp_projectid))
    : projects;

  const handleCompleteBridge = async () => {
    if (!bridge) return;
    if (rollback && !rollbackReason.trim()) {
      showToast('error', 'Rollback reason is required when rolling back a bridge.');
      return;
    }
    if (actualStart && actualEnd) {
      const s = new Date(actualStart), e = new Date(actualEnd);
      if (e <= s) {
        showToast('error', 'Actual end time must be after actual start time');
        return;
      }
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const completionTime = actualEnd ? new Date(actualEnd).toISOString() : now;
      const newBridgeStatus = rollback ? BRIDGE_STATUS.Failed : BRIDGE_STATUS.Completed;
      const r = await Cgmp_bridgesService.update(bridge.cgmp_bridgeid, {
        cgmp_status: newBridgeStatus as unknown as Cgmp_bridgescgmp_status,
        cgmp_actualend: completionTime,
        cgmp_actualendtime: completionTime,
        cgmp_actualstart: actualStart ? new Date(actualStart).toISOString() : undefined,
        cgmp_rollbackinitiated: rollback,
        cgmp_rollbackreason: rollbackReason.trim() || undefined,
        cgmp_projectstatuses: JSON.stringify({ projects: projectStatuses, impactedServices: impactedServices.trim() || undefined }),
      } as any);
      if (!r.success) throw r.error ?? new Error('Failed to complete bridge');
      Cgmp_auditlogsService.create({
        cgmp_auditlogname: `Bridge ${rollback ? 'Failed (Rollback)' : 'Completed'}: ${bridge.cgmp_title}`,
        cgmp_entitytype: asAuditEntityType(100000002),
        cgmp_eventtype: asAuditEventType(100000013),
        cgmp_entityid: bridge.cgmp_bridgeid,
        cgmp_entityname: bridge.cgmp_title,
        cgmp_username: currentUserName,
        cgmp_useremail: currentUserUpn,
        cgmp_ipaddress: getBrowserInfo(),
        cgmp_newvalues: JSON.stringify({ status: rollback ? 'Failed' : 'Completed', rollback, projectStatuses }),
      } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch(err => { if (import.meta.env.DEV) console.error('Audit log failed:', err); });
      showToast('success', rollback ? 'Bridge marked as failed (rollback)' : 'Bridge completed successfully');
      onUpdated();

      if (rollback && linkedChange) {
        Cgmp_changesService.update(linkedChange.cgmp_changeid, { cgmp_rollbackinitiated: true } as any).catch(() => {});
        Cgmp_changehistoryService.create({
          cgmp_changeid: linkedChange.cgmp_changeid,
          cgmp_eventtype: '100000003',
          cgmp_details: 'Rollback initiated during bridge execution',
          cgmp_actor: currentUserUpn,
          cgmp_timestamp: new Date().toISOString(),
        } as any).catch(() => {});
      }

      // NH-3: Prompt to update parent change status if all bridges are now terminal
      if (bridge.cgmp_changenumber) {
        try {
          const allBridgesResult = await Cgmp_bridgesService.getAll({
            filter: `cgmp_changenumber eq '${bridge.cgmp_changenumber}'`,
            select: ['cgmp_bridgeid', 'cgmp_status'] as any,
          });
          if (allBridgesResult.success && allBridgesResult.data?.length) {
            const fetchedBridges = (allBridgesResult.data as Cgmp_bridges[]).map(b =>
              b.cgmp_bridgeid === bridge.cgmp_bridgeid ? { ...b, cgmp_status: newBridgeStatus as any } : b
            );
            const allTerminal = fetchedBridges.every(b => {
              const s = b.cgmp_status as unknown as number;
              return s === BRIDGE_STATUS.Completed || s === BRIDGE_STATUS.Failed;
            });
            if (allTerminal) {
              const anyFailed = fetchedBridges.some(b => (b.cgmp_status as unknown as number) === BRIDGE_STATUS.Failed);
              const suggestedStatus = anyFailed ? 'Failed' : 'Completed';
              const linkedCh = allChanges.find(c => c.cgmp_changenumber === bridge.cgmp_changenumber);
              if (linkedCh && window.confirm(`All bridges for ${bridge.cgmp_changenumber} are complete. Mark change as ${suggestedStatus}?`)) {
                await Cgmp_changesService.update(linkedCh.cgmp_changeid, {
                  cgmp_status: asStatus(anyFailed ? 100000008 : 100000007),
                }).catch(() => {});
              }
            }
          }
        } catch { /* ignore — bridge update already succeeded */ }
      }

      onClose();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to complete bridge');
    } finally { setSaving(false); }
  };

  const footer = (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
      <button className="btn btn--outline" onClick={onClose} disabled={saving}>Cancel</button>
      {isScheduled && (
        <button className="btn btn--secondary" onClick={handleStartBridge} disabled={startingBridge}>
          {startingBridge ? 'Starting…' : 'Start Bridge'}
        </button>
      )}
      <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save Execution'}
      </button>
      {isActive && (
        <button
          className={`btn${rollback ? ' btn--danger' : ''}`}
          onClick={handleCompleteBridge}
          disabled={saving}
          title={rollback ? 'Fail this bridge and initiate rollback' : 'Mark this bridge as completed now'}
          style={rollback ? undefined : { background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }}
        >
          {saving ? 'Processing…' : rollback ? '✗ Fail Bridge (Rollback)' : '✓ Complete Bridge'}
        </button>
      )}
    </div>
  );

  if (!bridge) return null;

  return (
    <SlidePanel
      open={open}
      onClose={onClose}
      title="Bridge Execution"
      subtitle={bridge.cgmp_title}
      width={580}
      footer={footer}
    >
      <div className="bex-panel">
        {/* Status banner */}
        <div className={`bex-status-banner bex-status--${bridgeStatus === BRIDGE_STATUS.InProgress ? 'active' : bridgeStatus === BRIDGE_STATUS.Scheduled ? 'scheduled' : 'done'}`}>
          {bridgeStatusLabel(bridgeStatus)}
          {bridge.cgmp_changenumber && <span className="bex-change-ref">Change: {bridge.cgmp_changenumber}</span>}
        </div>

        {/* Rollback initiated badge — shown when the parent change has been flagged */}
        {linkedChange?.cgmp_rollbackinitiated && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 10px',
            background: 'rgba(220, 38, 38, 0.10)',
            border: '1px solid var(--danger, #dc2626)',
            borderRadius: 'var(--radius)',
            color: 'var(--danger, #dc2626)',
            fontSize: 12, fontWeight: 700,
            marginBottom: 8,
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
            </svg>
            ROLLBACK INITIATED
          </div>
        )}

        {/* Actual times */}
        <div className="bex-section">
          <div className="bex-section__title">Actual Times</div>
          <div className="ff-row">
            <div className="ff-group">
              <label className="ff-label">Actual Start</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="datetime-local" className="ff-input" value={actualStart} onChange={e => setActualStart(e.target.value)} style={{ flex: 1 }} />
                {!actualStart && <button className="btn btn--xs btn--outline" type="button" onClick={() => setActualStart(new Date().toISOString().slice(0, 16))} title="Set to now">Now</button>}
              </div>
            </div>
            <div className="ff-group">
              <label className="ff-label">Actual End</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="datetime-local" className="ff-input" value={actualEnd} onChange={e => setActualEnd(e.target.value)} style={{ flex: 1 }} />
                <button className="btn btn--xs btn--outline" type="button" onClick={() => setActualEnd(new Date().toISOString().slice(0, 16))} title="Set to now">Now</button>
              </div>
            </div>
          </div>
        </div>

        {/* Project statuses */}
        <div className="bex-section">
          <div className="bex-section__title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Project Statuses</span>
            <button className="btn btn--xs btn--outline" onClick={addProjectRow}>+ Add Project</button>
          </div>
          {projectStatuses.length === 0 ? (
            <div className="bex-empty">No project statuses added. Click "+ Add Project" to track project states.</div>
          ) : (
            <div className="bex-proj-table">
              {projectStatuses.map((row, i) => (
                <div key={i} className="bex-proj-row">
                  <div className="bex-proj-name">
                    <select
                      className="ff-input ff-select"
                      value={row.projectId}
                      onChange={e => {
                        const p = projects.find(pr => pr.cgmp_projectid === e.target.value);
                        if (p) updateProjectRow(i, 'projectId', e.target.value);
                        if (p) setProjectStatuses(prev => prev.map((r, idx) => idx === i ? { ...r, projectId: p.cgmp_projectid, projectName: p.cgmp_name } : r));
                      }}
                    >
                      {availableProjects.map(p => <option key={p.cgmp_projectid} value={p.cgmp_projectid}>{p.cgmp_name}</option>)}
                    </select>
                  </div>
                  <div className="bex-proj-status">
                    <select className="ff-input ff-select" value={row.status} onChange={e => updateProjectRow(i, 'status', e.target.value)}>
                      {PROJECT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="bex-proj-notes">
                    <input className="ff-input" value={row.notes} onChange={e => updateProjectRow(i, 'notes', e.target.value)} placeholder="Notes…" />
                  </div>
                  <button className="btn-icon btn-icon--danger" onClick={() => removeProjectRow(i)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Rollback */}
        <div className="bex-section">
          <div className="bex-section__title">Rollback</div>
          <label className="bex-toggle-row">
            <input type="checkbox" checked={rollback} onChange={e => setRollback(e.target.checked)} />
            <span>Rollback Initiated</span>
          </label>
          {rollback && (
            <div className="ff-group" style={{ marginTop: 8 }}>
              <label className="ff-label">Rollback Reason</label>
              <textarea
                className="ff-input ff-textarea"
                rows={3}
                value={rollbackReason}
                onChange={e => setRollbackReason(e.target.value)}
                placeholder="Describe the reason for rollback…"
              />
            </div>
          )}
        </div>

        {/* Service Degradation Report (#51) */}
        <div className="bex-section">
          <div className="bex-section__title">Service Degradation Report</div>
          <textarea
            className="ff-input ff-textarea"
            rows={3}
            value={impactedServices}
            onChange={e => setImpactedServices(e.target.value)}
            placeholder="List impacted services and SLAs (one per line, e.g. 'MPLS Link Chennai — SLA breached by 12 min')…"
          />
          <span className="form-hint" style={{ color: 'var(--text-tertiary)', fontSize: 11, marginTop: 4, display: 'block' }}>
            Record which services and SLAs were degraded during this bridge. Visible in Archive Center.
          </span>
        </div>
      </div>
    </SlidePanel>
  );
}
