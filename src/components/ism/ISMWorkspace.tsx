import { useState, useMemo, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import {
  useChangeList, useProjects, useSystemUsers,
  STATUS, isIsmFrozen, daysUntilIsmFreeze,
} from '../../hooks/useDataverse';
import { getDisplayTimezone } from '../../utils/format';
import { Cgmp_userfavoritesService, Cgmp_changesService, Cgmp_auditlogsService, Cgmp_notificationsService } from '../../generated';
import type { Cgmp_userfavorites, Cgmp_userfavoritesBase } from '../../generated/models/Cgmp_userfavoritesModel';
import type { Cgmp_notificationsBase } from '../../generated/models/Cgmp_notificationsModel';
import { asNotifCategory, asNotifPriority } from '../../utils/optionSets';
import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';
import type { Cgmp_projects } from '../../generated/models/Cgmp_projectsModel';
import { useApp } from '../../context/AppContext';
import { useUserProfiles } from '../../context/UserProfilesContext';
import { ROLES } from '../../utils/roles';
import { Dialog } from '../ui/Modal';
import { parseChangeUATData } from '../giicc/GIICCCommandCenter';

/* ─── Constants ─────────────────────────────────────────────────── */

type Tab = 'changes' | 'nonuat' | 'all' | 'favorites' | 'compliance' | 'aging' | 'uatstatus' | 'actionitems' | 'pirreview';

const IMPACT_STATUSES = new Set<number>([
  STATUS.Released, STATUS.InProgress, STATUS.UATUpdates, STATUS.Published, STATUS.UnderReview,
]);
const NON_UAT_STATUSES = new Set<number>([
  STATUS.Published, STATUS.UnderReview, STATUS.Released,
]);

/* ─── Helpers ───────────────────────────────────────────────────── */

function calcSLA(arr: { cgmp_status?: unknown }[]): number {
  const comp = arr.filter(c => (c.cgmp_status as unknown as number) === STATUS.Completed).length;
  const fail = arr.filter(c => (c.cgmp_status as unknown as number) === STATUS.Failed).length;
  const total = comp + fail;
  return total > 0 ? Math.round((comp / total) * 1000) / 10 : 100;
}

function parseUATCount(uatJson: string | undefined): number {
  if (!uatJson?.trim()) return 0;
  try {
    const p = JSON.parse(uatJson);
    if (Array.isArray(p)) return p.length;
    if (p && typeof p === 'object') return Object.keys(p).length;
  } catch { /* fall through */ }
  return 0;
}

function getPendingCount(arr: { cgmp_status?: unknown }[]): number {
  return arr.filter(c => {
    const s = c.cgmp_status as unknown as number;
    return s === STATUS.Draft || s === STATUS.Published || s === STATUS.UnderReview;
  }).length;
}

/* ─── Lazy tab components ────────────────────────────────────────── */

const ISMChangesTab = lazy(() => import('./ISMChangesTab'));
const ISMProjectsTab = lazy(() => import('./ISMProjectsTab'));
const ISMComplianceTab = lazy(() => import('./ISMComplianceTab'));
const ISMUATStatusTab = lazy(() => import('./ISMUATStatusTab'));
const ISMAgingTab = lazy(() => import('./ISMAgingTab'));
const ISMActionsTab = lazy(() => import('./ISMActionsTab'));

const TabFallback = () => <div className="ism-loading">Loading…</div>;

/* ─── Main Component ─────────────────────────────────────────────── */

export default function ISMWorkspace() {
  const { showToast, currentUserName, currentUserUpn, userProfile, isISM } = useApp();
  const { changes, loading: changesLoading, error: changesError, refresh: refreshChanges } = useChangeList();
  const { projects, loading: projectsLoading, error: projectsError, refresh: refreshProjects } = useProjects();
  const { users: systemUsers, loading: usersLoading } = useSystemUsers();
  const { userProfiles } = useUserProfiles();

  const [tab, setTab] = useState<Tab>(() => {
    try { return (localStorage.getItem('cgmp-tab-ism') as Tab | null) ?? 'changes'; } catch { return 'changes'; }
  });
  const handleTabChange = useCallback((newTab: Tab) => {
    try { localStorage.setItem('cgmp-tab-ism', newTab); } catch {}
    setTab(newTab);
  }, []);
  const [addingProject, setAddingProject] = useState(false);

  /* Sign-off dialog state (F-010) */
  const [signOffOpen, setSignOffOpen] = useState(false);
  const [signOffChange, setSignOffChange] = useState<Cgmp_changes | null>(null);
  const [signOffNote, setSignOffNote] = useState('');

  /* PIR reject dialog state (F-011) */
  const [pirRejectOpen, setPirRejectOpen] = useState(false);
  const [pirRejectChange, setPirRejectChange] = useState<Cgmp_changes | null>(null);
  const [pirRejectNote, setPirRejectNote] = useState('');

  /* Project favorites */
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favRecords, setFavRecords] = useState<Cgmp_userfavorites[]>([]);

  /* User profiles cache for concern notifications (F-021: sourced from shared context) */
  const userProfilesCacheRef = useRef<Record<string, unknown>[]>([]);
  useEffect(() => {
    userProfilesCacheRef.current = userProfiles as unknown as Record<string, unknown>[];
  }, [userProfiles]);

  /* Resolve ISM display name from SystemUsers by UPN */
  const ismUserName = useMemo(() => {
    const { users: sysUsers } = { users: systemUsers };
    if (!sysUsers.length) return currentUserName;
    if (currentUserUpn) {
      const upnLower = currentUserUpn.toLowerCase();
      const match = sysUsers.find(u =>
        u.internalemailaddress?.toLowerCase() === upnLower ||
        u.domainname?.toLowerCase() === upnLower
      );
      if (match?.fullname) return match.fullname;
    }
    return currentUserName;
  }, [systemUsers, currentUserUpn, currentUserName]);

  /* Load project favorites */
  const loadFavorites = useCallback(async () => {
    try {
      const userId = userProfile?.cgmp_userprofileid;
      if (!userId) { setFavorites(new Set()); return; }
      const r = await Cgmp_userfavoritesService.getAll({ filter: `cgmp_userid eq '${userId}'`, top: 500 });
      const recs = r.data ?? [];
      setFavRecords(recs);
      setFavorites(new Set(recs.map(f => f.cgmp_projectid)));
    } catch { /* silently fail */ }
  }, [userProfile?.cgmp_userprofileid]);

  useEffect(() => { loadFavorites(); }, [loadFavorites]);

  const handleToggleFavorite = useCallback(async (project: Cgmp_projects) => {
    const isFav = favorites.has(project.cgmp_projectid);
    const prev = new Set(favorites);
    setFavorites(s => { const n = new Set(s); isFav ? n.delete(project.cgmp_projectid) : n.add(project.cgmp_projectid); return n; });
    try {
      if (isFav) {
        const rec = favRecords.find(f => f.cgmp_projectid === project.cgmp_projectid);
        if (rec) await Cgmp_userfavoritesService.delete(rec.cgmp_userfavoriteid);
      } else {
        const userId = userProfile?.cgmp_userprofileid;
        if (!userId) { setFavorites(prev); showToast('error', 'Profile not loaded'); return; }
        await Cgmp_userfavoritesService.create({
          cgmp_favoritename: project.cgmp_name,
          cgmp_projectid: project.cgmp_projectid,
          cgmp_userid: userId,
        } as unknown as Omit<Cgmp_userfavoritesBase, 'cgmp_userfavoriteid'>);
      }
      await loadFavorites();
    } catch { setFavorites(prev); showToast('error', 'Failed to update favorite'); }
  }, [favorites, favRecords, loadFavorites, showToast, userProfile?.cgmp_userprofileid]);

  /* ── Derived data ──────────────────────────────────────────────── */

  const ismProjects = useMemo(() => {
    const userId = userProfile?.cgmp_userprofileid;
    return projects.filter(p => {
      // F-022: GUID match is authoritative. When cgmp_primaryismid is present on the project,
      // compare exclusively against the user profile GUID — never fall back to the display name.
      if (p.cgmp_primaryismid) {
        return p.cgmp_primaryismid === userId;
      }
      // Legacy display-name fallback: only applies when the project record has no GUID yet
      // but does have a display-name value. Emit a DEV-mode warning to surface un-migrated records.
      if (p.cgmp_primaryism) {
        if (import.meta.env.DEV) {
          console.warn(`[CGMP] Project "${p.cgmp_name}" is missing cgmp_primaryismid — using legacy display-name match. Run the ISM GUID migration flow.`);
        }
        return p.cgmp_primaryism === ismUserName;
      }
      return false;
    });
  }, [projects, ismUserName, userProfile?.cgmp_userprofileid]);

  const impactedChanges = useMemo(() => {
    return changes
      .filter(c => IMPACT_STATUSES.has(c.cgmp_status as unknown as number) && !!(c as unknown as Record<string, unknown>).cgmp_uatrequired)
      .map(c => {
        const linkedIds = new Set(c.cgmp_projectids?.split(',').map(s => s.trim()).filter(Boolean) ?? []);
        const myProjects = ismProjects.filter(p => linkedIds.has(p.cgmp_projectid));
        return { change: c, projects: myProjects };
      })
      .filter(item => item.projects.length > 0)
      .sort((a, b) =>
        new Date(b.change.cgmp_starttime ?? b.change.createdon ?? 0).getTime() -
        new Date(a.change.cgmp_starttime ?? a.change.createdon ?? 0).getTime()
      );
  }, [changes, ismProjects]);

  const nonUATChanges = useMemo(() => {
    return changes
      .filter(c => NON_UAT_STATUSES.has(c.cgmp_status as unknown as number) && !(c as unknown as Record<string, unknown>).cgmp_uatrequired)
      .map(c => {
        const linkedIds = new Set(c.cgmp_projectids?.split(',').map(s => s.trim()).filter(Boolean) ?? []);
        const myProjects = ismProjects.filter(p => linkedIds.has(p.cgmp_projectid));
        return { change: c, projects: myProjects };
      })
      .filter(item => item.projects.length > 0)
      .sort((a, b) =>
        new Date(b.change.cgmp_starttime ?? b.change.createdon ?? 0).getTime() -
        new Date(a.change.cgmp_starttime ?? a.change.createdon ?? 0).getTime()
      );
  }, [changes, ismProjects]);

  const actionItems = useMemo(() => {
    return impactedChanges
      .map(({ change: c, projects }) => {
        const frozen = c.cgmp_starttime ? isIsmFrozen(c.cgmp_starttime) : false;
        const daysToFreeze = c.cgmp_starttime ? daysUntilIsmFreeze(c.cgmp_starttime) : null;
        const urgency: 'critical' | 'warning' | 'info' =
          frozen || (daysToFreeze !== null && daysToFreeze <= 3) ? 'critical' :
          daysToFreeze !== null && daysToFreeze <= 7 ? 'warning' : 'info';
        return { change: c, projects, urgency, daysToFreeze, frozen };
      })
      .sort((a, b) => {
        const order = { critical: 0, warning: 1, info: 2 };
        if (order[a.urgency] !== order[b.urgency]) return order[a.urgency] - order[b.urgency];
        return (a.daysToFreeze ?? 999) - (b.daysToFreeze ?? 999);
      });
  }, [impactedChanges]);

  const changesByProject = useMemo(() => {
    const map = new Map<string, typeof changes>();
    ismProjects.forEach(p => {
      map.set(p.cgmp_projectid, changes.filter(c =>
        c.cgmp_projectids?.split(',').map(s => s.trim()).includes(p.cgmp_projectid)
      ));
    });
    return map;
  }, [ismProjects, changes]);

  const complianceRows = useMemo(() => ismProjects.map(p => {
    const pch = changesByProject.get(p.cgmp_projectid) ?? [];
    return {
      project: p,
      total: pch.length,
      completed: pch.filter(c => (c.cgmp_status as unknown as number) === STATUS.Completed).length,
      failed: pch.filter(c => (c.cgmp_status as unknown as number) === STATUS.Failed).length,
      pending: getPendingCount(pch),
      sla: calcSLA(pch),
      uat: parseUATCount(p.cgmp_uatusers),
    };
  }), [ismProjects, changesByProject]);

  const projectHealthScores = useMemo(() => {
    const map = new Map<string, number>();
    for (const { project: p, sla, failed, uat, total } of complianceRows) {
      let score = 100;
      score -= (100 - sla) * 0.4;
      score -= Math.min(failed * 5, 30);
      if (uat === 0 && total > 0) score -= 15;
      map.set(p.cgmp_projectid, Math.max(0, Math.min(100, Math.round(score))));
    }
    return map;
  }, [complianceRows]);

  /* KPI derived values */
  const activeCount = useMemo(() => ismProjects.filter(p => (p.cgmp_status as unknown as number) === 100000000).length, [ismProjects]);
  const noUATCount = useMemo(() =>
    impactedChanges.filter(({ change: c }) => {
      const data = parseChangeUATData((c as unknown as Record<string, unknown>).cgmp_uatusers as string);
      return Object.values(data).every(e => !e.contacts?.length);
    }).length,
  [impactedChanges]);
  const avgSLA = useMemo(() => {
    if (ismProjects.length === 0) return 100;
    const slas = ismProjects.map(p => calcSLA(changesByProject.get(p.cgmp_projectid) ?? []));
    return Math.round(slas.reduce((a, b) => a + b, 0) / slas.length * 10) / 10;
  }, [ismProjects, changesByProject]);

  /* Aging count for KPI (fixed 7-day threshold — tab has its own local threshold) */
  const agingKpiCount = useMemo(() => {
    const now = Date.now();
    const DAY = 86400000;
    const THRESHOLD = 7;
    const ismProjectIds = new Set(ismProjects.map(p => p.cgmp_projectid));
    return changes.filter(c => {
      const s = c.cgmp_status as unknown as number;
      if (!(s === STATUS.Draft || s === STATUS.Published || s === STATUS.UnderReview || s === STATUS.Released)) return false;
      if (new Date(c.createdon ?? 0).getTime() >= now - THRESHOLD * DAY) return false;
      return (c.cgmp_projectids ?? '').split(',').map(x => x.trim()).filter(Boolean).some(pid => ismProjectIds.has(pid));
    }).length;
  }, [changes, ismProjects]);

  /* Released changes without ISM sign-off for the sign-off action (F-010) */
  const releasedPendingSignOff = useMemo(() => {
    const ismProjectIds = new Set(ismProjects.map(p => p.cgmp_projectid));
    return changes.filter(c => {
      if ((c.cgmp_status as unknown as number) !== STATUS.Released) return false;
      if (c.cgmp_ismsignoffat) return false;
      const pids = c.cgmp_projectids?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
      return pids.some(pid => ismProjectIds.has(pid));
    });
  }, [changes, ismProjects]);

  /* Changes with submitted PIR awaiting ISM review (F-011) */
  const pirSubmittedChanges = useMemo(() => {
    const ismProjectIds = new Set(ismProjects.map(p => p.cgmp_projectid));
    return changes.filter(c => {
      if ((c.cgmp_pirstatus as unknown as number) !== 100000001) return false;
      const pids = c.cgmp_projectids?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
      return pids.some(pid => ismProjectIds.has(pid));
    });
  }, [changes, ismProjects]);

  /* ISM sign-off handler (F-010) */
  async function handleSignOff(change: Cgmp_changes, note: string) {
    if (change.cgmp_starttime && isIsmFrozen(change.cgmp_starttime)) {
      showToast('error', 'Cannot perform this action during an ISM freeze period.');
      return;
    }
    try {
      await Cgmp_changesService.update(change.cgmp_changeid, {
        cgmp_ismsignoffat: new Date().toISOString() as any,
        cgmp_ismsignoffby: currentUserName,
      } as any);
      await Cgmp_auditlogsService.create({
        cgmp_auditlogname: `ISM Sign-Off — ${change.cgmp_changenumber}`,
        cgmp_eventtype: 100000006 as any,
        cgmp_entitytype: 100000000 as any,
        cgmp_entityid: change.cgmp_changeid,
        cgmp_entityname: change.cgmp_changenumber,
        cgmp_username: currentUserName,
        cgmp_useremail: currentUserUpn,
        cgmp_notes: `ISM sign-off confirmed.${note ? ' Notes: ' + note : ''}`,
      } as any);
      const giiccProfiles = userProfiles.filter(p => Number(p.cgmp_role) === ROLES.GIICC);
      await Promise.allSettled(giiccProfiles.map(p =>
        Cgmp_notificationsService.create({
          cgmp_title: `ISM sign-off complete — ${change.cgmp_changenumber}`,
          cgmp_message: `ISM has confirmed UAT sign-off for change ${change.cgmp_changenumber}.`,
          cgmp_recipientid: p.cgmp_userprofileid,
          cgmp_isread: false,
          cgmp_category: asNotifCategory(100000004),
          cgmp_priority: asNotifPriority(100000001),
          cgmp_actionurl: `#pmo?change=${change.cgmp_changenumber ?? ''}`,
        } as unknown as Omit<Cgmp_notificationsBase, 'cgmp_notificationid'>)
      ));
      setSignOffOpen(false);
      setSignOffChange(null);
      setSignOffNote('');
      refreshChanges();
    } catch (err) {
      if (import.meta.env.DEV) console.error('ISM sign-off failed', err);
    }
  }

  /* PIR approve handler (F-011) */
  async function handlePIRApprove(change: Cgmp_changes) {
    if (change.cgmp_starttime && isIsmFrozen(change.cgmp_starttime)) {
      showToast('error', 'Cannot perform this action during an ISM freeze period.');
      return;
    }
    try {
      await Cgmp_changesService.update(change.cgmp_changeid, {
        cgmp_pirstatus: 100000002 as any,
      } as any);
      await Cgmp_auditlogsService.create({
        cgmp_auditlogname: `PIR Approved — ${change.cgmp_changenumber}`,
        cgmp_eventtype: 100000014 as any,
        cgmp_entitytype: 100000000 as any,
        cgmp_entityid: change.cgmp_changeid,
        cgmp_entityname: change.cgmp_changenumber,
        cgmp_username: currentUserName,
        cgmp_useremail: currentUserUpn,
        cgmp_notes: 'PIR approved by ISM',
      } as any);
      const giiccProfiles = userProfiles.filter(p => Number(p.cgmp_role) === ROLES.GIICC);
      await Promise.allSettled(giiccProfiles.map(p =>
        Cgmp_notificationsService.create({
          cgmp_title: `PIR approved — ${change.cgmp_changenumber}`,
          cgmp_message: `ISM has approved the PIR for change ${change.cgmp_changenumber}.`,
          cgmp_recipientid: p.cgmp_userprofileid,
          cgmp_isread: false,
          cgmp_category: asNotifCategory(100000004),
          cgmp_priority: asNotifPriority(100000001),
          cgmp_actionurl: `#pmo?change=${change.cgmp_changenumber ?? ''}`,
        } as unknown as Omit<Cgmp_notificationsBase, 'cgmp_notificationid'>)
      ));
      refreshChanges();
    } catch (err) {
      if (import.meta.env.DEV) console.error('PIR approve failed', err);
    }
  }

  /* PIR reject handler (F-011) */
  async function handlePIRReject(change: Cgmp_changes, rejectNote: string) {
    if (change.cgmp_starttime && isIsmFrozen(change.cgmp_starttime)) {
      showToast('error', 'Cannot perform this action during an ISM freeze period.');
      return;
    }
    try {
      await Cgmp_changesService.update(change.cgmp_changeid, {
        cgmp_pirstatus: 100000003 as any,
      } as any);
      await Cgmp_auditlogsService.create({
        cgmp_auditlogname: `PIR Rejected — ${change.cgmp_changenumber}`,
        cgmp_eventtype: 100000014 as any,
        cgmp_entitytype: 100000000 as any,
        cgmp_entityid: change.cgmp_changeid,
        cgmp_entityname: change.cgmp_changenumber,
        cgmp_username: currentUserName,
        cgmp_useremail: currentUserUpn,
        cgmp_notes: `PIR rejected — ${rejectNote}`,
      } as any);
      const giiccProfiles = userProfiles.filter(p => Number(p.cgmp_role) === ROLES.GIICC);
      await Promise.allSettled(giiccProfiles.map(p =>
        Cgmp_notificationsService.create({
          cgmp_title: `PIR rejected — ${change.cgmp_changenumber}`,
          cgmp_message: `ISM has rejected the PIR for change ${change.cgmp_changenumber}${rejectNote ? ': ' + rejectNote : ''}.`,
          cgmp_recipientid: p.cgmp_userprofileid,
          cgmp_isread: false,
          cgmp_category: asNotifCategory(100000004),
          cgmp_priority: asNotifPriority(100000001),
          cgmp_actionurl: `#pmo?change=${change.cgmp_changenumber ?? ''}`,
        } as unknown as Omit<Cgmp_notificationsBase, 'cgmp_notificationid'>)
      ));
      setPirRejectOpen(false);
      setPirRejectChange(null);
      setPirRejectNote('');
      refreshChanges();
    } catch (err) {
      if (import.meta.env.DEV) console.error('PIR reject failed', err);
    }
  }

  const loading = changesLoading || projectsLoading;
  const dataError = changesError || projectsError;

  if (dataError && projects.length === 0 && changes.length === 0) {
    return (
      <div className="module-empty" role="alert">
        <p style={{ color: 'var(--danger)' }}>Failed to load data: {String(dataError)}</p>
        <button className="btn btn--outline" onClick={() => { refreshChanges(); refreshProjects(); }}>Retry</button>
      </div>
    );
  }

  return (
    <div className="ism-workspace">
      {/* ── Header ── */}
      <div className="ism-header">
        <div>
          <h1 className="ism-title">ISM Workspace</h1>
          <p className="ism-subtitle">Project oversight, UAT coordination, and compliance management</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {tab === 'all' && (
            <button className="btn btn--primary btn--sm" onClick={() => setAddingProject(true)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 4 }}>
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
              </svg>
              Add Project
            </button>
          )}
          <button className="btn btn--outline btn--sm" onClick={() => { refreshProjects(); refreshChanges(); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="ism-kpis">
        {[
          { value: ismProjects.length, label: 'My Projects', color: 'var(--primary)' },
          { value: impactedChanges.length, label: 'Impacted Changes', color: impactedChanges.length > 0 ? 'var(--orange)' : 'var(--text-tertiary)' },
          { value: activeCount, label: 'Active', color: 'var(--success)' },
          { value: loading ? '—' : `${avgSLA}%`, label: 'Avg SLA', color: loading ? 'var(--text-tertiary)' : avgSLA < 80 ? 'var(--danger)' : avgSLA < 95 ? 'var(--orange)' : 'var(--success)' },
          { value: noUATCount, label: 'No UAT Users', color: noUATCount > 0 ? 'var(--danger)' : 'var(--success)' },
          { value: agingKpiCount, label: 'Aging (>7d)', color: agingKpiCount > 0 ? 'var(--orange)' : 'var(--text-tertiary)' },
        ].map(({ value, label, color }) => (
          <div key={label} className="ism-kpi">
            <span className="ism-kpi__value" style={{ color: color || undefined }}>{value}</span>
            <span className="ism-kpi__label">{label}</span>
          </div>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div className="ism-tabs" role="tablist" aria-label="ISM workspace views">
        {([
          ['changes', `Impacted Changes (${impactedChanges.length})`],
          ['nonuat', `Non-UAT Changes (${nonUATChanges.length})`],
          ['all', `All Projects (${ismProjects.length})`],
          ['favorites', `★ Favorites (${favorites.size})`],
          ['compliance', 'Compliance'],
          ['aging', `Aging (${agingKpiCount})`],
          ['uatstatus', 'Change UAT Status'],
          ['actionitems', `⚡ My Actions${actionItems.length > 0 ? ` (${actionItems.length})` : ''}`],
          ['pirreview', `PIR Review${pirSubmittedChanges.length > 0 ? ` (${pirSubmittedChanges.length})` : ''}`],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            role="tab"
            id={`ism-tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`ism-panel-${t}`}
            tabIndex={tab === t ? 0 : -1}
            className={`ism-tab ${tab === t ? 'ism-tab--active' : ''}`}
            onClick={() => handleTabChange(t)}
            onKeyDown={(e) => {
              const tabs: Tab[] = ['changes', 'nonuat', 'all', 'favorites', 'compliance', 'aging', 'uatstatus', 'actionitems', 'pirreview'];
              const idx = tabs.indexOf(tab);
              if (e.key === 'ArrowRight') { e.preventDefault(); handleTabChange(tabs[(idx + 1) % tabs.length]); }
              if (e.key === 'ArrowLeft') { e.preventDefault(); handleTabChange(tabs[(idx - 1 + tabs.length) % tabs.length]); }
            }}
            style={t === 'actionitems' && actionItems.some(i => i.urgency === 'critical') ? { color: 'var(--danger)', fontWeight: 700 } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div className="ism-content">
        {loading && <div className="ism-loading">Loading…</div>}

        {dataError && (
          <div className="workspace-error" role="alert" style={{ padding: '24px', textAlign: 'center' }}>
            <p style={{ color: 'var(--danger)', fontWeight: 600 }}>Failed to load ISM workspace data.</p>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
              {dataError ?? 'An unexpected error occurred.'}
            </p>
            <button
              className="btn btn-secondary"
              style={{ marginTop: 12 }}
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && (tab === 'changes' || tab === 'nonuat') && (
          <div role="tabpanel" id={`ism-panel-${tab}`} aria-labelledby={`ism-tab-${tab}`} tabIndex={0}>
            <Suspense fallback={<TabFallback />}>
              <ISMChangesTab
                activeTab={tab as 'changes' | 'nonuat'}
                impactedChanges={impactedChanges}
                nonUATChanges={nonUATChanges}
                allChanges={changes}
                allProjects={projects}
                currentUserName={currentUserName}
                userProfileId={userProfile?.cgmp_userprofileid}
                userProfilesCacheRef={userProfilesCacheRef}
                showToast={showToast}
                onRefresh={refreshChanges}
                onNavigateToUATStatus={() => handleTabChange('uatstatus')}
              />
            </Suspense>
            {isISM && tab === 'changes' && releasedPendingSignOff.length > 0 && (
              <div className="ism-signoff-section" style={{ marginTop: 24 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>
                  Released — Pending ISM Sign-Off ({releasedPendingSignOff.length})
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {releasedPendingSignOff.map(c => (
                    <div key={c.cgmp_changeid} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--surface-1)', borderRadius: 6, border: '1px solid var(--border)' }}>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{c.cgmp_changenumber}</span>
                        <span style={{ marginLeft: 10, color: 'var(--text-secondary)', fontSize: 13 }}>{c.cgmp_title}</span>
                      </div>
                      <button
                        className="btn btn--primary btn--sm"
                        onClick={() => { setSignOffChange(c); setSignOffNote(''); setSignOffOpen(true); }}
                      >
                        Sign Off UAT
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!loading && (tab === 'all' || tab === 'favorites') && (
          <div role="tabpanel" id={`ism-panel-${tab}`} aria-labelledby={`ism-tab-${tab}`} tabIndex={0}>
            <Suspense fallback={<TabFallback />}>
              <ISMProjectsTab
                activeTab={tab as 'all' | 'favorites'}
                ismProjects={ismProjects}
                allProjects={projects}
                changes={changes}
                projectHealthScores={projectHealthScores}
                favorites={favorites}
                onToggleFavorite={handleToggleFavorite}
                ismUserName={ismUserName}
                systemUsers={systemUsers}
                usersLoading={usersLoading}
                showToast={showToast}
                onRefresh={refreshProjects}
                addingProject={addingProject}
                onCloseAdd={() => setAddingProject(false)}
              />
            </Suspense>
          </div>
        )}

        {!loading && tab === 'compliance' && (
          <div role="tabpanel" id="ism-panel-compliance" aria-labelledby="ism-tab-compliance" tabIndex={0}>
            <Suspense fallback={<TabFallback />}>
              <ISMComplianceTab complianceRows={complianceRows} />
            </Suspense>
          </div>
        )}

        {!loading && tab === 'uatstatus' && (
          <div role="tabpanel" id="ism-panel-uatstatus" aria-labelledby="ism-tab-uatstatus" tabIndex={0}>
            <Suspense fallback={<TabFallback />}>
              <ISMUATStatusTab changes={changes} ismProjects={ismProjects} />
            </Suspense>
          </div>
        )}

        {!loading && tab === 'aging' && (
          <div role="tabpanel" id="ism-panel-aging" aria-labelledby="ism-tab-aging" tabIndex={0}>
            <Suspense fallback={<TabFallback />}>
              <ISMAgingTab ismProjects={ismProjects} changes={changes} />
            </Suspense>
          </div>
        )}

        {!loading && tab === 'actionitems' && (
          <div role="tabpanel" id="ism-panel-actionitems" aria-labelledby="ism-tab-actionitems" tabIndex={0}>
            <Suspense fallback={<TabFallback />}>
              <ISMActionsTab
                actionItems={actionItems}
                changes={changes}
                ismProjects={ismProjects}
                systemUsers={systemUsers}
                currentUserName={currentUserName}
                currentUserUpn={currentUserUpn}
                userProfileId={userProfile?.cgmp_userprofileid}
                showToast={showToast}
                onRefresh={refreshChanges}
              />
            </Suspense>
          </div>
        )}

        {!loading && tab === 'pirreview' && (
          <div role="tabpanel" id="ism-panel-pirreview" aria-labelledby="ism-tab-pirreview" tabIndex={0}>
            {pirSubmittedChanges.length === 0 ? (
              <div className="module-empty">
                <p>No changes with submitted PIRs at this time.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {pirSubmittedChanges.map(c => (
                  <div key={c.cgmp_changeid} style={{ padding: 16, background: 'var(--surface-1)', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                          {c.cgmp_changenumber} — {c.cgmp_title}
                        </div>
                        {c.cgmp_actualendtime && (
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                            Completion: {new Date(c.cgmp_actualendtime).toLocaleDateString(undefined, { timeZone: getDisplayTimezone() })}
                          </div>
                        )}
                        {c.cgmp_pirnotes && (
                          <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', maxWidth: 600 }}>
                            {c.cgmp_pirnotes}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                        <button
                          className="btn btn--success btn--sm"
                          onClick={() => handlePIRApprove(c)}
                        >
                          Approve PIR
                        </button>
                        <button
                          className="btn btn--danger btn--sm"
                          onClick={() => { setPirRejectChange(c); setPirRejectNote(''); setPirRejectOpen(true); }}
                        >
                          Reject PIR
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Sign-Off Dialog (F-010) ── */}
      <Dialog
        open={signOffOpen}
        onClose={() => { setSignOffOpen(false); setSignOffChange(null); setSignOffNote(''); }}
        title="ISM Sign-Off — UAT Confirmation"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn--outline btn--sm" onClick={() => { setSignOffOpen(false); setSignOffChange(null); setSignOffNote(''); }}>Cancel</button>
            <button
              className="btn btn--primary btn--sm"
              onClick={() => { if (signOffChange) handleSignOff(signOffChange, signOffNote); }}
            >
              Confirm Sign-Off
            </button>
          </div>
        }
      >
        {signOffChange && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Change</label>
              <div style={{ padding: '8px 12px', background: 'var(--surface-1)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13 }}>
                {signOffChange.cgmp_changenumber} — {signOffChange.cgmp_title}
              </div>
            </div>
            <div>
              <label htmlFor="ism-signoff-note" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Sign-off notes (optional)</label>
              <textarea
                id="ism-signoff-note"
                rows={3}
                value={signOffNote}
                onChange={e => setSignOffNote(e.target.value)}
                style={{ width: '100%', resize: 'vertical', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-0)', color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box' }}
                placeholder="Optional notes for the sign-off record…"
              />
            </div>
          </div>
        )}
      </Dialog>

      {/* ── PIR Reject Dialog (F-011) ── */}
      <Dialog
        open={pirRejectOpen}
        onClose={() => { setPirRejectOpen(false); setPirRejectChange(null); setPirRejectNote(''); }}
        title="Reject PIR"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn--outline btn--sm" onClick={() => { setPirRejectOpen(false); setPirRejectChange(null); setPirRejectNote(''); }}>Cancel</button>
            <button
              className="btn btn--danger btn--sm"
              onClick={() => { if (pirRejectChange) handlePIRReject(pirRejectChange, pirRejectNote); }}
            >
              Confirm Rejection
            </button>
          </div>
        }
      >
        {pirRejectChange && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Change</label>
              <div style={{ padding: '8px 12px', background: 'var(--surface-1)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13 }}>
                {pirRejectChange.cgmp_changenumber} — {pirRejectChange.cgmp_title}
              </div>
            </div>
            <div>
              <label htmlFor="ism-pir-reject-note" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Rejection reason</label>
              <textarea
                id="ism-pir-reject-note"
                rows={3}
                value={pirRejectNote}
                onChange={e => setPirRejectNote(e.target.value)}
                style={{ width: '100%', resize: 'vertical', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-0)', color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box' }}
                placeholder="Provide a reason for rejecting the PIR…"
              />
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
