import { useState, useCallback } from 'react';
import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';
import type { Cgmp_projects } from '../../generated/models/Cgmp_projectsModel';
import type { Systemusers } from '../../generated/models/SystemusersModel';
import { Cgmp_projectsService } from '../../generated';
import type { Cgmp_projectscgmp_status } from '../../generated/models/Cgmp_projectsModel';
import { isIsmFrozen } from '../../hooks/useDataverse';
import { PROJ_STATUS_LABEL, PROJ_STATUS_CLASS, PROJ_STATUS_OPTIONS, ProjectFormPanel, ProjectViewPanel } from './ISMPanels';
import UATManagement from './UATManagement';

/* ─── Helpers ──────────────────────────────────────────────────── */

function parseUATCount(uatJson: string | undefined): number {
  if (!uatJson?.trim()) return 0;
  try {
    const p = JSON.parse(uatJson);
    if (Array.isArray(p)) return p.length;
    if (p && typeof p === 'object') return Object.keys(p).length;
  } catch { /* fall through */ }
  return 0;
}

/* ─── Props ─────────────────────────────────────────────────────── */

export interface ISMProjectsTabProps {
  activeTab: 'all' | 'favorites';
  ismProjects: Cgmp_projects[];
  allProjects: Cgmp_projects[];
  changes: Cgmp_changes[];
  projectHealthScores: Map<string, number>;
  favorites: Set<string>;
  onToggleFavorite: (p: Cgmp_projects) => Promise<void>;
  /**
   * Display name of the current ISM user, used for project form defaults and display.
   * cgmp_primaryism is a legacy display-name field; prefer cgmp_primaryismid (GUID) for filtering.
   * The name field is kept for display purposes only.
   */
  ismUserName: string;
  systemUsers: Systemusers[];
  usersLoading: boolean;
  showToast: (type: 'success' | 'error' | 'info' | 'warning', msg: string) => void;
  onRefresh: () => void;
  /** Called when the ISM wants to add a new project (opens form) */
  addingProject: boolean;
  onCloseAdd: () => void;
}

/* ─── Main Tab Component ─────────────────────────────────────────── */

