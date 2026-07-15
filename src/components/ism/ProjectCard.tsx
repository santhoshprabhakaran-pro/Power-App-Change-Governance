import type { Cgmp_projects } from '../../generated/models/Cgmp_projectsModel';
import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';
import { STATUS } from '../../hooks/useDataverse';

function parseUATCount(uatJson: string | undefined): number {
  if (!uatJson?.trim()) return 0;
  try {
    const p = JSON.parse(uatJson);
    if (Array.isArray(p)) return p.length;
  } catch { /* fall through */ }
  return uatJson.split(',').filter(s => s.trim()).length;
}

const PROJ_STATUS_LABEL: Record<number, string> = {
  100000000: 'Active', 100000001: 'Decommissioned', 100000002: 'On Hold', 100000003: 'Planned',
};
const PROJ_STATUS_CLASS: Record<number, string> = {
  100000000: 'status-released', 100000001: 'status-cancelled',
  100000002: 'status-uat', 100000003: 'status-closed',
};

interface Props {
  project: Cgmp_projects;
  changes: Cgmp_changes[];
  isFavorite: boolean;
  onToggleFavorite: (project: Cgmp_projects) => void;
  onManageUAT: (project: Cgmp_projects) => void;
  onViewChanges: (project: Cgmp_projects) => void;
}

export default function ProjectCard({ project, changes, isFavorite, onToggleFavorite, onManageUAT, onViewChanges }: Props) {
  const projectChanges = changes.filter(c =>
    c.cgmp_projectids?.split(',').map(s => s.trim()).includes(project.cgmp_projectid)
  );
  const statusCode = project.cgmp_status as unknown as number;
  const pendingCount = projectChanges.filter(c => {
    const s = c.cgmp_status as unknown as number;
    return s === STATUS.Draft || s === STATUS.Published || s === STATUS.UnderReview;
  }).length;
  const uatCount = parseUATCount(project.cgmp_uatusers);

  return (
    <div className={`proj-card ${isFavorite ? 'proj-card--fav' : ''}`}>
      <div className="proj-card__header">
        <div className="proj-card__title-row">
          <span className="proj-card__name" title={project.cgmp_name}>{project.cgmp_name}</span>
          <button
            className={`btn-fav ${isFavorite ? 'btn-fav--active' : ''}`}
            onClick={() => onToggleFavorite(project)}
            title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </button>
        </div>
        <div className="proj-card__meta">
          {project.cgmp_customer && <span className="proj-meta-chip">{project.cgmp_customer}</span>}
          {project.cgmp_tower && <span className="proj-meta-chip">{project.cgmp_tower}</span>}
          {project.cgmp_region && <span className="proj-meta-chip">{project.cgmp_region}</span>}
        </div>
      </div>

      <div className="proj-card__body">
        <div className="proj-info-row">
          <span className="proj-info-label">Primary ISM</span>
          <span className="proj-info-value">{project.cgmp_primaryism || '—'}</span>
        </div>
        <div className="proj-info-row">
          <span className="proj-info-label">Backup ISM</span>
          <span className="proj-info-value">{project.cgmp_backupism || '—'}</span>
        </div>
        <div className="proj-info-row">
          <span className="proj-info-label">Country</span>
          <span className="proj-info-value">{project.cgmp_country || '—'}</span>
        </div>
      </div>

      <div className="proj-card__stats">
        <div className="proj-stat">
          <span className="proj-stat__value">{projectChanges.length}</span>
          <span className="proj-stat__label">Changes</span>
        </div>
        <div className="proj-stat">
          <span className="proj-stat__value" style={{ color: pendingCount > 0 ? 'var(--orange)' : 'var(--text-tertiary)' }}>
            {pendingCount}
          </span>
          <span className="proj-stat__label">Pending</span>
        </div>
        <div className="proj-stat">
          <span className="proj-stat__value" style={{ color: uatCount === 0 ? 'var(--danger)' : 'var(--success)' }}>
            {uatCount}
          </span>
          <span className="proj-stat__label">UAT Users</span>
        </div>
      </div>

      <div className="proj-card__footer">
        <span className={`badge badge--status ${PROJ_STATUS_CLASS[statusCode] ?? 'status-draft'}`}>
          {PROJ_STATUS_LABEL[statusCode] ?? 'Unknown'}
        </span>
        <div className="proj-card__actions">
          <button className="btn btn--xs btn--outline" onClick={() => onManageUAT(project)}>UAT</button>
          <button className="btn btn--xs btn--primary" onClick={() => onViewChanges(project)}>Changes</button>
        </div>
      </div>
    </div>
  );
}
