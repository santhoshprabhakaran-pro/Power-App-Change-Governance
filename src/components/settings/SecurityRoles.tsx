import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Cgmp_userprofilesService, Cgmp_auditlogsService } from '../../generated';
import type { Cgmp_userprofiles } from '../../generated/models/Cgmp_userprofilesModel';
import type { Cgmp_userprofilescgmp_role } from '../../generated/models/Cgmp_userprofilesModel';
import type { Cgmp_auditlogsBase } from '../../generated/models/Cgmp_auditlogsModel';
import type { Cgmp_auditlogscgmp_entitytype, Cgmp_auditlogscgmp_eventtype } from '../../generated/models/Cgmp_auditlogsModel';
import type { Systemusers } from '../../generated/models/SystemusersModel';
import { getBrowserInfo, fmtDateTime } from '../../utils/format';
import { useApp } from '../../context/AppContext';
import { useProjects, useSystemUsers, useChangeList } from '../../hooks/useDataverse';
import { EXTENDED_ROLES, EXTENDED_ROLE_LABEL } from '../../utils/roles';
import { exportCSV } from '../../utils/csv';
import { Dialog } from '../ui/Modal';
import ConfirmDialog from '../ui/ConfirmDialog';

const ROLE_LABEL: Record<number, string> = {
  100000000: 'Admin', 100000001: 'PMO', 100000002: 'IT Ops POC',
  100000003: 'ISM', 100000004: 'GIICC',
};
const ROLE_CLASS: Record<number, string> = {
  100000000: 'status-released', 100000001: 'status-review', 100000002: 'status-uat',
  100000003: 'status-published', 100000004: 'status-inprogress',
  100000005: 'status-draft', 100000006: 'status-published', 100000007: 'status-released',
};
const ROLE_OPTS = Object.entries(ROLE_LABEL).map(([v, l]) => ({ value: v, label: l }));

function deriveName(upn: string | undefined, ownerName: string | undefined, sysUserMap?: Map<string, string>): string {
  if (ownerName) return ownerName;
  if (!upn) return '—';
  const fromMap = sysUserMap?.get(upn.toLowerCase());
  if (fromMap) return fromMap;
  const local = upn.split('@')[0];
  return local.split(/[._-]/).map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ') || upn;
}

function lastActiveLabel(modifiedon: string | undefined): { label: string; status: 'online' | 'recent' | 'idle' } {
  if (!modifiedon) return { label: 'Never', status: 'idle' };
  const diffMs = Date.now() - new Date(modifiedon).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 15) return { label: 'Active now', status: 'online' };
  if (mins < 60) return { label: `${mins}m ago`, status: 'recent' };
  const hrs = Math.floor(diffMs / 3600000);
  if (hrs < 24) return { label: `${hrs}h ago`, status: 'recent' };
  const days = Math.floor(diffMs / 86400000);
  return { label: `${days}d ago`, status: 'idle' };
}

