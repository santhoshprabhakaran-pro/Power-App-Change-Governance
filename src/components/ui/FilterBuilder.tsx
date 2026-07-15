import { useState, useCallback } from 'react';

/* ── Types ──────────────────────────────────────────────────────── */

export type FieldType = 'text' | 'number' | 'date' | 'select';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
}

export type Operator =
  | 'contains' | 'notContains'
  | 'equals' | 'notEquals'
  | 'startsWith' | 'endsWith'
  | 'greaterThan' | 'lessThan'
  | 'isEmpty' | 'isNotEmpty'
  | 'before' | 'after';

export interface FilterCondition {
  id: string;
  field: string;
  operator: Operator;
  value: string;
}

export interface FilterGroup {
  logic: 'AND' | 'OR';
  conditions: FilterCondition[];
}

/* ── Presets (localStorage) ─────────────────────────────────────── */

interface Preset { name: string; group: FilterGroup; }

function loadPresets(key: string): Preset[] {
  try { return JSON.parse(localStorage.getItem(`cgmp-fb-${key}`) ?? '[]'); } catch { return []; }
}
function savePresets(key: string, presets: Preset[]) {
  try { localStorage.setItem(`cgmp-fb-${key}`, JSON.stringify(presets)); } catch { /* storage full */ }
}

/* ── Operator lists by field type ───────────────────────────────── */

const TEXT_OPS: { value: Operator; label: string }[] = [
  { value: 'contains', label: 'Contains' },
  { value: 'notContains', label: 'Does Not Contain' },
  { value: 'equals', label: 'Equals' },
  { value: 'notEquals', label: 'Not Equals' },
  { value: 'startsWith', label: 'Starts With' },
  { value: 'endsWith', label: 'Ends With' },
  { value: 'isEmpty', label: 'Is Empty' },
  { value: 'isNotEmpty', label: 'Is Not Empty' },
];
const NUM_OPS: { value: Operator; label: string }[] = [
  { value: 'equals', label: 'Equals' },
  { value: 'notEquals', label: 'Not Equals' },
  { value: 'greaterThan', label: 'Greater Than' },
  { value: 'lessThan', label: 'Less Than' },
  { value: 'isEmpty', label: 'Is Empty' },
  { value: 'isNotEmpty', label: 'Is Not Empty' },
];
const DATE_OPS: { value: Operator; label: string }[] = [
  { value: 'equals', label: 'On Date' },
  { value: 'before', label: 'Before' },
  { value: 'after', label: 'After' },
  { value: 'isEmpty', label: 'Is Empty' },
  { value: 'isNotEmpty', label: 'Is Not Empty' },
];
const SELECT_OPS: { value: Operator; label: string }[] = [
  { value: 'equals', label: 'Is' },
  { value: 'notEquals', label: 'Is Not' },
  { value: 'isEmpty', label: 'Is Empty' },
  { value: 'isNotEmpty', label: 'Is Not Empty' },
];

function getOps(type: FieldType) {
  if (type === 'number') return NUM_OPS;
  if (type === 'date') return DATE_OPS;
  if (type === 'select') return SELECT_OPS;
  return TEXT_OPS;
}
function defaultOp(type: FieldType): Operator {
  if (type === 'select') return 'equals';
  if (type === 'date') return 'after';
  if (type === 'number') return 'equals';
  return 'contains';
}

/* ── Exported helpers ───────────────────────────────────────────── */

export function emptyGroup(): FilterGroup {
  return { logic: 'AND', conditions: [] };
}

let _cid = 0;
function nextId() { return String(++_cid); }

/** Apply a FilterGroup to an array of records. */
export function applyFilterGroup<T extends Record<string, unknown>>(
  items: T[],
  fields: FieldDef[],
  group: FilterGroup,
): T[] {
  const active = group.conditions.filter(c =>
    c.field && (c.operator === 'isEmpty' || c.operator === 'isNotEmpty' || c.value !== '')
  );
  if (active.length === 0) return items;

  return items.filter(item => {
    const results = active.map(cond => {
      const fd = fields.find(f => f.key === cond.field);
      const raw = item[cond.field];
      const str = String(raw ?? '').toLowerCase();
      const cv  = cond.value.toLowerCase();

      switch (cond.operator) {
        case 'contains':     return str.includes(cv);
        case 'notContains':  return !str.includes(cv);
        case 'equals':
          return (fd?.type === 'number' || fd?.type === 'select')
            ? String(raw) === cond.value
            : str === cv;
        case 'notEquals':
          return (fd?.type === 'number' || fd?.type === 'select')
            ? String(raw) !== cond.value
            : str !== cv;
        case 'startsWith':   return str.startsWith(cv);
        case 'endsWith':     return str.endsWith(cv);
        case 'isEmpty':      return !raw || str === '';
        case 'isNotEmpty':   return !!raw && str !== '';
        case 'greaterThan':  return Number(raw) > Number(cond.value);
        case 'lessThan':     return Number(raw) < Number(cond.value);
        case 'before': {
          const d = new Date(String(raw)), t = new Date(cond.value);
          return !isNaN(d.getTime()) && !isNaN(t.getTime()) && d < t;
        }
        case 'after': {
          const d = new Date(String(raw)), t = new Date(cond.value);
          return !isNaN(d.getTime()) && !isNaN(t.getTime()) && d > t;
        }
        default: return true;
      }
    });
    return group.logic === 'AND' ? results.every(Boolean) : results.some(Boolean);
  });
}

