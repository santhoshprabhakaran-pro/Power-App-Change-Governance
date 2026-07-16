import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';
import type { Cgmp_projects } from '../../generated/models/Cgmp_projectsModel';
import type { Systemusers } from '../../generated/models/SystemusersModel';
import { Cgmp_changesService, Cgmp_notificationsService } from '../../generated';
import {
  STATUS,
  statusLabel,
  statusColor,
  riskLabel,
  riskColor,
  isIsmFrozen,
  daysUntilIsmFreeze,
  ismFreezeDate,
  useCountdown,
  useSystemUsers,
  appendHistory,
} from '../../hooks/useDataverse';
import { fmtShortDate as fmtDate, getDisplayTimezone } from '../../utils/format';
import { asNotifCategory, asNotifPriority } from '../../utils/optionSets';
import { trackAppEvent, trackAppException } from '../../utils/appInsights';
import { getQuietHoursSnoozedUntil, isNotifCategoryEnabled } from '../../utils/notifications';
import { parseChangeUATData, defaultUATEntry } from '../giicc/GIICCCommandCenter';
import { SlidePanel } from '../ui/Modal';
import { PROJ_STATUS_LABEL, PROJ_STATUS_CLASS, ChangeDetailPanel, ProjectViewPanel } from './ISMPanels';

/* ─── Types ─────────────────────────────────────────────────────── */

type ConcernSeverity = 'Low' | 'Medium' | 'High' | 'Critical';

interface ConcernEntry {
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
}