export default function SecurityRoles() {
  const { showToast, isAdmin, userLoading, currentUserName, currentUserUpn } = useApp();
  const { changes } = useChangeList();
  const [users, setUsers] = useState<Cgmp_userprofiles[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState('');
  const [saving, setSaving] = useState(false);
  const [secTab, setSecTab] = useState<'roles' | 'activity' | 'itopspocs'>(() => {
    try { return (localStorage.getItem('cgmp-tab-security') as 'roles' | 'activity' | 'itopspocs' | null) ?? 'roles'; } catch { return 'roles'; }
  });
  const handleSecTabChange = useCallback((val: 'roles' | 'activity' | 'itopspocs') => {
    try { localStorage.setItem('cgmp-tab-security', val); } catch {}
    setSecTab(val);
  }, []);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRole, setBulkRole] = useState('100000001');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [toggleTarget, setToggleTarget] = useState<Cgmp_userprofiles | null>(null);
  const [bulkAssignConfirm, setBulkAssignConfirm] = useState(false);
  const [saveRoleConfirm, setSaveRoleConfirm] = useState<{ userId: string; msg: string } | null>(null);
  const [editLocations, setEditLocations] = useState('');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const r = await Cgmp_userprofilesService.getAll({
        orderBy: ['cgmp_userprincipalname asc'],
        top: 500,
      });
      setUsers(r.data ?? []);
    } catch { setUsers([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!isAdmin) return; // Don't fetch if not admin
    loadUsers();
  }, [isAdmin, loadUsers]);

  /* IT Ops POC Assignment tab */
  const { projects } = useProjects();
  const [editingPocId, setEditingPocId] = useState<string | null>(null);
  const [pocLocationDraft, setPocLocationDraft] = useState<string[]>([]);
  const [pocSaving, setPocSaving] = useState(false);

  const allLocations = useMemo(() =>
    [...new Set(projects.map(p => p.cgmp_location).filter(Boolean) as string[])].sort(),
    [projects]
  );

  const itOpsPocProfiles = useMemo(() =>
    users.filter(u => (u.cgmp_role as unknown as number) === 100000002),
    [users]
  );

  const savePocLocations = async (profileId: string) => {
    setPocSaving(true);
    try {
      const r = await Cgmp_userprofilesService.update(profileId, {
        cgmp_assignedlocations: pocLocationDraft.join(','),
      } as any);
      if (!r.success) throw r.error ?? new Error('Failed to save');
      showToast('success', 'IT Ops POC locations saved');
      setEditingPocId(null);
      loadUsers();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Save failed');
    } finally {
      setPocSaving(false);
    }
  };

  /* ── Add User / Group ─────────────────────────────────────────── */
  const { users: sysUsers, loading: sysLoading } = useSystemUsers();
  const sysUserMap = useMemo(() => {
    const m = new Map<string, string>();
    sysUsers.forEach(u => {
      if (u.internalemailaddress && u.fullname) m.set(u.internalemailaddress.toLowerCase(), u.fullname);
      if (u.domainname && u.fullname) m.set(u.domainname.toLowerCase(), u.fullname);
    });
    return m;
  }, [sysUsers]);
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<'individual' | 'group'>('individual');
  const [addRole, setAddRole] = useState('100000001');
  const [addSelUser, setAddSelUser] = useState<Systemusers | null>(null);
  const [addSearch, setAddSearch] = useState('');
  const [addGroupName, setAddGroupName] = useState('');
  const [addGroupUpns, setAddGroupUpns] = useState('');
  type ResolvedMember = { user: Systemusers | null; upn: string };
  const [resolvedMembers, setResolvedMembers] = useState<ResolvedMember[]>([]);
  const [addSaving, setAddSaving] = useState(false);
  const addSearchRef = useRef<HTMLInputElement>(null);

  const addSearchResults = useMemo(() => {
    if (!addSearch.trim()) return [];
    const q = addSearch.toLowerCase();
    return sysUsers.filter(u =>
      u.fullname?.toLowerCase().includes(q) ||
      u.internalemailaddress?.toLowerCase().includes(q) ||
      u.domainname?.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [addSearch, sysUsers]);

  const resolveGroupMembers = useCallback(() => {
    const lines = addGroupUpns.split(/[\n,;]+/).map(l => l.trim()).filter(Boolean);
    const resolved: ResolvedMember[] = lines.map(upn => {
      const found = sysUsers.find(u =>
        u.internalemailaddress?.toLowerCase() === upn.toLowerCase() ||
        u.domainname?.toLowerCase() === upn.toLowerCase() ||
        u.fullname?.toLowerCase() === upn.toLowerCase()
      );
      return { user: found ?? null, upn };
    });
    setResolvedMembers(resolved);
  }, [addGroupUpns, sysUsers]);

  const createProfile = async (upn: string, displayName: string, roleVal: number) => {
    const existing = users.find(u => u.cgmp_userprincipalname?.toLowerCase() === upn.toLowerCase());
    if (existing) throw new Error(`${displayName} already has a profile`);
    const r = await Cgmp_userprofilesService.create({
      cgmp_userprincipalname: upn,
      cgmp_role: roleVal as unknown as Cgmp_userprofilescgmp_role,
    } as any);
    if (!r.success) throw r.error ?? new Error(`Failed to create profile for ${displayName}`);
  };

  const doAddUsers = useCallback(async () => {
    setAddSaving(true);
    const roleVal = parseInt(addRole);
    const errs: string[] = [];
    try {
      if (addMode === 'individual') {
        if (!addSelUser) return;
        const upn = addSelUser.internalemailaddress || addSelUser.domainname || '';
        await createProfile(upn, addSelUser.fullname ?? upn, roleVal);
        showToast('success', `Added ${addSelUser.fullname ?? upn} as ${ROLE_LABEL[roleVal]}`);
      } else {
        const toAdd = resolvedMembers.filter(m => m.user !== null);
        if (toAdd.length === 0) { showToast('error', 'No resolved members to add'); return; }
        for (const m of toAdd) {
          const upn = m.user!.internalemailaddress || m.user!.domainname || m.upn;
          try { await createProfile(upn, m.user!.fullname ?? upn, roleVal); }
          catch (e) { errs.push(e instanceof Error ? e.message : upn); }
        }
        if (errs.length === 0) showToast('success', `Added ${toAdd.length} member${toAdd.length !== 1 ? 's' : ''} as ${ROLE_LABEL[roleVal]}`);
        else showToast('error', `${errs.length} failed: ${errs.slice(0, 2).join('; ')}${errs.length > 2 ? '…' : ''}`);
      }
      setAddOpen(false);
      setAddSelUser(null); setAddSearch(''); setAddGroupName(''); setAddGroupUpns(''); setResolvedMembers([]);
      loadUsers();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to add user');
    } finally { setAddSaving(false); }
  }, [addMode, addRole, addSelUser, resolvedMembers, users, loadUsers, showToast]);

  const [userSearch, setUserSearch] = useState('');
  const filteredUsers = useMemo(() =>
    users.filter(u =>
      !userSearch.trim() ||
      u.owneridname?.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.cgmp_userprincipalname?.toLowerCase().includes(userSearch.toLowerCase())
    ),
    [users, userSearch]
  );

  const filtered = useMemo(() => {
    let list = filteredUsers;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(u =>
        u.cgmp_userprincipalname?.toLowerCase().includes(q) ||
        u.owneridname?.toLowerCase().includes(q)
      );
    }
    if (roleFilter) list = list.filter(u => (u.cgmp_role as unknown as number) === parseInt(roleFilter));
    return list;
  }, [filteredUsers, search, roleFilter]);

  const startEdit = (u: Cgmp_userprofiles) => {
    setEditingId(u.cgmp_userprofileid);
    setEditRole(String(u.cgmp_role as unknown as number));
    setEditLocations((u as any).cgmp_assignedlocations ?? '');
  };

  const cancelEdit = () => { setEditingId(null); setEditRole(''); setEditLocations(''); };

  const exportRoleMatrix = () => exportCSV(
    `user-role-matrix-${new Date().toISOString().slice(0, 10)}.csv`,
    ['Display Name', 'UPN', 'Role', 'Assigned Locations', 'Assigned Projects', 'Last Active'],
    users.map(u => [
      u.owneridname ?? '',
      u.cgmp_userprincipalname ?? '',
      ROLE_LABEL[u.cgmp_role as unknown as number] ?? '',
      u.cgmp_assignedlocations ?? '',
      u.cgmp_assignedprojectids ? String(u.cgmp_assignedprojectids.split(',').filter(Boolean).length) : '0',
      (u as any).modifiedon ? fmtDateTime((u as any).modifiedon) : '',
    ])
  );

  const toggleSelect = (id: string) => setSelectedIds(prev => {
    const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s;
  });

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(u => u.cgmp_userprofileid)));
  };

  const doBulkAssign = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const newRole = parseInt(bulkRole);
    const roleName = ROLE_LABEL[newRole] ?? bulkRole;
    setBulkSaving(true);
    let failed = 0;
    for (const id of selectedIds) {
      const u = users.find(u => u.cgmp_userprofileid === id);
      try {
        const r = await Cgmp_userprofilesService.update(id, { cgmp_role: newRole as unknown as Cgmp_userprofilescgmp_role });
        if (!r.success) throw r.error ?? new Error('Failed');
        Cgmp_auditlogsService.create({
          cgmp_auditlogname: `Role changed: ${u?.cgmp_userprincipalname ?? id}`,
          cgmp_entitytype: 100000001 as unknown as Cgmp_auditlogscgmp_entitytype,
          cgmp_eventtype: 100000003 as unknown as Cgmp_auditlogscgmp_eventtype,
          cgmp_entityid: id,
          cgmp_entityname: u?.cgmp_userprincipalname ?? id,
          cgmp_username: currentUserName,
          cgmp_useremail: currentUserUpn,
          cgmp_ipaddress: '',
          cgmp_newvalues: JSON.stringify({ role: roleName, changedBy: currentUserName, bulk: true, browser: getBrowserInfo() }),
        } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch(err => { if (import.meta.env.DEV) console.error('Audit log failed:', err); });
      } catch { failed++; }
    }
    setBulkSaving(false);
    if (failed === 0) showToast('success', `Updated ${selectedIds.size} user${selectedIds.size !== 1 ? 's' : ''}`);
    else showToast('error', `${failed} user(s) failed to update`);
    setSelectedIds(new Set());
    loadUsers();
  }, [selectedIds, bulkRole, users, currentUserName, showToast, loadUsers]);


  const doToggleActive = async (u: Cgmp_userprofiles) => {
    const currentlyActive = (u as any).cgmp_isactive !== false;
    const next = !currentlyActive;
    const label = next ? 'activate' : 'deactivate';
    try {
      const r = await Cgmp_userprofilesService.update(u.cgmp_userprofileid, { cgmp_isactive: next } as any);
      if (!r.success) throw r.error ?? new Error('Failed');
      Cgmp_auditlogsService.create({
        cgmp_auditlogname: `User ${next ? 'Activated' : 'Deactivated'}: ${u.cgmp_userprincipalname}`,
        cgmp_entitytype: 100000001 as unknown as Cgmp_auditlogscgmp_entitytype,
        cgmp_eventtype: 100000003 as unknown as Cgmp_auditlogscgmp_eventtype,
        cgmp_entityid: u.cgmp_userprofileid,
        cgmp_entityname: u.owneridname ?? u.cgmp_userprincipalname,
        cgmp_username: currentUserName,
        cgmp_useremail: currentUserUpn,
        cgmp_ipaddress: getBrowserInfo(),
        cgmp_newvalues: JSON.stringify({ active: next, changedBy: currentUserName }),
      } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch(err => { if (import.meta.env.DEV) console.error('Audit log failed:', err); });
      showToast('success', `User ${label}d`);
      loadUsers();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : `Failed to ${label} user`);
    }
  };

  const saveRole = async (userId: string, skipPrivilegeCheck = false) => {
    const targetUser = users.find(u => u.cgmp_userprofileid === userId);
    const prevRole = targetUser ? (targetUser.cgmp_role as unknown as number) : undefined;
    const newRole = parseInt(editRole);

    /* Self-elevation prevention */
    const isSelf = targetUser?.cgmp_userprincipalname?.toLowerCase() === currentUserUpn.toLowerCase();
    const isElevatingToAdmin = (newRole === 100000000 || newRole === EXTENDED_ROLES.DeptAdmin);
    const wasNotAdmin = prevRole !== 100000000;
    if (isSelf && isElevatingToAdmin && wasNotAdmin) {
      showToast('error', 'You cannot elevate your own role to Administrator.');
      return;
    }

    /* Confirmation dialog for downgrading Admin/PMO — show owned change count */
    const isHighPrivilege = prevRole === 100000000 || prevRole === 100000001;
    if (!skipPrivilegeCheck && isHighPrivilege && newRole !== prevRole) {
      const ownedChanges = changes.filter(c =>
        c.owneridname === targetUser?.owneridname
      ).length;
      const msg = ownedChanges > 0
        ? `This user owns ${ownedChanges} change${ownedChanges !== 1 ? 's' : ''}. Downgrade their role to "${ROLE_LABEL[newRole] ?? String(newRole)}"?`
        : `Change role to "${ROLE_LABEL[newRole] ?? String(newRole)}"?`;
      setSaveRoleConfirm({ userId, msg });
      return;
    }
    setSaving(true);
    try {
      const updatePayload: Record<string, unknown> = {
        cgmp_role: newRole as unknown as Cgmp_userprofilescgmp_role,
      };
      if (newRole === 100000002) {
        updatePayload.cgmp_assignedlocations = editLocations;
      }
      const r = await Cgmp_userprofilesService.update(userId, updatePayload as any);
      if (!r.success) throw r.error ?? new Error('Failed to update role');
      /* Audit log for role change */
      Cgmp_auditlogsService.create({
        cgmp_auditlogname: `Role changed: ${targetUser?.cgmp_userprincipalname ?? userId}`,
        cgmp_entitytype: 100000001 as unknown as Cgmp_auditlogscgmp_entitytype,
        cgmp_eventtype: 100000003 as unknown as Cgmp_auditlogscgmp_eventtype,
        cgmp_entityid: userId,
        cgmp_entityname: targetUser?.cgmp_userprincipalname ?? userId,
        cgmp_username: currentUserName,
        cgmp_useremail: currentUserUpn,
        cgmp_ipaddress: '',
        cgmp_previousvalues: JSON.stringify({ role: ROLE_LABEL[prevRole ?? 0] ?? String(prevRole) }),
        cgmp_newvalues: JSON.stringify({ role: ROLE_LABEL[newRole] ?? String(newRole), changedBy: currentUserName, browser: getBrowserInfo() }),
      } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch(err => { if (import.meta.env.DEV) console.error('Audit log failed:', err); });
      showToast('success', 'Role updated');
      setEditingId(null);
      loadUsers();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to update role');
    } finally { setSaving(false); }
  };

  if (userLoading) return <div className="module-empty">Loading...</div>;

  if (!isAdmin) {
    return (
      <div className="module-workspace">
        <div className="module-header">
          <div>
            <h1 className="module-title">Security & Roles</h1>
            <p className="module-subtitle">Role-based access control and permissions</p>
          </div>
        </div>
        <div className="access-denied">
          <div className="access-denied__icon">🔒</div>
          <div className="access-denied__title">Admin Access Required</div>
          <p className="access-denied__msg">This section is restricted to platform administrators. Contact your admin to request access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="module-workspace">
      <div className="module-header">
        <div>
          <h1 className="module-title">Security & Roles</h1>
          <p className="module-subtitle">Role-based access control and user management</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--outline btn--sm" onClick={() => exportRoleMatrix()} disabled={users.length === 0}>Export Matrix</button>
          <button className="btn btn--outline btn--sm" onClick={loadUsers}>Refresh</button>
        </div>
      </div>

      <div className="ism-tabs" role="tablist" aria-label="Security management views" style={{ padding: '0 24px' }}>
        <button
          role="tab"
          id="secroles-tab-roles"
          aria-selected={secTab === 'roles'}
          aria-controls="secroles-panel-roles"
          tabIndex={secTab === 'roles' ? 0 : -1}
          className={`ism-tab ${secTab === 'roles' ? 'ism-tab--active' : ''}`}
          onClick={() => handleSecTabChange('roles')}
          onKeyDown={e => {
            if (e.key === 'ArrowRight') { e.preventDefault(); handleSecTabChange('activity'); document.getElementById('secroles-tab-activity')?.focus(); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); handleSecTabChange('itopspocs'); document.getElementById('secroles-tab-itopspocs')?.focus(); }
          }}
        >
          User Roles ({users.length})
        </button>
        <button
          role="tab"
          id="secroles-tab-activity"
          aria-selected={secTab === 'activity'}
          aria-controls="secroles-panel-activity"
          tabIndex={secTab === 'activity' ? 0 : -1}
          className={`ism-tab ${secTab === 'activity' ? 'ism-tab--active' : ''}`}
          onClick={() => handleSecTabChange('activity')}
          onKeyDown={e => {
            if (e.key === 'ArrowRight') { e.preventDefault(); handleSecTabChange('itopspocs'); document.getElementById('secroles-tab-itopspocs')?.focus(); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); handleSecTabChange('roles'); document.getElementById('secroles-tab-roles')?.focus(); }
          }}
        >
          Session Activity
        </button>
        <button
          role="tab"
          id="secroles-tab-itopspocs"
          aria-selected={secTab === 'itopspocs'}
          aria-controls="secroles-panel-itopspocs"
          tabIndex={secTab === 'itopspocs' ? 0 : -1}
          className={`ism-tab${secTab === 'itopspocs' ? ' ism-tab--active' : ''}`}
          onClick={() => handleSecTabChange('itopspocs')}
          onKeyDown={e => {
            if (e.key === 'ArrowRight') { e.preventDefault(); handleSecTabChange('roles'); document.getElementById('secroles-tab-roles')?.focus(); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); handleSecTabChange('activity'); document.getElementById('secroles-tab-activity')?.focus(); }
          }}
        >
          IT Ops POC Assignment
        </button>
      </div>

      {secTab === 'roles' && (
      <div id="secroles-panel-roles" role="tabpanel" aria-labelledby="secroles-tab-roles">
      <div className="filter-bar">
        <input className="filter-bar__search" placeholder="Search by name…" value={userSearch} onChange={e => setUserSearch(e.target.value)} />
        <input className="filter-bar__search" placeholder="Search by UPN…" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-bar__select" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="">All Roles</option>
          {ROLE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="filter-bar__count">{filtered.length} users</span>
        <button
          className="btn btn--primary btn--sm"
          style={{ marginLeft: 'auto' }}
          onClick={() => { setAddOpen(true); setAddMode('individual'); setAddSelUser(null); setAddSearch(''); setAddGroupUpns(''); setResolvedMembers([]); }}
        >
          + Add User / Group
        </button>
      </div>

      {/* Bulk assign bar */}
      {selectedIds.size > 0 && (
        <div className="sr-bulk-bar">
          <span className="sr-bulk-bar__count">{selectedIds.size} user{selectedIds.size !== 1 ? 's' : ''} selected</span>
          <select className="filter-bar__select" value={bulkRole} onChange={e => setBulkRole(e.target.value)} style={{ minWidth: 130 }}>
            {ROLE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="btn btn--sm btn--primary" onClick={() => setBulkAssignConfirm(true)} disabled={bulkSaving || selectedIds.size === 0}>
            {bulkSaving ? 'Saving…' : `Assign Role to ${selectedIds.size}`}
          </button>
          <button className="btn btn--sm btn--outline" onClick={() => setSelectedIds(new Set())}>Clear</button>
        </div>
      )}

      <div className="module-table-wrap">
        {loading ? (
          <div className="module-loading">Loading user profiles…</div>
        ) : filtered.length === 0 ? (
          <div className="module-empty">No user profiles found.</div>
        ) : (
          <table className="ism-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === filtered.length && filtered.length > 0}
                    onChange={toggleSelectAll}
                    title="Select all"
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                <th>User Principal Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Notification Preference</th>
                <th>Assigned Projects</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => {
                const rc = u.cgmp_role as unknown as number;
                const isEditing = editingId === u.cgmp_userprofileid;
                const projCount = u.cgmp_assignedprojectids ? u.cgmp_assignedprojectids.split(',').filter(s => s.trim()).length : 0;
                return (
                  <tr key={u.cgmp_userprofileid}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(u.cgmp_userprofileid)}
                        onChange={() => toggleSelect(u.cgmp_userprofileid)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{u.cgmp_userprincipalname}</td>
                    <td>
                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <select
                            className="ff-input ff-select"
                            value={editRole}
                            onChange={(e) => setEditRole(e.target.value)}
                            style={{ padding: '3px 6px', fontSize: 12 }}
                          >
                            <optgroup label="Standard Roles">
                              {ROLE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </optgroup>
                            <optgroup label="Advanced Roles">
                              {Object.entries(EXTENDED_ROLE_LABEL).map(([v, l]) => (
                                <option key={v} value={v}>{l} (Advanced)</option>
                              ))}
                            </optgroup>
                          </select>
                          {parseInt(editRole) === 100000002 && (
                            <input
                              className="ff-input"
                              style={{ fontSize: 12, padding: '3px 6px' }}
                              placeholder="Assigned locations (semicolon-separated)"
                              value={editLocations}
                              onChange={e => setEditLocations(e.target.value)}
                            />
                          )}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                          <span className={`badge badge--status ${ROLE_CLASS[rc] ?? 'status-draft'}`}>
                            {ROLE_LABEL[rc] ?? EXTENDED_ROLE_LABEL[rc] ?? 'Unknown'}
                          </span>
                          {rc >= 100000005 && (
                            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>Advanced</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      {(() => {
                        const isActive = (u as any).cgmp_isactive !== false;
                        return (
                          <span className={`badge badge--status ${isActive ? 'status-released' : 'status-cancelled'}`}>
                            {isActive ? 'Active' : 'Inactive'}
                          </span>
                        );
                      })()}
                    </td>
                    <td style={{ fontSize: 12 }}>{u.cgmp_notificationpreferencename ?? '—'}</td>
                    <td style={{ fontSize: 12 }}>{projCount > 0 ? `${projCount} project${projCount !== 1 ? 's' : ''}` : '—'}</td>
                    <td>
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn--xs btn--primary" onClick={() => saveRole(u.cgmp_userprofileid)} disabled={saving}>Save</button>
                          <button className="btn btn--xs btn--outline" onClick={cancelEdit} disabled={saving}>Cancel</button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn--xs btn--outline" onClick={() => startEdit(u)}>Edit Role</button>
                          <button
                            className={`btn btn--xs ${(u as any).cgmp_isactive !== false ? 'btn--danger-outline' : 'btn--secondary'}`}
                            onClick={() => setToggleTarget(u)}
                          >
                            {(u as any).cgmp_isactive !== false ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      </div>
      )}

      {secTab === 'activity' && (
        <div className="module-table-wrap" id="secroles-panel-activity" role="tabpanel" aria-labelledby="secroles-tab-activity">
          {loading ? <div className="module-loading">Loading…</div> : (
            <table className="ism-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>UPN</th>
                  <th>Role</th>
                  <th>Last Active</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {[...users].sort((a, b) => {
                  const ta = (a as any).modifiedon ? new Date((a as any).modifiedon).getTime() : 0;
                  const tb = (b as any).modifiedon ? new Date((b as any).modifiedon).getTime() : 0;
                  return tb - ta;
                }).map(u => {
                  const rc = u.cgmp_role as unknown as number;
                  const { label, status } = lastActiveLabel((u as any).modifiedon);
                  const dotColor = status === 'online' ? 'var(--success)' : status === 'recent' ? 'var(--warning)' : 'var(--text-tertiary)';
                  return (
                    <tr key={u.cgmp_userprofileid}>
                      <td style={{ fontWeight: 500 }}>{deriveName(u.cgmp_userprincipalname, u.owneridname, sysUserMap)}</td>
                      <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{u.cgmp_userprincipalname ?? '—'}</td>
                      <td><span className={`badge badge--status ${ROLE_CLASS[rc] ?? 'status-draft'}`}>{ROLE_LABEL[rc] ?? 'Unknown'}</span></td>
                      <td style={{ fontSize: 12 }}>{label}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, display: 'inline-block' }} />
                          {status === 'online' ? 'Online' : status === 'recent' ? 'Recent' : 'Idle'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {secTab === 'itopspocs' && (
        <div className="module-table-wrap" id="secroles-panel-itopspocs" role="tabpanel" aria-labelledby="secroles-tab-itopspocs">
          {loading ? (
            <div className="skeleton" style={{ height: 200, borderRadius: 8 }} />
          ) : itOpsPocProfiles.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
              No IT Ops POC users found. Assign users the "IT Ops POC" role first.
            </div>
          ) : (
            <table className="ism-table">
              <thead>
                <tr>
                  <th>IT Ops POC User</th>
                  <th>UPN</th>
                  <th>Assigned Locations</th>
                  <th style={{ width: 120 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {itOpsPocProfiles.map(p => {
                  const assignedLocs = ((p as any).cgmp_assignedlocations ?? '').split(',').map((l: string) => l.trim()).filter(Boolean);
                  const isEditing = editingPocId === p.cgmp_userprofileid;
                  return (
                    <tr key={p.cgmp_userprofileid}>
                      <td>{deriveName(p.cgmp_userprincipalname, p.owneridname, sysUserMap)}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{p.cgmp_userprincipalname || '—'}</td>
                      <td>
                        {isEditing ? (
                          <div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                              {allLocations.map(loc => (
                                <label key={loc} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12 }}>
                                  <input
                                    type="checkbox"
                                    checked={pocLocationDraft.includes(loc)}
                                    onChange={e => setPocLocationDraft(prev =>
                                      e.target.checked ? [...prev, loc] : prev.filter(l => l !== loc)
                                    )}
                                  />
                                  {loc}
                                </label>
                              ))}
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                className="btn btn--primary btn--sm"
                                onClick={() => savePocLocations(p.cgmp_userprofileid)}
                                disabled={pocSaving}
                              >
                                {pocSaving ? 'Saving…' : 'Save'}
                              </button>
                              <button className="btn btn--outline btn--sm" onClick={() => setEditingPocId(null)}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {assignedLocs.length > 0
                              ? assignedLocs.map((loc: string) => (
                                  <span key={loc} className="badge badge--status">{loc}</span>
                                ))
                              : <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>No locations assigned</span>
                            }
                          </div>
                        )}
                      </td>
                      <td>
                        {!isEditing && (
                          <button
                            className="btn btn--sm btn--outline"
                            onClick={() => {
                              setEditingPocId(p.cgmp_userprofileid);
                              setPocLocationDraft(assignedLocs);
                            }}
                          >
                            Edit Locations
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add to Platform"
        maxWidth={540}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 8 }}>
            <button className="btn btn--outline btn--sm" onClick={() => setAddOpen(false)}>Cancel</button>
            <button
              className="btn btn--primary btn--sm"
              onClick={doAddUsers}
              disabled={addSaving || (addMode === 'individual' ? !addSelUser : resolvedMembers.filter(m => m.user).length === 0)}
            >
              {addSaving ? 'Adding…' : addMode === 'individual'
                ? (addSelUser ? `Add ${addSelUser.fullname ?? 'User'} as ${ROLE_LABEL[parseInt(addRole)]}` : 'Add User')
                : `Add ${resolvedMembers.filter(m => m.user).length} Member${resolvedMembers.filter(m => m.user).length !== 1 ? 's' : ''}`
              }
            </button>
          </div>
        }
      >
        {/* Mode toggle */}
        <div className="ism-tabs" style={{ marginBottom: 20 }}>
          <button
            className={`ism-tab${addMode === 'individual' ? ' ism-tab--active' : ''}`}
            onClick={() => { setAddMode('individual'); setAddSearch(''); setAddSelUser(null); }}
          >Individual User</button>
          <button
            className={`ism-tab${addMode === 'group' ? ' ism-tab--active' : ''}`}
            onClick={() => { setAddMode('group'); setResolvedMembers([]); }}
          >Security / Distribution Group</button>
        </div>

        {/* Role selector — shared */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
            {addMode === 'group' ? 'Role for all members' : 'Role'}
          </label>
          <select
            className="ff-input ff-select"
            value={addRole}
            onChange={e => setAddRole(e.target.value)}
          >
            {ROLE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {/* Individual mode */}
        {addMode === 'individual' && (
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
              Search O365 user
            </label>
            {addSelUser ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: '1px solid var(--primary)', borderRadius: 'var(--radius)', background: 'var(--bg-secondary)' }}>
                <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                  {(addSelUser.fullname ?? '?').charAt(0).toUpperCase()}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{addSelUser.fullname}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {addSelUser.internalemailaddress || addSelUser.domainname}
                  </div>
                </div>
                <button
                  className="btn btn--xs btn--outline"
                  onClick={() => { setAddSelUser(null); setAddSearch(''); setTimeout(() => addSearchRef.current?.focus(), 50); }}
                >Change</button>
              </div>
            ) : (
              <div>
                <input
                  ref={addSearchRef}
                  className="ff-input"
                  placeholder="Type name or email to search O365…"
                  value={addSearch}
                  onChange={e => setAddSearch(e.target.value)}
                  autoFocus
                />
                {sysLoading && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6 }}>Loading O365 directory…</div>}
                {addSearch.trim() && !sysLoading && (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginTop: 4, maxHeight: 200, overflowY: 'auto', background: 'var(--bg-surface)' }}>
                    {addSearchResults.length === 0 ? (
                      <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text-tertiary)' }}>No users match "{addSearch}"</div>
                    ) : (
                      addSearchResults.map(u => {
                        const alreadyHasProfile = users.some(p => p.cgmp_userprincipalname?.toLowerCase() === (u.internalemailaddress || u.domainname || '').toLowerCase());
                        return (
                          <button
                            key={u.systemuserid ?? u.domainname}
                            type="button"
                            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: alreadyHasProfile ? 'not-allowed' : 'pointer', textAlign: 'left', opacity: alreadyHasProfile ? 0.5 : 1 }}
                            onClick={() => { if (!alreadyHasProfile) { setAddSelUser(u); setAddSearch(''); } }}
                            title={alreadyHasProfile ? 'User already has a platform profile' : ''}
                          >
                            <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                              {(u.fullname ?? '?').charAt(0).toUpperCase()}
                            </span>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ display: 'block', fontWeight: 500, fontSize: 13 }}>{u.fullname}</span>
                              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.internalemailaddress || u.domainname}</span>
                            </span>
                            {alreadyHasProfile && <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>Already added</span>}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Group mode */}
        {addMode === 'group' && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                Group Name <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>(optional label)</span>
              </label>
              <input
                className="ff-input"
                placeholder="e.g. APAC IT Ops Team"
                value={addGroupName}
                onChange={e => setAddGroupName(e.target.value)}
              />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                Member UPNs / Emails <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>(one per line, or comma-separated)</span>
              </label>
              <textarea
                className="ff-input ff-textarea"
                rows={4}
                placeholder={'john.smith@accenture.com\njane.doe@accenture.com\n...'}
                value={addGroupUpns}
                onChange={e => { setAddGroupUpns(e.target.value); setResolvedMembers([]); }}
                style={{ fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: 12 }}
              />
              <button
                className="btn btn--outline btn--sm"
                style={{ marginTop: 6 }}
                onClick={resolveGroupMembers}
                disabled={!addGroupUpns.trim() || sysLoading}
              >
                {sysLoading ? 'Loading directory…' : 'Resolve Members'}
              </button>
            </div>
            {resolvedMembers.length > 0 && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', maxHeight: 200, overflowY: 'auto', padding: '6px 0' }}>
                <div style={{ padding: '4px 12px 6px', fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
                  {resolvedMembers.filter(m => m.user).length} of {resolvedMembers.length} resolved
                </div>
                {resolvedMembers.map((m, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px' }}>
                    {m.user ? (
                      <>
                        <span style={{ color: 'var(--success)', fontSize: 14, flexShrink: 0 }}>✓</span>
                        <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                          {(m.user.fullname ?? '?').charAt(0).toUpperCase()}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>{m.user.fullname}</span>
                          <span style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)' }}>{m.user.internalemailaddress || m.user.domainname}</span>
                        </span>
                        {users.some(p => p.cgmp_userprincipalname?.toLowerCase() === (m.user!.internalemailaddress || m.user!.domainname || '').toLowerCase()) && (
                          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>Already added</span>
                        )}
                      </>
                    ) : (
                      <>
                        <span style={{ color: 'var(--danger)', fontSize: 14, flexShrink: 0 }}>✗</span>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{m.upn}</span>
                        <span style={{ fontSize: 11, color: 'var(--danger)', marginLeft: 'auto' }}>Not found in O365</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Dialog>

      {/* ConfirmDialogs */}
      <ConfirmDialog
        open={!!toggleTarget}
        onClose={() => setToggleTarget(null)}
        onConfirm={() => { const t = toggleTarget; setToggleTarget(null); if (t) doToggleActive(t); }}
        title={toggleTarget && (toggleTarget as any).cgmp_isactive !== false ? 'Deactivate User' : 'Activate User'}
        message={toggleTarget ? `${(toggleTarget as any).cgmp_isactive !== false ? 'Deactivate' : 'Activate'} ${toggleTarget.owneridname ?? toggleTarget.cgmp_userprincipalname}?` : ''}
        confirmLabel={toggleTarget && (toggleTarget as any).cgmp_isactive !== false ? 'Deactivate' : 'Activate'}
        variant={toggleTarget && (toggleTarget as any).cgmp_isactive !== false ? 'destructive' : 'default'}
      />
      <ConfirmDialog
        open={bulkAssignConfirm}
        onClose={() => setBulkAssignConfirm(false)}
        onConfirm={() => { setBulkAssignConfirm(false); doBulkAssign(); }}
        title="Bulk Role Assignment"
        message={`Assign role "${ROLE_LABEL[parseInt(bulkRole)] ?? bulkRole}" to ${selectedIds.size} selected user${selectedIds.size !== 1 ? 's' : ''}?`}
        confirmLabel="Assign Roles"
        loading={bulkSaving}
      />
      <ConfirmDialog
        open={!!saveRoleConfirm}
        onClose={() => setSaveRoleConfirm(null)}
        onConfirm={() => { const r = saveRoleConfirm; setSaveRoleConfirm(null); if (r) saveRole(r.userId, true); }}
        title="Confirm Role Change"
        message={saveRoleConfirm?.msg ?? ''}
        confirmLabel="Change Role"
        loading={saving}
      />
    </div>
  );
}
