import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import ChangeList from './ChangeList';
import ChangeForm, { type FormMode } from './ChangeForm';
import BulkImport from './BulkImport';
import ConfirmDialog from '../ui/ConfirmDialog';
import { Dialog } from '../ui/Modal';
import { useApp } from '../../context/AppContext';
import { Cgmp_changesService, Cgmp_notificationsService, Cgmp_changetemplatesService, Cgmp_blackoutperiodsService } from '../../generated';
import type { Cgmp_changetemplates } from '../../generated/models/Cgmp_changetemplatesModel';
import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';
import type { Cgmp_changescgmp_status } from '../../generated/models/Cgmp_changesModel';
import type { Cgmp_notificationscgmp_category, Cgmp_notificationscgmp_priority, Cgmp_notificationsstatecode, Cgmp_notificationsBase } from '../../generated/models/Cgmp_notificationsModel';
import type { Cgmp_blackoutperiods } from '../../generated/models/Cgmp_blackoutperiodsModel';
import { STATUS, useChangeList, useAllUserProfiles, useProjects } from '../../hooks/useDataverse';

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="pmo-stat">
      <span className="pmo-stat__value" style={{ color }}>{value}</span>
      <span className="pmo-stat__label">{label}</span>
    </div>
  );
}

export default function PMOWorkspace() {
  const { showToast, currentUserName, currentUserUpn, userProfile } = useApp();
  const { changes, loading, refresh } = useChangeList();
  const { profiles: allProfiles } = useAllUserProfiles();
  const { projects } = useProjects();

  /* Optimistic UI — temporary local overrides before server confirms */
  const [optimisticUpdates, setOptimisticUpdates] = useState<Record<string, Partial<Cgmp_changes>>>({});

  const mergedChanges = useMemo(() =>
    changes.map(c => optimisticUpdates[c.cgmp_changeid] ? { ...c, ...optimisticUpdates[c.cgmp_changeid] } : c),
    [changes, optimisticUpdates]
  );

  /* Modal state */
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>('create');
  const [formChange, setFormChange] = useState<Cgmp_changes | undefined>();
  const [importOpen, setImportOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /* Template state */
  const [templates, setTemplates] = useState<Cgmp_changetemplates[]>([]);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [formTemplate, setFormTemplate] = useState<Cgmp_changetemplates | undefined>();
  const templateMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!templateMenuOpen) return;
    const onOutsideClick = (e: MouseEvent) => {
      if (templateMenuRef.current && !templateMenuRef.current.contains(e.target as Node)) setTemplateMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setTemplateMenuOpen(false); };
    document.addEventListener('mousedown', onOutsideClick);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('mousedown', onOutsideClick); document.removeEventListener('keydown', onKeyDown); };
  }, [templateMenuOpen]);

  const loadTemplates = useCallback(async () => {
    try {
      const r = await Cgmp_changetemplatesService.getAll({ orderBy: ['cgmp_name asc'], top: 100 });
      setTemplates(r.data ?? []);
    } catch { /* best-effort */ }
  }, []);

  /* Publish confirm */
  const [publishTarget, setPublishTarget] = useState<Cgmp_changes | null>(null);
  const [bulkPublish, setBulkPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);

  /* Blackout override dialog state (Item 14) */
  const [blackoutOverrideOpen, setBlackoutOverrideOpen] = useState(false);
  const [blackoutOverrideReason, setBlackoutOverrideReason] = useState('');
  const [pendingPublishState, setPendingPublishState] = useState<{ overlapping: Cgmp_changes[]; } | null>(null);
  const [overridePublishing, setOverridePublishing] = useState(false);
  const blackoutApprovedRef = useRef(false);

  const openForm = useCallback((mode: FormMode, change?: Cgmp_changes) => {
    setFormMode(mode);
    setFormChange(change);
    setFormOpen(true);
  }, []);

  const handleClone = useCallback(async (source: Cgmp_changes) => {
    try {
      const result = await Cgmp_changesService.create({
        cgmp_title: `Copy of ${source.cgmp_title ?? ''}`,
        cgmp_description: source.cgmp_description,
        cgmp_category: source.cgmp_category,
        cgmp_changetype: source.cgmp_changetype,
        cgmp_risklevel: source.cgmp_risklevel,
        cgmp_impactlevel: source.cgmp_impactlevel,
        cgmp_region: source.cgmp_region,
        cgmp_country: source.cgmp_country,
        cgmp_facility: source.cgmp_facility,
        cgmp_location: source.cgmp_location,
        cgmp_projectids: source.cgmp_projectids,
        cgmp_status: STATUS.Draft as unknown as Cgmp_changes['cgmp_status'],
      } as any);
      if (!result.success) throw result.error ?? new Error('Clone failed');
      showToast('success', `Change cloned. Dates are not copied — please set start/end times before publishing.`);
      refresh();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Clone failed');
    }
  }, [showToast, refresh]);

  const doPublish = useCallback(async () => {
    let earlyReturn = false;
    setPublishing(true);
    try {
      const targets: Cgmp_changes[] = bulkPublish
        ? changes.filter(c => selectedIds.has(c.cgmp_changeid) && (c.cgmp_status as unknown as number) === STATUS.Draft)
        : publishTarget ? [publishTarget] : [];

      if (targets.length === 0) {
        showToast('info', 'No eligible changes to publish (status must be Draft)');
        return;
      }

      // Project ID validation — block if linked projects no longer exist (Item 15)
      const projectIdsInUse = targets.flatMap(c =>
        (c.cgmp_projectids ?? '').split(',').map(s => s.trim()).filter(Boolean)
      );
      if (projectIdsInUse.length > 0 && projects.length > 0) {
        const validIds = new Set(projects.map(p => p.cgmp_projectid));
        const staleIds = projectIdsInUse.filter(id => !validIds.has(id));
        if (staleIds.length > 0) {
          showToast('error', `${staleIds.length} linked project(s) no longer exist. Remove them before publishing.`);
          return;
        }
      }

      // Blackout period hard block
      let blackouts: Cgmp_blackoutperiods[] = [];
      try {
        const bpResult = await Cgmp_blackoutperiodsService.getAll({ top: 100 });
        blackouts = bpResult.data ?? [];
      } catch { /* don't block publish on blackout fetch failure */ }

      if (blackouts.length > 0) {
        const userRole = Number(userProfile?.cgmp_role);
        const isAdmin = userRole === 100000000;

        const overlappingTargets = targets.filter(c => {
          const cStart = c.cgmp_starttime ? new Date(c.cgmp_starttime) : null;
          const cEnd = c.cgmp_endtime ? new Date(c.cgmp_endtime) : null;
          return blackouts.some(bp => {
            const bpStart = bp.cgmp_startdate ? new Date(bp.cgmp_startdate) : null;
            const bpEnd = bp.cgmp_enddate ? new Date(bp.cgmp_enddate) : null;
            if (!bpStart || !bpEnd) return false;
            const sOverlap = Boolean(cStart && cStart >= bpStart && cStart <= bpEnd);
            const eOverlap = Boolean(cEnd && cEnd >= bpStart && cEnd <= bpEnd);
            const spans = Boolean(cStart && cEnd && cStart <= bpStart && cEnd >= bpEnd);
            return sOverlap || eOverlap || spans;
          });
        });

        if (overlappingTargets.length > 0) {
          if (!isAdmin) {
            showToast('error', 'Cannot publish during a blackout period. Contact Admin for an override.');
            return;
          }
          // Item 14: Show justification dialog instead of window.confirm
          if (!blackoutApprovedRef.current) {
            setPendingPublishState({ overlapping: overlappingTargets });
            setBlackoutOverrideOpen(true);
            earlyReturn = true; // Preserve publishTarget/bulkPublish for retry
            return;
          }
          // Second pass — override already confirmed, reset flag
          blackoutApprovedRef.current = false;
        }
      }

      /* Optimistic UI */
      const optimisticPatch: Partial<Cgmp_changes> = {
        cgmp_status: STATUS.Published as unknown as Cgmp_changes['cgmp_status'],
      };
      setOptimisticUpdates(prev => {
        const next = { ...prev };
        targets.forEach(c => { next[c.cgmp_changeid] = optimisticPatch; });
        return next;
      });

      const settleResults = await Promise.allSettled(targets.map(async c => {
        const r = await Cgmp_changesService.update(c.cgmp_changeid, {
          cgmp_status: STATUS.Published as unknown as Cgmp_changescgmp_status,
        });
        if (!r.success) throw r.error ?? new Error(`Failed to publish ${c.cgmp_changenumber}`);
        return c;
      }));

      const succeeded: Cgmp_changes[] = [];
      const failedNums: string[] = [];
      settleResults.forEach((r, i) => {
        if (r.status === 'fulfilled') succeeded.push(targets[i]);
        else failedNums.push(targets[i].cgmp_changenumber ?? targets[i].cgmp_changeid);
      });

      /* Revert optimistic state for failed items */
      if (failedNums.length > 0) {
        setOptimisticUpdates(prev => {
          const next = { ...prev };
          settleResults.forEach((r, i) => { if (r.status === 'rejected') delete next[targets[i].cgmp_changeid]; });
          return next;
        });
      }

      /* Send notifications to IT Ops POCs for successfully published changes */
      const itOpsPocs = allProfiles.filter(p => (p.cgmp_role as unknown as number) === 100000002);
      await Promise.all(succeeded.flatMap(c => {
        const changeLocs = (c.cgmp_location ?? '').split(',').map(l => l.trim()).filter(Boolean);
        const recipients = itOpsPocs.filter(p => {
          const pocLocs = ((p as any).cgmp_assignedlocations ?? '').split(',').map((l: string) => l.trim()).filter(Boolean);
          return pocLocs.length === 0 || pocLocs.some((loc: string) => changeLocs.includes(loc));
        });
        return recipients.map(p =>
          Cgmp_notificationsService.create({
            cgmp_title: `Change Published: ${c.cgmp_changenumber}`,
            cgmp_message: `${c.cgmp_changenumber} — ${c.cgmp_title} has been published and is ready for review.`,
            cgmp_category: 100000000 as unknown as Cgmp_notificationscgmp_category,
            cgmp_priority: 100000000 as unknown as Cgmp_notificationscgmp_priority,
            cgmp_recipientid: p.cgmp_userprofileid,
            cgmp_relatedchangeid: c.cgmp_changeid,
            cgmp_actionurl: `#pmo?change=${c.cgmp_changenumber ?? ''}`,
            ownerid: p.cgmp_userprofileid,
            statecode: 0 as unknown as Cgmp_notificationsstatecode,
          } as unknown as Omit<Cgmp_notificationsBase, 'cgmp_notificationid'>).catch(err => { if (import.meta.env.DEV) console.error('Background operation failed:', err); })
        );
      }));

      const noRecipients = succeeded.filter(c => {
        const changeLocs = (c.cgmp_location ?? '').split(',').map(l => l.trim()).filter(Boolean);
        return !itOpsPocs.some(p => {
          const pocLocs = ((p as any).cgmp_assignedlocations ?? '').split(',').map((l: string) => l.trim()).filter(Boolean);
          return pocLocs.length === 0 || pocLocs.some((loc: string) => changeLocs.includes(loc));
        });
      });
      if (noRecipients.length > 0) {
        showToast('warning', `${noRecipients.length} change${noRecipients.length > 1 ? 's have' : ' has'} no matching IT Ops POC — no notification sent. Assign a POC for: ${noRecipients.map(c => c.cgmp_changenumber).join(', ')}`);
      }
      if (failedNums.length > 0) {
        showToast('warning', `${succeeded.length}/${targets.length} published. Failed: ${failedNums.join(', ')}`);
      } else {
        showToast('success', `Published ${succeeded.length} change${succeeded.length !== 1 ? 's' : ''}`);
      }
      if (bulkPublish) setSelectedIds(new Set());
      refresh();
    } catch (err) {
      /* On partial failure, refresh from server rather than attempting a client-side revert */
      refresh();
      showToast('error', err instanceof Error ? err.message : 'Publish failed — some changes may not have been published. Please check the list.');
    } finally {
      setPublishing(false);
      if (!earlyReturn) {
        // Only clear publish state when we actually completed (not when showing blackout dialog)
        setPublishTarget(null);
        setBulkPublish(false);
      }
    }
  }, [bulkPublish, publishTarget, changes, selectedIds, allProfiles, showToast, refresh, currentUserName, currentUserUpn, projects, userProfile]);

  /* Blackout override: append justification to history, then resume publish (Item 14) */
  const doPublishWithOverride = useCallback(async () => {
    if (!pendingPublishState || !blackoutOverrideReason.trim()) return;
    setOverridePublishing(true);
    try {
      const nowIso = new Date().toISOString();
      await Promise.allSettled(pendingPublishState.overlapping.map(async c => {
        try {
          const latest = await Cgmp_changesService.get(c.cgmp_changeid, { select: ['cgmp_versionhistory'] as any });
          const hist: object[] = JSON.parse(latest.data?.cgmp_versionhistory ?? '[]');
          hist.push({
            _type: 'blackout_override',
            by: userProfile?.owneridname ?? currentUserName,
            at: nowIso,
            justification: blackoutOverrideReason.trim(),
          });
          await Cgmp_changesService.update(c.cgmp_changeid, { cgmp_versionhistory: JSON.stringify(hist) } as any);
        } catch { /* ignore — publish continues */ }
      }));
      setBlackoutOverrideOpen(false);
      setPendingPublishState(null);
      setBlackoutOverrideReason('');
      blackoutApprovedRef.current = true;
      await doPublish();
    } finally {
      setOverridePublishing(false);
    }
  }, [pendingPublishState, blackoutOverrideReason, currentUserName, userProfile, doPublish]);

  /* Stats */
  const total = changes.length;
  const draft = changes.filter(c => (c.cgmp_status as unknown as number) === STATUS.Draft).length;
  const inReview = changes.filter(c => (c.cgmp_status as unknown as number) === STATUS.UnderReview).length;
  const released = changes.filter(c => (c.cgmp_status as unknown as number) === STATUS.Released).length;
  const failed = changes.filter(c => (c.cgmp_status as unknown as number) === STATUS.Failed).length;

  const eligibleDraftSelected = changes.filter(c =>
    selectedIds.has(c.cgmp_changeid) && (c.cgmp_status as unknown as number) === STATUS.Draft
  ).length;

  const userRole = Number(userProfile?.cgmp_role);
  if (userRole !== 100000000 && userRole !== 100000001) {
    return (
      <div className="workspace-placeholder workspace-placeholder--denied" role="alert">
        <span aria-hidden="true" style={{ fontSize: 48 }}>🔒</span>
        <h2>Access Denied</h2>
        <p>This workspace is only available to PMO and Admin users.</p>
      </div>
    );
  }

  return (
    <div className="pmo-workspace">
      {/* Header */}
      <div className="pmo-header">
        <div>
          <h1 className="pmo-header__title">PMO Workspace</h1>
          <p className="pmo-header__sub">Manage, review, and release change records</p>
        </div>
        <div className="pmo-header__actions">
          {selectedIds.size > 0 && eligibleDraftSelected > 0 && (
            <button className="btn btn--outline" onClick={() => { setBulkPublish(true); setPublishTarget(null); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5 4v2h14V4H5zm0 10h4v6h6v-6h4l-7-7-7 7z" />
              </svg>
              Publish {eligibleDraftSelected} Selected
            </button>
          )}
          <button className="btn btn--outline" onClick={() => setImportOpen(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
            </svg>
            Bulk Import
          </button>
          <div style={{ position: 'relative' }}>
            <button
              className="btn btn--outline btn--sm"
              aria-haspopup="true"
              aria-expanded={templateMenuOpen}
              onClick={() => { loadTemplates(); setTemplateMenuOpen(v => !v); }}
            >
              From Template ▾
            </button>
            {templateMenuOpen && (
              <div
                ref={templateMenuRef}
                role="menu"
                style={{
                  position: 'absolute', right: 0, top: '100%', zIndex: 200, marginTop: 4,
                  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
                  minWidth: 220, maxHeight: 260, overflowY: 'auto', boxShadow: 'var(--shadow-md)',
                }}
              >
                {templates.length === 0 ? (
                  <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-tertiary)' }}>No templates available</div>
                ) : templates.map(t => {
                  const selectTemplate = () => {
                    setFormTemplate(t);
                    setFormChange(undefined);
                    setFormMode('create');
                    setFormOpen(true);
                    setTemplateMenuOpen(false);
                  };
                  return (
                    <div
                      key={t.cgmp_changetemplateid}
                      role="menuitem"
                      tabIndex={0}
                      style={{ padding: '10px 16px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-alt)')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                      onClick={selectTemplate}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectTemplate(); } }}
                    >
                      {t.cgmp_name || 'Untitled Template'}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <button className="btn btn--primary" onClick={() => { setFormTemplate(undefined); openForm('create'); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>
            Create Change
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="pmo-stats">
        <StatChip label="Total Changes" value={total} color="var(--text-primary)" />
        <StatChip label="Draft" value={draft} color="var(--text-secondary)" />
        <StatChip label="In Review" value={inReview} color="var(--primary)" />
        <StatChip label="Released" value={released} color="var(--success)" />
        <StatChip label="Failed" value={failed} color="var(--danger)" />
        {selectedIds.size > 0 && (
          <span className="pmo-selection-chip">{selectedIds.size} selected</span>
        )}
      </div>

      {/* Table */}
      <div className="pmo-table-card">
        <ChangeList
          changes={mergedChanges}
          loading={loading}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          onOpenForm={openForm}
          onPublish={(change) => { setPublishTarget(change); setBulkPublish(false); }}
          onClone={handleClone}
          onRefresh={refresh}
        />
      </div>

      {/* Change Form panel */}
      <ChangeForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        mode={formMode}
        change={formChange}
        onSaved={refresh}
        initialTemplate={formMode === 'create' ? formTemplate : undefined}
      />

      {/* Bulk Import dialog */}
      <BulkImport
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={refresh}
      />

      {/* Publish confirm dialog */}
      <ConfirmDialog
        open={!!publishTarget || bulkPublish}
        onClose={() => { setPublishTarget(null); setBulkPublish(false); }}
        onConfirm={doPublish}
        title="Confirm Publish"
        message={bulkPublish
          ? `Publish ${eligibleDraftSelected} draft change${eligibleDraftSelected > 1 ? 's' : ''}? IT Ops POCs will be notified.`
          : `Publish "${publishTarget?.cgmp_changenumber}"? IT Ops POCs will be notified to review.`}
        confirmLabel="Publish"
        loading={publishing}
      />

      {/* Blackout override justification dialog (Item 14) */}
      <Dialog
        open={blackoutOverrideOpen}
        onClose={() => { setBlackoutOverrideOpen(false); setPendingPublishState(null); setBlackoutOverrideReason(''); setPublishTarget(null); setBulkPublish(false); }}
        title="Admin Override — Blackout Period"
        maxWidth={480}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn--outline" onClick={() => { setBlackoutOverrideOpen(false); setPendingPublishState(null); setBlackoutOverrideReason(''); setPublishTarget(null); setBulkPublish(false); }}>
              Cancel
            </button>
            <button
              className="btn btn--danger"
              disabled={overridePublishing || !blackoutOverrideReason.trim()}
              onClick={doPublishWithOverride}
            >
              {overridePublishing ? 'Processing…' : 'Override & Publish'}
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: 'var(--danger-light)', border: '1px solid rgba(209,52,56,0.25)', borderRadius: 6, padding: '10px 14px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            This change window overlaps an active blackout period.
            As Admin, you may override but must provide a justification that will be recorded in the change history.
          </div>
          <div className="ff-group" style={{ margin: 0 }}>
            <label className="ff-label" style={{ marginBottom: 6 }}>
              Override Justification <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <textarea
              className="ff-input ff-textarea"
              rows={3}
              placeholder="Explain why this change must proceed during the blackout period…"
              value={blackoutOverrideReason}
              onChange={e => setBlackoutOverrideReason(e.target.value)}
              autoFocus
              style={{ resize: 'vertical' }}
            />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