const CONCERN_SEVERITY_COLORS: Record<ConcernSeverity, string> = {
  Low: 'var(--text-secondary)',
  Medium: '#d97706',
  High: 'var(--danger)',
  Critical: '#7c2d12',
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

function parseConcerns(versionHistory: string | undefined | null): ConcernEntry[] {
  try {
    const entries = JSON.parse(versionHistory ?? '[]');
    return (Array.isArray(entries) ? entries : []).filter(
      (e: unknown) => (e as Record<string, unknown>)._type === 'concern'
    ) as ConcernEntry[];
  } catch {
    return [];
  }
}

/* ─── Per-Change UAT Contact Panel ──────────────────────────────── */

interface ChangeUATContactPanelProps {
  open: boolean;
  onClose: () => void;
  project: Cgmp_projects | null;
  change: Cgmp_changes | null;
  onSaved: () => void;
  showToast: (type: 'success' | 'error' | 'info' | 'warning', msg: string) => void;
}

function ChangeUATContactPanel({ open, onClose, project, change, onSaved, showToast }: ChangeUATContactPanelProps) {
  const { users: sysUsers, loading: sysLoading } = useSystemUsers();

  const [contacts, setContacts] = useState<Array<{ name: string; email: string; phone?: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [addMode, setAddMode] = useState<'o365' | 'custom'>('o365');
  const [o365Search, setO365Search] = useState('');
  const [o365Selected, setO365Selected] = useState<Systemusers | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [addErr, setAddErr] = useState('');

  useEffect(() => {
    if (open && project && change) {
      const data = parseChangeUATData(change.cgmp_uatusers);
      setContacts(data[project.cgmp_projectid]?.contacts ?? []);
    }
    if (!open) {
      setO365Search('');
      setO365Selected(null);
      setShowDropdown(false);
      setNewName('');
      setNewEmail('');
      setNewPhone('');
      setAddErr('');
      setAddMode('o365');
    }
  }, [open, project, change]);

  const frozen = change ? isIsmFrozen(change.cgmp_starttime) : false;
  const daysLeft = change?.cgmp_starttime && !frozen ? daysUntilIsmFreeze(change.cgmp_starttime) : null;
  const freezeTargetISO =
    change?.cgmp_starttime && !frozen ? ismFreezeDate(change.cgmp_starttime).toISOString() : undefined;
  const freezeCountdown = useCountdown(freezeTargetISO);

  const o365Results = useMemo(() => {
    const q = o365Search.trim().toLowerCase();
    if (!q || q.length < 2) return [];
    return sysUsers
      .filter(
        (u) =>
          u.fullname?.toLowerCase().includes(q) ||
          u.internalemailaddress?.toLowerCase().includes(q) ||
          u.domainname?.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [o365Search, sysUsers]);

  const isAlreadyAdded = (u: Systemusers) => contacts.some((c) => c.email === u.internalemailaddress);

  const handleO365Add = () => {
    if (!o365Selected) return;
    if (isAlreadyAdded(o365Selected)) {
      setAddErr('This user is already in the contact list.');
      return;
    }
    setContacts((prev) => [
      ...prev,
      {
        name: o365Selected.fullname ?? o365Selected.domainname,
        email: o365Selected.internalemailaddress,
        phone: o365Selected.mobilephone || undefined,
      },
    ]);
    setO365Search('');
    setO365Selected(null);
    setAddErr('');
  };

  const handleCustomAdd = () => {
    if (!newName.trim()) {
      setAddErr('Name is required');
      return;
    }
    if (!newEmail.trim() || !newEmail.includes('@')) {
      setAddErr('Valid email is required');
      return;
    }
    if (contacts.some((c) => c.email === newEmail.trim())) {
      setAddErr('This email is already in the contact list.');
      return;
    }
    setContacts((prev) => [
      ...prev,
      { name: newName.trim(), email: newEmail.trim(), phone: newPhone.trim() || undefined },
    ]);
    setNewName('');
    setNewEmail('');
    setNewPhone('');
    setAddErr('');
  };

  const handleSave = async () => {
    if (!project || !change) return;
    setSaving(true);
    try {
      const data = parseChangeUATData(change.cgmp_uatusers);
      const existing = data[project.cgmp_projectid] ?? defaultUATEntry();
      const updated = { ...data, [project.cgmp_projectid]: { ...existing, contacts } };
      const r = await Cgmp_changesService.update(change.cgmp_changeid, { cgmp_uatusers: JSON.stringify(updated) });
      if (!r.success) throw r.error ?? new Error('Failed to save');
      showToast('success', `UAT contacts updated for ${project.cgmp_name} (${change.cgmp_changenumber})`);
      onSaved();
      onClose();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save UAT contacts');
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
      <button className="btn btn--outline" onClick={onClose} disabled={saving}>
        Cancel
      </button>
      <button className="btn btn--primary" onClick={handleSave} disabled={saving || frozen}>
        {saving ? 'Saving…' : 'Save UAT Contacts'}
      </button>
    </div>
  );

  if (!project || !change) return null;

  return (
    <SlidePanel
      open={open}
      onClose={onClose}
      width={540}
      title="UAT Contacts for Change"
      subtitle={`${project.cgmp_name} — ${change.cgmp_changenumber}`}
      footer={footer}
    >
      <div className="uat-panel" style={{ padding: '0 20px' }}>
        {frozen ? (
          <div className="ism-freeze-banner ism-freeze-banner--locked">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
            </svg>
            UAT collection is frozen — change is within 3 days of scheduled start.
          </div>
        ) : daysLeft !== null && daysLeft <= 5 ? (
          <div className="ism-freeze-banner ism-freeze-banner--warn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
            </svg>
            UAT collection freezes in{' '}
            <strong>
              {daysLeft} day{daysLeft !== 1 ? 's' : ''}
            </strong>
            {freezeCountdown && freezeCountdown !== 'N/A' && (
              <span style={{ marginLeft: 6, fontFamily: 'monospace', fontSize: 12 }}>({freezeCountdown})</span>
            )}
            . Update before the deadline.
          </div>
        ) : null}

        <div className="uat-section">
          <div className="uat-section__title">
            Assigned UAT Contacts
            <span className="uat-count-badge">{contacts.length}</span>
          </div>
          {contacts.length === 0 ? (
            <div className="uat-empty">No UAT contacts assigned yet.</div>
          ) : (
            <div className="uat-list">
              {contacts.map((u, i) => (
                <div key={i} className="uat-user-row">
                  <div className="uat-user-info">
                    <span className="uat-user-avatar">{u.name.charAt(0).toUpperCase()}</span>
                    <div className="uat-user-details">
                      <span className="uat-user-name">{u.name}</span>
                      <span className="uat-user-email">{u.email}</span>
                      {u.phone && <span className="uat-user-phone">{u.phone}</span>}
                    </div>
                  </div>
                  {!frozen && (
                    <button
                      className="btn-icon btn-icon--danger"
                      title="Remove"
                      onClick={() => setContacts((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {!frozen && (
          <div className="uat-section">
            <div className="uat-section__title">Add Contact</div>
            <div className="uat-add-tabs">
              <button
                className={`uat-add-tab ${addMode === 'o365' ? 'uat-add-tab--active' : ''}`}
                onClick={() => {
                  setAddMode('o365');
                  setAddErr('');
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.7 }}>
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                </svg>
                O365 Lookup
              </button>
              <button
                className={`uat-add-tab ${addMode === 'custom' ? 'uat-add-tab--active' : ''}`}
                onClick={() => {
                  setAddMode('custom');
                  setAddErr('');
                  setO365Selected(null);
                  setO365Search('');
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.7 }}>
                  <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                </svg>
                Custom User
              </button>
            </div>

            {addMode === 'o365' && (
              <div className="uat-o365-lookup">
                <div className="uat-o365-search-wrap">
                  <svg className="uat-o365-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                  </svg>
                  <input
                    className="uat-o365-search-input"
                    placeholder={sysLoading ? 'Loading O365 users…' : 'Search by name, email or UPN…'}
                    disabled={sysLoading}
                    value={o365Search}
                    onChange={(e) => {
                      setO365Search(e.target.value);
                      setO365Selected(null);
                      setShowDropdown(true);
                      setAddErr('');
                    }}
                    onFocus={() => setShowDropdown(true)}
                    onBlur={() => setTimeout(() => setShowDropdown(false), 180)}
                    autoComplete="off"
                  />
                  {o365Search && (
                    <button
                      className="uat-o365-clear"
                      onClick={() => {
                        setO365Search('');
                        setO365Selected(null);
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                      </svg>
                    </button>
                  )}
                </div>

                {showDropdown && o365Results.length > 0 && (
                  <div className="uat-o365-dropdown">
                    {o365Results.map((u) => {
                      const already = isAlreadyAdded(u);
                      return (
                        <div
                          key={u.systemuserid}
                          className={`uat-o365-result ${already ? 'uat-o365-result--added' : ''}`}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            if (already) return;
                            setO365Selected(u);
                            setO365Search(u.fullname ?? u.domainname);
                            setShowDropdown(false);
                            setAddErr('');
                          }}
                        >
                          <span className="uat-o365-result__avatar">
                            {(u.fullname ?? u.domainname).charAt(0).toUpperCase()}
                          </span>
                          <div className="uat-o365-result__info">
                            <span className="uat-o365-result__name">{u.fullname ?? u.domainname}</span>
                            <span className="uat-o365-result__upn">{u.domainname}</span>
                            {u.mobilephone && <span className="uat-o365-result__phone">{u.mobilephone}</span>}
                          </div>
                          {already && <span className="uat-o365-result__added-tag">Added</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
                {showDropdown && o365Search.length >= 2 && o365Results.length === 0 && !sysLoading && (
                  <div className="uat-o365-no-results">No users found matching "{o365Search}"</div>
                )}
                {o365Selected && (
                  <div className="uat-o365-preview">
                    <span className="uat-o365-preview__avatar">
                      {(o365Selected.fullname ?? o365Selected.domainname).charAt(0).toUpperCase()}
                    </span>
                    <div className="uat-o365-preview__info">
                      <span className="uat-o365-preview__name">{o365Selected.fullname ?? o365Selected.domainname}</span>
                      <span className="uat-o365-preview__upn">{o365Selected.domainname}</span>
                      {o365Selected.mobilephone && (
                        <span className="uat-o365-preview__phone">{o365Selected.mobilephone}</span>
                      )}
                    </div>
                    <button className="btn btn--primary btn--sm" onClick={handleO365Add}>
                      + Add
                    </button>
                  </div>
                )}
                {addErr && (
                  <span className="ff-error" style={{ marginTop: 6, display: 'block' }}>
                    {addErr}
                  </span>
                )}
              </div>
            )}

            {addMode === 'custom' && (
              <div className="uat-add-form">
                <div className="ff-group">
                  <label className="ff-label">
                    Full Name <span className="ff-required">*</span>
                  </label>
                  <input
                    className={`ff-input ${addErr && !newName.trim() ? 'ff-input--error' : ''}`}
                    value={newName}
                    onChange={(e) => {
                      setNewName(e.target.value);
                      setAddErr('');
                    }}
                    placeholder="Enter full name"
                  />
                </div>
                <div className="ff-group">
                  <label className="ff-label">
                    Email <span className="ff-required">*</span>
                  </label>
                  <input
                    className={`ff-input ${addErr && !newEmail.includes('@') ? 'ff-input--error' : ''}`}
                    type="email"
                    value={newEmail}
                    onChange={(e) => {
                      setNewEmail(e.target.value);
                      setAddErr('');
                    }}
                    placeholder="Enter email address"
                  />
                </div>
                <div className="ff-group">
                  <label className="ff-label">Phone</label>
                  <input
                    className="ff-input"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="Optional"
                  />
                </div>
                {addErr && <span className="ff-error">{addErr}</span>}
                <button className="btn btn--secondary" onClick={handleCustomAdd} style={{ alignSelf: 'flex-start' }}>
                  + Add Contact
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </SlidePanel>
  );
}

/* ─── Props ─────────────────────────────────────────────────────── */

export interface ISMChangesTabProps {
  activeTab: 'changes' | 'nonuat';
  impactedChanges: Array<{ change: Cgmp_changes; projects: Cgmp_projects[] }>;
  nonUATChanges: Array<{ change: Cgmp_changes; projects: Cgmp_projects[] }>;
  allChanges: Cgmp_changes[];
  allProjects: Cgmp_projects[];
  currentUserName: string;
  userProfileId?: string;
  userProfilesCacheRef: React.RefObject<Record<string, unknown>[]>;
  showToast: (type: 'success' | 'error' | 'info' | 'warning', msg: string) => void;
  onRefresh: () => void;
  onNavigateToUATStatus?: () => void;
}

/* ─── Main Tab Component ─────────────────────────────────────────── */

export default function ISMChangesTab({
  activeTab,
  impactedChanges,
  nonUATChanges,
  allChanges,
  allProjects,
  currentUserName,
  userProfileId,
  userProfilesCacheRef,
  showToast,
  onRefresh,
  onNavigateToUATStatus,
}: ISMChangesTabProps) {
  /* Expanded accordion rows */
  const [expandedChanges, setExpandedChanges] = useState<Set<string>>(new Set());

  /* Change bookmarks — keyed by user profile */
  const favChangeLsKey = `ism-fav-changes-${userProfileId ?? 'anon'}`;
  const [favChangeIds, setFavChangeIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      setFavChangeIds(new Set(JSON.parse(localStorage.getItem(favChangeLsKey) ?? '[]')));
    } catch {}
  }, [favChangeLsKey]);
  const [showFavChangesOnly, setShowFavChangesOnly] = useState(false);

  /* Concern state */
  const [concernChangeId, setConcernChangeId] = useState<string | null>(null);
  const [concernProjectId, setConcernProjectId] = useState<string | null>(null);
  const [concernType, setConcernType] = useState('');
  const [concernSeverity, setConcernSeverity] = useState<ConcernSeverity>('Medium');
  const [concernRemarks, setConcernRemarks] = useState('');
  const [concernSubmitting, setConcernSubmitting] = useState(false);

  /* Panel state (local to this tab) */
  const [viewProject, setViewProject] = useState<Cgmp_projects | null>(null);
  const [viewChangeDetail, setViewChangeDetail] = useState<Cgmp_changes | null>(null);
  const [changeUATTarget, setChangeUATTarget] = useState<{ project: Cgmp_projects; change: Cgmp_changes } | null>(null);

  const toggleChange = useCallback((id: string) => {
    setExpandedChanges((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);

  const toggleFavChange = useCallback(
    (changeId: string) => {
      setFavChangeIds((prev) => {
        const next = new Set(prev);
        next.has(changeId) ? next.delete(changeId) : next.add(changeId);
        try {
          localStorage.setItem(favChangeLsKey, JSON.stringify([...next]));
        } catch {}
        return next;
      });
    },
    [favChangeLsKey]
  );

  const clearConcern = useCallback(() => {
    setConcernChangeId(null);
    setConcernProjectId(null);
    setConcernType('');
    setConcernSeverity('Medium');
    setConcernRemarks('');
  }, []);

  const submitConcern = useCallback(async () => {
    if (!concernChangeId || !concernProjectId || !concernType || !concernRemarks.trim()) return;
    setConcernSubmitting(true);
    try {
      const change = allChanges.find((c) => c.cgmp_changeid === concernChangeId);
      if (!change) throw new Error('Change not found');

      const project = allProjects.find((p) => p.cgmp_projectid === concernProjectId);
      const projectName = project?.cgmp_name ?? concernProjectId;

      const newEntry: ConcernEntry = {
        _type: 'concern',
        concernType,
        severity: concernSeverity,
        projectId: concernProjectId,
        projectName,
        remarks: concernRemarks.trim(),
        raisedBy: currentUserName,
        timestamp: new Date().toISOString(),
      };

      const latestChange = await Cgmp_changesService.get(concernChangeId, {
        select: ['cgmp_versionhistory'] as never[],
      });
      const existingHistory = latestChange.data?.cgmp_versionhistory ?? change.cgmp_versionhistory;

      const r = await Cgmp_changesService.update(concernChangeId, {
        cgmp_versionhistory: appendHistory(existingHistory, newEntry),
      });
      if (!r.success) throw r.error ?? new Error('Failed to submit concern');

      // G2-8: track concern raised event
      trackAppEvent('concern.raised', { changeId: concernChangeId });

      const cachedProfiles = userProfilesCacheRef.current ?? [];
      const changeLocs = (change.cgmp_location ?? '')
        .split(',')
        .map((l: string) => l.trim())
        .filter(Boolean);
      const itOpsPocs = cachedProfiles.filter(
        (p: Record<string, unknown>) => (p.cgmp_role as unknown as number) === 100000002
      );
      const recipients = itOpsPocs.filter((p: Record<string, unknown>) => {
        const pocLocs = (((p as Record<string, unknown>).cgmp_assignedlocations as string) ?? '')
          .split(',')
          .map((l: string) => l.trim())
          .filter(Boolean);
        return pocLocs.length === 0 || pocLocs.some((loc: string) => changeLocs.includes(loc));
      });
      const finalRecipients = recipients.length > 0 ? recipients : itOpsPocs;
      finalRecipients.forEach((p: Record<string, unknown>) => {
        // G2-7: skip if recipient opted out of Escalation notifications
        if (!isNotifCategoryEnabled(p.cgmp_notificationcategories as string | undefined, 100000002)) return;
        // G2-6: apply quiet-hours snooze when recipient is in their quiet window
        const snoozedUntil = getQuietHoursSnoozedUntil(
          p.cgmp_quiethoursstart as number | undefined,
          p.cgmp_quiethoursend as number | undefined
        );
        Cgmp_notificationsService.create({
          cgmp_title: `Concern raised on ${change.cgmp_changenumber}`,
          cgmp_message: `${projectName} raised ${CONCERN_LABELS[concernType] ?? concernType}: ${concernRemarks.trim()}`,
          cgmp_category: asNotifCategory(100000002),
          cgmp_priority: asNotifPriority(100000000),
          cgmp_recipientid: p.cgmp_userprofileid as string,
          cgmp_relatedchangeid: concernChangeId,
          cgmp_actionurl: `#pmo?change=${change.cgmp_changenumber ?? ''}`,
          ownerid: p.cgmp_userprofileid as string,
          statecode: 0 as unknown as never,
          ...(snoozedUntil ? { cgmp_snoozeduntil: snoozedUntil } : {}),
        } as never).catch((err) => trackAppException(err, { context: 'notification.create' }));
      });

      const pmoOwner = cachedProfiles.find(
        (p: Record<string, unknown>) => p.cgmp_userprincipalname === change.cgmp_createdby
      );
      if (pmoOwner) {
        // G2-7: skip if PMO owner opted out of Escalation notifications
        if (isNotifCategoryEnabled(pmoOwner.cgmp_notificationcategories as string | undefined, 100000002)) {
          // G2-6: apply quiet-hours snooze for PMO owner
          const snoozedUntilPmo = getQuietHoursSnoozedUntil(
            pmoOwner.cgmp_quiethoursstart as number | undefined,
            pmoOwner.cgmp_quiethoursend as number | undefined
          );
          Cgmp_notificationsService.create({
            cgmp_title: `Concern raised on ${change.cgmp_changenumber}`,
            cgmp_message: `${projectName} raised ${CONCERN_LABELS[concernType] ?? concernType}: ${concernRemarks.trim()}`,
            cgmp_category: asNotifCategory(100000002),
            cgmp_priority: asNotifPriority(100000000),
            cgmp_recipientid: pmoOwner.cgmp_userprofileid as string,
            cgmp_relatedchangeid: concernChangeId,
            cgmp_actionurl: `#pmo?change=${change.cgmp_changenumber ?? ''}`,
            ownerid: pmoOwner.cgmp_userprofileid as string,
            statecode: 0 as unknown as never,
            ...(snoozedUntilPmo ? { cgmp_snoozeduntil: snoozedUntilPmo } : {}),
          } as never).catch((err) => trackAppException(err, { context: 'notification.create' }));
        }
      }

      showToast('success', 'Concern submitted. IT Ops has been notified.');
      clearConcern();
      onRefresh();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to submit concern');
    } finally {
      setConcernSubmitting(false);
    }
  }, [
    concernChangeId,
    concernProjectId,
    concernType,
    concernRemarks,
    concernSeverity,
    allChanges,
    allProjects,
    currentUserName,
    showToast,
    onRefresh,
    clearConcern,
    userProfilesCacheRef,
  ]);

  /* ── Concern form sub-component (rendered inline) ── */
  const ConcernForm = () => (
    <div className="ism-concern-form">
      <div className="ism-concern-form__title">
        <span>⚠</span> Raise a Concern
      </div>
      <div className="ism-concern-form__row">
        <label className="ism-concern-form__label">Concern Type</label>
        <select
          className="ff-input ff-select ism-concern-form__select"
          value={concernType}
          onChange={(e) => setConcernType(e.target.value)}
        >
          <option value="">— Select type —</option>
          {Object.entries(CONCERN_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="ism-concern-form__row">
        <label className="ism-concern-form__label">Severity</label>
        <select
          className="ff-input ff-select ism-concern-form__select"
          value={concernSeverity}
          onChange={(e) => setConcernSeverity(e.target.value as ConcernSeverity)}
        >
          {(['Low', 'Medium', 'High', 'Critical'] as ConcernSeverity[]).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="ism-concern-form__row">
        <label className="ism-concern-form__label">Remarks</label>
        <textarea
          className="ff-input ff-textarea ism-concern-form__textarea"
          rows={3}
          placeholder="Describe the concern or query…"
          value={concernRemarks}
          onChange={(e) => setConcernRemarks(e.target.value)}
        />
      </div>
      <div className="ism-concern-form__actions">
        <button
          className="btn btn--primary btn--sm"
          onClick={submitConcern}
          disabled={concernSubmitting || !concernType || !concernRemarks.trim()}
        >
          {concernSubmitting ? 'Submitting…' : 'Submit Concern'}
        </button>
        <button className="btn btn--ghost btn--sm" onClick={clearConcern}>
          Cancel
        </button>
      </div>
    </div>
  );

  /* ── Render a project row inside an accordion ── */
  const renderProjectRow = (c: Cgmp_changes, p: Cgmp_projects, showUATButton: boolean) => {
    const psc = p.cgmp_status as unknown as number;
    const uatData = parseChangeUATData(c.cgmp_uatusers);
    const uatCount = uatData[p.cgmp_projectid]?.contacts?.length ?? 0;
    const concerns = parseConcerns(c.cgmp_versionhistory);
    const thisProjConcern = concerns.find((e) => e.projectId === p.cgmp_projectid);
    const otherConcerns = concerns.filter((e) => e.projectId !== p.cgmp_projectid);
    const isRaisingConcern = concernChangeId === c.cgmp_changeid && concernProjectId === p.cgmp_projectid;
    const hasConcernContent = !!(thisProjConcern || otherConcerns.length > 0 || isRaisingConcern);
    const cs = c.cgmp_status as unknown as number;
    const frozen = isIsmFrozen(c.cgmp_starttime);

    return (
      <div key={p.cgmp_projectid} className="ism-proj-impact-row">
        <div className="ism-proj-impact-row__top">
          <div className="ism-proj-impact-row__info">
            <span className="ism-proj-impact-row__name">{p.cgmp_name}</span>
            <div className="ism-proj-impact-row__meta">
              {p.cgmp_pidbnumber && <span className="proj-pidb">{p.cgmp_pidbnumber}</span>}
              {p.cgmp_customer && <span className="proj-meta-chip">{p.cgmp_customer}</span>}
              {p.cgmp_region && <span className="proj-meta-chip">{p.cgmp_region}</span>}
              {p.cgmp_tower && <span className="proj-meta-chip">{p.cgmp_tower}</span>}
              <span className={`badge badge--status ${PROJ_STATUS_CLASS[psc] ?? 'status-draft'}`}>
                {PROJ_STATUS_LABEL[psc] ?? 'Unknown'}
              </span>
              {showUATButton && (
                <span className={`ism-uat-badge ${uatCount === 0 ? 'ism-uat-badge--empty' : ''}`}>
                  {uatCount === 0 ? 'No UAT Users' : `${uatCount} UAT User${uatCount !== 1 ? 's' : ''}`}
                </span>
              )}
            </div>
          </div>
          <div className="ism-proj-impact-row__actions">
            <button
              className="btn btn--xs btn--outline"
              onClick={(e) => {
                e.stopPropagation();
                setViewProject(p);
              }}
            >
              View Project
            </button>
            <button
              className="btn btn--xs btn--outline"
              onClick={(e) => {
                e.stopPropagation();
                setViewChangeDetail(c);
              }}
            >
              View Change
            </button>
            {showUATButton &&
              (() => {
                if (cs === STATUS.UATUpdates || cs === STATUS.Released) {
                  return (
                    <button
                      className={`btn btn--xs ${frozen ? 'btn--outline' : 'btn--primary'}`}
                      disabled={frozen}
                      title={frozen ? 'UAT collection is frozen (within 3 days of change)' : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        setChangeUATTarget({ project: p, change: c });
                      }}
                    >
                      {frozen ? '🔒 UAT Frozen' : 'Update UAT'}
                    </button>
                  );
                }
                if (cs === STATUS.InProgress || cs === STATUS.Completed || cs === STATUS.Closed) {
                  return (
                    <button
                      className="btn btn--xs btn--outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigateToUATStatus?.();
                      }}
                    >
                      View UAT Status
                    </button>
                  );
                }
                return (
                  <button
                    className="btn btn--xs btn--primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      setChangeUATTarget({ project: p, change: c });
                    }}
                  >
                    Update UAT
                  </button>
                );
              })()}
            {!thisProjConcern && !isRaisingConcern && (
              <button
                className="btn btn--xs btn--ghost ism-raise-concern-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setConcernChangeId(c.cgmp_changeid);
                  setConcernProjectId(p.cgmp_projectid);
                  setConcernType('');
                  setConcernSeverity('Medium');
                  setConcernRemarks('');
                }}
              >
                ⚠ Concern
              </button>
            )}
          </div>
        </div>

        {hasConcernContent && (
          <div className="ism-proj-impact-row__concern">
            {otherConcerns.length > 0 && (
              <div className="ism-concerns-others">
                <span className="ism-concerns-others__label">Other project concerns on this change</span>
                {otherConcerns.map((ce, i) => (
                  <div key={i} className="ism-concern-other-item">
                    <span className="ism-concern-other-item__project">{ce.projectName}</span>
                    <span className="ism-concern-other-item__sep">·</span>
                    <span
                      className="ism-concern-other-item__type"
                      style={{
                        background: `${CONCERN_COLORS[ce.concernType]}18`,
                        color: CONCERN_COLORS[ce.concernType] ?? 'var(--text-secondary)',
                      }}
                    >
                      {CONCERN_LABELS[ce.concernType] ?? ce.concernType}
                    </span>
                    {ce.remarks && <span className="ism-concern-other-item__remarks">{ce.remarks}</span>}
                    <span className="ism-concern-other-item__date">
                      {new Date(ce.timestamp).toLocaleDateString(undefined, { timeZone: getDisplayTimezone() })}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {thisProjConcern ? (
              <div
                className="ism-concern-own"
                style={{
                  borderLeftColor: thisProjConcern.resolvedAt
                    ? 'var(--success)'
                    : (CONCERN_COLORS[thisProjConcern.concernType] ?? 'var(--border)'),
                }}
              >
                <span className="ism-concern-own__icon">{thisProjConcern.resolvedAt ? '✓' : '⚠'}</span>
                <div className="ism-concern-own__body">
                  <div className="ism-concern-own__header">
                    <span className="ism-concern-own__label">
                      {thisProjConcern.resolvedAt ? 'Concern resolved' : 'Your concern'}
                    </span>
                    <span
                      className="ism-concern-own__type-badge"
                      style={{
                        background: `${CONCERN_COLORS[thisProjConcern.concernType]}18`,
                        color: CONCERN_COLORS[thisProjConcern.concernType] ?? 'var(--text-secondary)',
                      }}
                    >
                      {CONCERN_LABELS[thisProjConcern.concernType] ?? thisProjConcern.concernType}
                    </span>
                    {thisProjConcern.severity && (
                      <span
                        className="ism-concern-severity"
                        style={{ color: CONCERN_SEVERITY_COLORS[thisProjConcern.severity] }}
                      >
                        {thisProjConcern.severity}
                      </span>
                    )}
                  </div>
                  {thisProjConcern.remarks && <p className="ism-concern-own__remarks">{thisProjConcern.remarks}</p>}
                  {thisProjConcern.resolvedAt && (
                    <p className="ism-concern-resolution">
                      Resolved by {thisProjConcern.resolvedBy} · {thisProjConcern.resolution}
                    </p>
                  )}
                </div>
              </div>
            ) : isRaisingConcern ? (
              <ConcernForm />
            ) : null}
          </div>
        )}
      </div>
    );
  };

  /* ── Shared accordion header renderer ── */
  const renderAccordionHeader = (
    c: Cgmp_changes,
    impProjects: Cgmp_projects[],
    showFavBtn: boolean,
    showNonUATTag: boolean
  ) => {
    const sc = c.cgmp_status as unknown as number;
    const rc = c.cgmp_risklevel as unknown as number;
    const isExpanded = expandedChanges.has(c.cgmp_changeid);

    return (
      <div
        className={`ism-change-block__header ${isExpanded ? 'ism-change-block__header--expanded' : ''}`}
        onClick={() => toggleChange(c.cgmp_changeid)}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleChange(c.cgmp_changeid);
          }
        }}
      >
        <svg
          className={`ism-change-block__chevron ${isExpanded ? 'ism-change-block__chevron--open' : ''}`}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
        </svg>
        <div className="ism-change-block__info">
          <div className="ism-change-block__top">
            <span className="change-number">{c.cgmp_changenumber}</span>
            <span className="ism-change-block__title" title={c.cgmp_title ?? ''}>
              {c.cgmp_title}
            </span>
            {showNonUATTag && (
              <span
                className="badge"
                style={{
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-secondary)',
                  fontSize: 10,
                  border: '1px solid var(--border)',
                  marginLeft: 4,
                }}
              >
                Non-UAT
              </span>
            )}
          </div>
          <div className="ism-change-block__bottom">
            <span className={`badge badge--status ${statusColor(sc)}`}>{statusLabel(sc)}</span>
            <span className={`badge badge--risk ${riskColor(rc)}`}>{riskLabel(rc)}</span>
            {c.cgmp_starttime && (
              <span className="ism-change-block__dates">
                {fmtDate(c.cgmp_starttime)}
                <span className="ism-date-sep"> → </span>
                {fmtDate(c.cgmp_endtime)}
              </span>
            )}
            {!showNonUATTag &&
              c.cgmp_starttime &&
              !isIsmFrozen(c.cgmp_starttime) &&
              (() => {
                const d = daysUntilIsmFreeze(c.cgmp_starttime);
                const cls = d <= 3 ? 'sla-chip--red' : d <= 7 ? 'sla-chip--amber' : 'sla-chip--green';
                return (
                  <span className={`sla-chip ${cls}`} title="Days until ISM UAT freeze">
                    {d}d to freeze
                  </span>
                );
              })()}
            {!showNonUATTag && c.cgmp_starttime && isIsmFrozen(c.cgmp_starttime) && (
              <span className="sla-chip sla-chip--red" title="ISM UAT freeze period is active">
                Frozen
              </span>
            )}
            {showNonUATTag && (c.cgmp_status as unknown as number) === STATUS.Released && (
              <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 600 }}>
                ✓ Reviewed by IT Ops — No further action required
              </span>
            )}
            <span className="ism-change-block__proj-count">
              {impProjects.length} project{impProjects.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        {showFavBtn && (
          <button
            className={`btn btn--xs ${favChangeIds.has(c.cgmp_changeid) ? 'btn--primary' : 'btn--outline'} ism-view-change-btn`}
            onClick={(e) => {
              e.stopPropagation();
              toggleFavChange(c.cgmp_changeid);
            }}
            title={favChangeIds.has(c.cgmp_changeid) ? 'Remove bookmark' : 'Bookmark this change'}
            aria-pressed={favChangeIds.has(c.cgmp_changeid)}
            style={{ minWidth: 28, padding: '0 6px' }}
          >
            {favChangeIds.has(c.cgmp_changeid) ? '★' : '☆'}
          </button>
        )}
        <button
          className="btn btn--xs btn--outline ism-view-change-btn"
          onClick={(e) => {
            e.stopPropagation();
            setViewChangeDetail(c);
          }}
          title="View change details"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
          </svg>
          View Details
        </button>
      </div>
    );
  };

  /* ── Impacted Changes ── */
  const renderChangesTab = () => {
    if (impactedChanges.length === 0) {
      return (
        <div className="ism-empty">
          No active changes currently impacting your projects.
          <br />
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4, display: 'block' }}>
            Changes appear here when they have status Released, In Progress, or Under Review and are linked to a project
            where you are the Primary ISM.
          </span>
        </div>
      );
    }
    const filtered = impactedChanges.filter(
      ({ change: c }) => !showFavChangesOnly || favChangeIds.has(c.cgmp_changeid)
    );
    return (
      <div className="ism-change-accordion">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <button
            className={`btn btn--xs ${showFavChangesOnly ? 'btn--primary' : 'btn--outline'}`}
            onClick={() => setShowFavChangesOnly((p) => !p)}
            title="Show only bookmarked changes"
          >
            ★{' '}
            {showFavChangesOnly ? 'All Changes' : `Bookmarks${favChangeIds.size > 0 ? ` (${favChangeIds.size})` : ''}`}
          </button>
        </div>
        {filtered.map(({ change: c, projects: impProjects }) => (
          <div key={c.cgmp_changeid} className="ism-change-block">
            {renderAccordionHeader(c, impProjects, true, false)}
            {expandedChanges.has(c.cgmp_changeid) && (
              <div className="ism-change-block__projects">{impProjects.map((p) => renderProjectRow(c, p, true))}</div>
            )}
          </div>
        ))}
      </div>
    );
  };

  /* ── Non-UAT Changes ── */
  const renderNonUATTab = () => {
    if (nonUATChanges.length === 0) {
      return (
        <div className="ism-empty">
          No active non-UAT changes currently impacting your projects.
          <br />
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4, display: 'block' }}>
            Non-UAT changes appear here when they are Published, Under Review, or Released and are linked to a project
            where you are the Primary ISM.
          </span>
        </div>
      );
    }
    return (
      <div className="ism-change-accordion">
        {nonUATChanges.map(({ change: c, projects: impProjects }) => (
          <div key={c.cgmp_changeid} className="ism-change-block">
            {renderAccordionHeader(c, impProjects, false, true)}
            {expandedChanges.has(c.cgmp_changeid) && (
              <div className="ism-change-block__projects">
                {c.cgmp_description && (
                  <div
                    style={{
                      padding: '10px 14px',
                      background: 'var(--bg-secondary)',
                      borderBottom: '1px solid var(--border-light)',
                      fontSize: 13,
                      color: 'var(--text-secondary)',
                      lineHeight: 1.6,
                    }}
                  >
                    <strong style={{ color: 'var(--text-primary)' }}>Description: </strong>
                    {c.cgmp_description}
                  </div>
                )}
                {impProjects.map((p) => renderProjectRow(c, p, false))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      {activeTab === 'changes' ? renderChangesTab() : renderNonUATTab()}

      <ProjectViewPanel open={!!viewProject} project={viewProject} onClose={() => setViewProject(null)} />
      <ChangeDetailPanel
        open={!!viewChangeDetail}
        change={viewChangeDetail}
        onClose={() => setViewChangeDetail(null)}
      />
      <ChangeUATContactPanel
        open={!!changeUATTarget}
        onClose={() => setChangeUATTarget(null)}
        project={changeUATTarget?.project ?? null}
        change={changeUATTarget?.change ?? null}
        onSaved={onRefresh}
        showToast={showToast}
      />
    </>
  );
}