/* ── Component ──────────────────────────────────────────────────── */

interface FilterBuilderProps {
  fields: FieldDef[];
  value: FilterGroup;
  onChange: (group: FilterGroup) => void;
  matchCount?: number;
  totalCount?: number;
  presetKey?: string;
  className?: string;
  compact?: boolean;
}

export function FilterBuilder({
  fields,
  value,
  onChange,
  matchCount,
  totalCount,
  presetKey,
  className = '',
  compact = false,
}: FilterBuilderProps) {
  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState<Preset[]>(() => presetKey ? loadPresets(presetKey) : []);
  const [saveName, setSaveName] = useState('');
  const [showSave, setShowSave] = useState(false);

  const activeCount = value.conditions.filter(c =>
    c.field && (c.operator === 'isEmpty' || c.operator === 'isNotEmpty' || c.value !== '')
  ).length;

  const upd = useCallback((fn: (g: FilterGroup) => FilterGroup) => onChange(fn(value)), [value, onChange]);

  const addCond = () => {
    const first = fields[0];
    upd(g => ({
      ...g,
      conditions: [...g.conditions, {
        id: nextId(),
        field: first?.key ?? '',
        operator: defaultOp(first?.type ?? 'text'),
        value: '',
      }],
    }));
    setOpen(true);
  };

  const removeCond = (id: string) => upd(g => ({ ...g, conditions: g.conditions.filter(c => c.id !== id) }));

  const patchCond = (id: string, patch: Partial<FilterCondition>) =>
    upd(g => ({
      ...g,
      conditions: g.conditions.map(c => {
        if (c.id !== id) return c;
        const next = { ...c, ...patch };
        if (patch.field && patch.field !== c.field) {
          const fd = fields.find(f => f.key === patch.field);
          next.operator = defaultOp(fd?.type ?? 'text');
          next.value = '';
        }
        return next;
      }),
    }));

  const clear = () => { onChange(emptyGroup()); };

  const savePreset = () => {
    if (!saveName.trim() || !presetKey) return;
    const name = saveName.trim();
    const updated: Preset[] = [...presets.filter(p => p.name !== name), { name, group: value }];
    setPresets(updated);
    savePresets(presetKey, updated);
    setSaveName('');
    setShowSave(false);
  };

  const loadPreset = (name: string) => {
    const p = presets.find(pr => pr.name === name);
    if (p) onChange({ ...p.group, conditions: p.group.conditions.map(c => ({ ...c, id: nextId() })) });
  };

  const deletePreset = (name: string) => {
    if (!presetKey) return;
    const updated = presets.filter(p => p.name !== name);
    setPresets(updated);
    savePresets(presetKey, updated);
  };

  return (
    <div className={`fb-root ${compact ? 'fb-root--compact' : ''} ${className}`}>

      {/* ── Toggle bar ── */}
      <div className="fb-bar">
        <button
          className={`fb-btn ${open ? 'fb-btn--open' : ''} ${activeCount > 0 ? 'fb-btn--active' : ''}`}
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" />
          </svg>
          {activeCount > 0 ? `Filters (${activeCount} active)` : 'Advanced Filters'}
          <svg className={`fb-chevron ${open ? 'fb-chevron--open' : ''}`} width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 10l5 5 5-5z" />
          </svg>
        </button>

        {activeCount > 0 && (
          <button className="fb-clear-chip" onClick={clear} title="Clear all filters">
            Clear filters ×
          </button>
        )}

        {matchCount !== undefined && totalCount !== undefined && (
          matchCount === 0 && activeCount > 0
            ? <span className="fb-count-label" style={{ color: 'var(--danger)', fontWeight: 600 }}>No items match your filters</span>
            : <span className="fb-count-label"><strong>{matchCount}</strong> of {totalCount} {matchCount === 1 ? 'result' : 'results'}</span>
        )}
      </div>

      {/* ── Panel ── */}
      {open && (
        <div className="fb-panel">

          {/* Logic toggle */}
          {value.conditions.length > 1 && (
            <div className="fb-logic-row">
              <span className="fb-logic-label">Match</span>
              {(['AND', 'OR'] as const).map(l => (
                <button
                  key={l}
                  className={`fb-logic-opt ${value.logic === l ? 'fb-logic-opt--active' : ''}`}
                  onClick={() => upd(g => ({ ...g, logic: l }))}
                >
                  {l === 'AND' ? 'All conditions (AND)' : 'Any condition (OR)'}
                </button>
              ))}
            </div>
          )}

          {/* Conditions */}
          {activeCount > 0 && (
            <span
              id="filter-chips-desc"
              style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}
            >
              Active filters. Press Delete or Backspace to remove.
            </span>
          )}
          <div className="fb-conditions" aria-describedby={activeCount > 0 ? 'filter-chips-desc' : undefined}>
            {value.conditions.length === 0 ? (
              <p className="fb-no-conds">No conditions yet — click <strong>+ Add Condition</strong> below.</p>
            ) : value.conditions.map((cond, idx) => {
              const fd = fields.find(f => f.key === cond.field);
              const ops = getOps(fd?.type ?? 'text');
              const needsValue = cond.operator !== 'isEmpty' && cond.operator !== 'isNotEmpty';

              return (
                <div key={cond.id} className="fb-cond-row">
                  <span className="fb-cond-prefix">
                    {idx === 0 ? 'Where' : <span className="fb-logic-pill">{value.logic}</span>}
                  </span>

                  {/* Field */}
                  <select
                    className="fb-sel fb-sel--field"
                    value={cond.field}
                    onChange={e => patchCond(cond.id, { field: e.target.value })}
                  >
                    {fields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>

                  {/* Operator */}
                  <select
                    className="fb-sel fb-sel--op"
                    value={cond.operator}
                    onChange={e => patchCond(cond.id, { operator: e.target.value as Operator })}
                  >
                    {ops.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                  </select>

                  {/* Value */}
                  {needsValue ? (
                    fd?.type === 'select' && fd.options ? (
                      <select
                        className="fb-sel fb-sel--val"
                        value={cond.value}
                        onChange={e => patchCond(cond.id, { value: e.target.value })}
                      >
                        <option value="">— select —</option>
                        {fd.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : fd?.type === 'date' ? (
                      <input type="date" className="fb-inp fb-inp--val" value={cond.value}
                        onChange={e => patchCond(cond.id, { value: e.target.value })} />
                    ) : fd?.type === 'number' ? (
                      <input type="number" className="fb-inp fb-inp--val" value={cond.value}
                        placeholder="number" onChange={e => patchCond(cond.id, { value: e.target.value })} />
                    ) : (
                      <input type="text" className="fb-inp fb-inp--val" value={cond.value}
                        placeholder="value" onChange={e => patchCond(cond.id, { value: e.target.value })} />
                    )
                  ) : <span className="fb-no-val" />}

                  <button className="fb-rm-btn" onClick={() => removeCond(cond.id)} title="Remove">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Footer actions */}
          <div className="fb-footer">
            <div className="fb-footer__left">
              <button className="btn btn--outline btn--sm" onClick={addCond}>+ Add Condition</button>
              {value.conditions.length > 0 && (
                <button className="btn btn--outline btn--sm" onClick={clear} style={{ color: 'var(--danger)' }}>
                  Clear All
                </button>
              )}
            </div>

            {presetKey && (
              <div className="fb-footer__right">
                {presets.length > 0 && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <select className="fb-sel fb-sel--preset" defaultValue=""
                      onChange={e => { if (e.target.value) { loadPreset(e.target.value); e.target.value = ''; } }}>
                      <option value="" disabled>Load preset…</option>
                      {presets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                    </select>
                    <select className="fb-sel fb-sel--preset" defaultValue=""
                      onChange={e => { if (e.target.value) { deletePreset(e.target.value); e.target.value = ''; } }}>
                      <option value="" disabled>Delete preset…</option>
                      {presets.map(p => <option key={p.name} value={p.name}>× {p.name}</option>)}
                    </select>
                  </div>
                )}
                {value.conditions.length > 0 && !showSave && (
                  <button className="btn btn--outline btn--sm" onClick={() => setShowSave(true)}>
                    Save as Preset
                  </button>
                )}
                {showSave && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input className="fb-inp fb-inp--preset-name" value={saveName}
                      onChange={e => setSaveName(e.target.value)} placeholder="Preset name…"
                      onKeyDown={e => e.key === 'Enter' && savePreset()} />
                    <button className="btn btn--primary btn--sm" onClick={savePreset} disabled={!saveName.trim()}>Save</button>
                    <button className="btn btn--outline btn--sm" onClick={() => { setShowSave(false); setSaveName(''); }}>✕</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