export default function ISMProjectsTab({
  activeTab,
  ismProjects,
  allProjects,
  changes,
  projectHealthScores,
  favorites,
  onToggleFavorite,
  ismUserName,
  systemUsers,
  usersLoading,
  showToast,
  onRefresh,
  addingProject,
  onCloseAdd,
}: ISMProjectsTabProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [viewProject, setViewProject] = useState<Cgmp_projects | null>(null);
  const [editProject, setEditProject] = useState<Cgmp_projects | null>(null);
  const [uatProject, setUATProject] = useState<Cgmp_projects | null>(null);

  const baseList = activeTab === 'favorites'
    ? allProjects.filter(p => favorites.has(p.cgmp_projectid))
    : ismProjects;

  const filteredProjects = (() => {
    let list = baseList;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.cgmp_name?.toLowerCase().includes(q) ||
        p.cgmp_customer?.toLowerCase().includes(q) ||
        p.cgmp_pidbnumber?.toLowerCase().includes(q)
      );
    }
    if (statusFilter) list = list.filter(p => String(p.cgmp_status as unknown as number) === statusFilter);
    return list;
  })();

  const doBulkStatusUpdate = useCallback(async () => {
    if (!bulkStatus || selectedProjectIds.size === 0) return;
    setBulkSaving(true);
    const ids = Array.from(selectedProjectIds);
    const results = await Promise.allSettled(
      ids.map(id => Cgmp_projectsService.update(id, { cgmp_status: Number(bulkStatus) as unknown as Cgmp_projectscgmp_status }))
    );
    const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;
    if (failed > 0) showToast('warning', `${ids.length - failed} updated, ${failed} failed`);
    else showToast('success', `${ids.length} project${ids.length !== 1 ? 's' : ''} status updated`);
    setSelectedProjectIds(new Set());
    setBulkStatus('');
    setBulkSaving(false);
    onRefresh();
  }, [bulkStatus, selectedProjectIds, showToast, onRefresh]);

  if (filteredProjects.length === 0) {
    return (
      <>
        <div className="filter-bar">
          <input className="filter-bar__search" placeholder="Search by name, client, or PIDB…"
            value={search} onChange={e => setSearch(e.target.value)} />
          <select className="filter-bar__select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            {PROJ_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {(search || statusFilter) && (
            <button className="btn btn--outline btn--sm" onClick={() => { setSearch(''); setStatusFilter(''); }}>Clear</button>
          )}
        </div>
        <div className="ism-empty">
          {activeTab === 'favorites'
            ? 'No favorited projects yet. Star a project from the All Projects tab.'
            : ismProjects.length === 0
              ? 'No projects assigned to you as Primary ISM. Use "Add Project" to create one.'
              : 'No projects match the current filters.'}
        </div>
        <ProjectFormPanel
          open={addingProject}
          onClose={onCloseAdd}
          project={null}
          defaultISM={ismUserName}
          onSaved={onRefresh}
          systemUsers={systemUsers}
          usersLoading={usersLoading}
          showToast={showToast}
        />
      </>
    );
  }

  return (
    <>
      {/* Filter bar */}
      <div className="filter-bar">
        <input className="filter-bar__search" placeholder="Search by name, client, or PIDB…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-bar__select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          {PROJ_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {(search || statusFilter) && (
          <button className="btn btn--outline btn--sm" onClick={() => { setSearch(''); setStatusFilter(''); }}>Clear</button>
        )}
        <span className="filter-count">{filteredProjects.length} of {activeTab === 'all' ? ismProjects.length : favorites.size}</span>
      </div>

      <div className="ism-table-wrap">
        {/* Bulk action bar */}
        {activeTab === 'all' && selectedProjectIds.size > 0 && (
          <div className="ism-bulk-bar">
            <span className="ism-bulk-bar__count">{selectedProjectIds.size} selected</span>
            <select className="filter-bar__select" value={bulkStatus} onChange={e => setBulkStatus(e.target.value)} style={{ minWidth: 140 }}>
              <option value="">Set Status…</option>
              {PROJ_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button className="btn btn--primary btn--sm" disabled={!bulkStatus || bulkSaving} onClick={doBulkStatusUpdate}>
              {bulkSaving ? 'Updating…' : 'Apply'}
            </button>
            <button className="btn btn--outline btn--sm" onClick={() => setSelectedProjectIds(new Set())}>Clear</button>
          </div>
        )}

        <table className="ism-table ism-proj-table">
          <thead>
            <tr>
              {activeTab === 'all' && (
                <th style={{ width: 32 }}>
                  <input type="checkbox"
                    checked={filteredProjects.length > 0 && filteredProjects.every(p => selectedProjectIds.has(p.cgmp_projectid))}
                    onChange={e => {
                      if (e.target.checked) setSelectedProjectIds(new Set(filteredProjects.map(p => p.cgmp_projectid)));
                      else setSelectedProjectIds(new Set());
                    }}
                  />
                </th>
              )}
              <th>PIDB No.</th>
              <th>Project Name</th>
              <th>Client</th>
              <th>Region</th>
              <th>Tower</th>
              <th>Status</th>
              <th>Health</th>
              <th>UAT Users</th>
              <th>★</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredProjects.map(p => {
              const sc = p.cgmp_status as unknown as number;
              const uatCount = parseUATCount(p.cgmp_uatusers);
              const isFav = favorites.has(p.cgmp_projectid);
              return (
                <tr key={p.cgmp_projectid}>
                  {activeTab === 'all' && (
                    <td style={{ width: 32 }}>
                      <input type="checkbox"
                        checked={selectedProjectIds.has(p.cgmp_projectid)}
                        onChange={e => {
                          setSelectedProjectIds(prev => {
                            const n = new Set(prev);
                            e.target.checked ? n.add(p.cgmp_projectid) : n.delete(p.cgmp_projectid);
                            return n;
                          });
                        }}
                        onClick={e => e.stopPropagation()}
                      />
                    </td>
                  )}
                  <td>
                    {p.cgmp_pidbnumber
                      ? <span className="proj-pidb">{p.cgmp_pidbnumber}</span>
                      : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                  </td>
                  <td>
                    <button className="ism-proj-name-btn" onClick={() => setViewProject(p)} title="View project details">
                      {p.cgmp_name}
                    </button>
                  </td>
                  <td>{p.cgmp_customer || '—'}</td>
                  <td>{p.cgmp_region || '—'}</td>
                  <td>{p.cgmp_tower || '—'}</td>
                  <td>
                    <span className={`badge badge--status ${PROJ_STATUS_CLASS[sc] ?? 'status-draft'}`}>
                      {PROJ_STATUS_LABEL[sc] ?? 'Unknown'}
                    </span>
                  </td>
                  <td>
                    {(() => {
                      const hs = projectHealthScores.get(p.cgmp_projectid);
                      if (hs === undefined) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
                      const color = hs >= 80 ? 'var(--success)' : hs >= 60 ? 'var(--orange)' : 'var(--danger)';
                      return (
                        <span style={{ fontWeight: 700, color, fontSize: 13 }} title="Project health: composite of SLA %, failures, and UAT coverage">
                          {hs}
                        </span>
                      );
                    })()}
                  </td>
                  <td style={{ color: uatCount === 0 ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>{uatCount}</td>
                  <td>
                    <button className={`btn-fav ${isFav ? 'btn-fav--active' : ''}`}
                      onClick={() => onToggleFavorite(p)}
                      aria-pressed={isFav}
                      aria-label={isFav ? `Remove ${p.cgmp_name} from favorites` : `Add ${p.cgmp_name} to favorites`}
                      title={isFav ? 'Remove from favorites' : 'Add to favorites'}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                    </button>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="row-action-btn" title="View" onClick={() => setViewProject(p)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
                        </svg>
                      </button>
                      <button className="row-action-btn" title="Edit" onClick={() => setEditProject(p)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                        </svg>
                      </button>
                      <button className="row-action-btn" title="Update UAT"
                        onClick={() => {
                          const anyFrozen = changes.some(c =>
                            (c.cgmp_projectids ?? '').split(',').map((id: string) => id.trim()).includes(p.cgmp_projectid) &&
                            isIsmFrozen(c.cgmp_starttime)
                          );
                          if (anyFrozen) {
                            showToast('warning', 'A linked change is within the UAT freeze window — please update UAT from the Impacted Changes tab.');
                            return;
                          }
                          setUATProject(p);
                        }}
                        style={{ color: uatCount === 0 ? 'var(--danger)' : undefined }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Panels */}
      <ProjectViewPanel open={!!viewProject} project={viewProject} onClose={() => setViewProject(null)} />
      <UATManagement open={!!uatProject} onClose={() => setUATProject(null)} project={uatProject} onSaved={onRefresh} />
      <ProjectFormPanel
        open={!!editProject}
        onClose={() => setEditProject(null)}
        project={editProject}
        defaultISM={ismUserName}
        onSaved={onRefresh}
        systemUsers={systemUsers}
        usersLoading={usersLoading}
        showToast={showToast}
      />
      <ProjectFormPanel
        open={addingProject}
        onClose={onCloseAdd}
        project={null}
        defaultISM={ismUserName}
        onSaved={onRefresh}
        systemUsers={systemUsers}
        usersLoading={usersLoading}
        showToast={showToast}
      />
    </>
  );
}
