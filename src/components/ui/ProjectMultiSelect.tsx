import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { FilterBuilder, applyFilterGroup, emptyGroup } from './FilterBuilder';
import type { FilterGroup, FieldDef } from './FilterBuilder';
import type { Cgmp_projects } from '../../generated/models/Cgmp_projectsModel';

const PROJ_PICKER_FIELDS: FieldDef[] = [
  { key: 'cgmp_name', label: 'Project Name', type: 'text' },
  { key: 'cgmp_pidbnumber', label: 'PIDB No.', type: 'text' },
  { key: 'cgmp_customer', label: 'Client', type: 'text' },
  { key: 'cgmp_region', label: 'Region', type: 'text' },
  { key: 'cgmp_location', label: 'Location', type: 'text' },
  { key: 'cgmp_country', label: 'Country', type: 'text' },
  { key: 'cgmp_tower', label: 'Tower', type: 'text' },
  { key: 'cgmp_facility', label: 'Facility', type: 'text' },
  { key: 'cgmp_primaryism', label: 'Primary ISM', type: 'text' },
  { key: 'cgmp_techpoc', label: 'Tech POC', type: 'text' },
  { key: 'cgmp_status', label: 'Status', type: 'select', options: [
    { value: '100000000', label: 'Active' },
    { value: '100000001', label: 'Decommissioned' },
    { value: '100000002', label: 'Ramp Up' },
    { value: '100000003', label: 'Transition' },
  ]},
  { key: 'cgmp_primaryconnectivity', label: 'Primary Connectivity', type: 'text' },
  { key: 'cgmp_primarypop', label: 'Primary POP', type: 'text' },
  { key: 'cgmp_primarylinkprovider', label: 'Primary Link Provider', type: 'text' },
];

export function ProjectMultiSelect({
  projects,
  value,
  onChange,
  disabled,
}: {
  projects: Cgmp_projects[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filterGroup, setFilterGroup] = useState<FilterGroup>(emptyGroup());
  const dropRef = useRef<HTMLDivElement>(null);

  const selectedIds = useMemo(
    () => value.split(',').map(s => s.trim()).filter(Boolean),
    [value],
  );

  const filtered = useMemo(() => {
    let list = search
      ? projects.filter(p =>
          p.cgmp_name?.toLowerCase().includes(search.toLowerCase()) ||
          p.cgmp_pidbnumber?.toLowerCase().includes(search.toLowerCase()) ||
          p.cgmp_customer?.toLowerCase().includes(search.toLowerCase()) ||
          p.cgmp_primaryism?.toLowerCase().includes(search.toLowerCase())
        )
      : projects;
    return applyFilterGroup(
      list as unknown as Record<string, unknown>[],
      PROJ_PICKER_FIELDS,
      filterGroup,
    ) as unknown as Cgmp_projects[];
  }, [projects, search, filterGroup]);

  const toggle = useCallback((id: string) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter(s => s !== id)
      : [...selectedIds, id];
    onChange(next.join(','));
  }, [selectedIds, onChange]);

  const selectAllFiltered = useCallback(() => {
    const allIds = filtered.map(p => p.cgmp_projectid);
    const merged = [...new Set([...selectedIds, ...allIds])];
    onChange(merged.join(','));
  }, [filtered, selectedIds, onChange]);

  const clearAll = useCallback(() => onChange(''), [onChange]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const triggerLabel = selectedIds.length === 0
    ? 'Select projects…'
    : `${selectedIds.length} project${selectedIds.length !== 1 ? 's' : ''} selected`;

  return (
    <div className="proj-ms" ref={dropRef}>
      <button
        type="button"
        className={`proj-ms__trigger ff-input ${disabled ? 'proj-ms__trigger--disabled' : ''}`}
        onClick={() => !disabled && setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
      >
        <span className="proj-ms__label">{triggerLabel}</span>
        <svg className={`proj-ms__chevron ${open ? 'proj-ms__chevron--open' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>

      {selectedIds.length > 0 && (
        <div className="proj-ms__tags" aria-label="Selected projects">
          {selectedIds.map(id => {
            const proj = projects.find(p => p.cgmp_projectid === id);
            const name = proj?.cgmp_name ?? id;
            return (
              <span key={id} className="proj-ms__tag" title={proj ? `${proj.cgmp_customer ?? ''} · ${proj.cgmp_region ?? ''}` : ''}>
                {name}
                {!disabled && (
                  <button type="button" className="proj-ms__tag-remove" onClick={() => toggle(id)} aria-label={`Remove ${name}`}>
                    ×
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {open && (
        <div className="proj-ms__dropdown" role="listbox" aria-multiselectable="true">
          <div className="proj-ms__search-wrap">
            <input
              type="text"
              className="proj-ms__search"
              placeholder="Quick search by name, PIDB, client, ISM…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          <div className="proj-ms__filter-zone">
            <FilterBuilder
              fields={PROJ_PICKER_FIELDS}
              value={filterGroup}
              onChange={setFilterGroup}
              matchCount={filtered.length}
              totalCount={projects.length}
              presetKey="proj-picker"
              compact
            />
          </div>

          <div className="proj-ms__toolbar">
            <button type="button" className="proj-ms__tb-btn" onClick={selectAllFiltered}>
              Select All{filtered.length < projects.length ? ` (${filtered.length} matching)` : ` (${projects.length})`}
            </button>
            <button type="button" className="proj-ms__tb-btn" onClick={clearAll}>Clear All</button>
            <span className="proj-ms__tb-count">{selectedIds.length} selected · {filtered.length} shown</span>
          </div>

          <div className="proj-ms__list">
            {filtered.length === 0 ? (
              <div className="proj-ms__empty">No projects match the current filters.</div>
            ) : (
              filtered.map(p => {
                const checked = selectedIds.includes(p.cgmp_projectid);
                const sc = p.cgmp_status as unknown as number;
                return (
                  <label key={p.cgmp_projectid} className={`proj-ms__item ${checked ? 'proj-ms__item--checked' : ''}`} role="option" aria-selected={checked}>
                    <input
                      type="checkbox"
                      className="proj-ms__checkbox"
                      checked={checked}
                      onChange={() => toggle(p.cgmp_projectid)}
                    />
                    <span className="proj-ms__item-info">
                      <span className="proj-ms__item-name">{p.cgmp_name}</span>
                      <span className="proj-ms__item-sub">
                        {p.cgmp_pidbnumber && <span className="proj-ms__item-pidb">{p.cgmp_pidbnumber}</span>}
                        {p.cgmp_customer && <span className="proj-ms__item-meta">{p.cgmp_customer}</span>}
                        {p.cgmp_region && <span className="proj-ms__item-meta">{p.cgmp_region}</span>}
                        {sc !== 100000000 && (
                          <span className="proj-ms__item-status" data-status={sc}>
                            {sc === 100000001 ? 'Decommissioned' : sc === 100000002 ? 'Ramp Up' : sc === 100000003 ? 'Transition' : ''}
                          </span>
                        )}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
