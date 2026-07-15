import { useState, useCallback, useEffect } from 'react';
import { Cgmp_notificationrulesService } from '../../generated';
import type { Cgmp_notificationrules } from '../../generated/models/Cgmp_notificationrulesModel';
import { useApp } from '../../context/AppContext';
import { Dialog } from '../ui/Modal';

const EVENT_TYPES = [
  { value: '', label: 'Any Event' },
  { value: 'status_released', label: 'Change Released' },
  { value: 'status_published', label: 'Change Published' },
  { value: 'status_closed', label: 'Change Closed' },
  { value: 'status_failed', label: 'Change Failed' },
  { value: 'uat_reminder', label: 'UAT Reminder' },
  { value: 'escalation', label: 'Escalation' },
  { value: 'giicc_handover', label: 'GIICC Handover' },
  { value: 'emergency', label: 'Emergency Change' },
];

interface ConditionDef { field: string; op: string; value: string; }

const CONDITION_FIELDS = [
  { value: 'status', label: 'Status' },
  { value: 'risk', label: 'Risk Level' },
  { value: 'location', label: 'Location' },
  { value: 'category', label: 'Category' },
];

const EMPTY_FORM = { eventtype: '', conditions: [] as ConditionDef[], isactive: true };

function parseConditions(raw: string | undefined): ConditionDef[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export default function NotificationRules() {
  const { showToast, currentUserUpn } = useApp();
  const [rules, setRules] = useState<Cgmp_notificationrules[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const safeUpn = currentUserUpn.replace(/'/g, "''");
      const r = await Cgmp_notificationrulesService.getAll({
        filter: `cgmp_userid eq '${safeUpn}'`,
        orderBy: ['createdon desc'],
        top: 100,
      });
      setRules(r.data ?? []);
      setLoaded(true);
    } catch { setRules([]); } finally { setLoading(false); }
  }, [currentUserUpn]);

  useEffect(() => { if (!loaded) load(); }, [loaded, load]);

  const openCreate = () => { setForm(EMPTY_FORM); setEditId(null); setFormOpen(true); };
  const openEdit = (r: Cgmp_notificationrules) => {
    setForm({
      eventtype: r.cgmp_eventtype ?? '',
      conditions: parseConditions(r.cgmp_conditions),
      isactive: r.cgmp_isactive !== false,
    });
    setEditId(r.cgmp_notificationruleid);
    setFormOpen(true);
  };

  const addCondition = () => setForm(f => ({ ...f, conditions: [...f.conditions, { field: 'status', op: 'eq', value: '' }] }));
  const removeCondition = (i: number) => setForm(f => ({ ...f, conditions: f.conditions.filter((_, idx) => idx !== i) }));
  const updateCondition = (i: number, key: keyof ConditionDef, val: string) =>
    setForm(f => ({ ...f, conditions: f.conditions.map((c, idx) => idx === i ? { ...c, [key]: val } : c) }));

  const handleSave = async () => {
    /* Validate: all conditions must have a non-empty value */
    const emptyValue = form.conditions.find(c => !c.value.trim());
    if (emptyValue) { showToast('error', `Condition "${emptyValue.field}" has an empty value — fill it in or remove the condition.`); return; }
    setSaving(true);
    try {
      const payload = {
        cgmp_userid: currentUserUpn,
        cgmp_eventtype: form.eventtype || undefined,
        cgmp_conditions: form.conditions.length > 0 ? JSON.stringify(form.conditions) : undefined,
        cgmp_isactive: form.isactive,
      } as any;
      if (editId) {
        const r = await Cgmp_notificationrulesService.update(editId, payload);
        if (!r.success) throw r.error ?? new Error('Update failed');
        showToast('success', 'Rule updated');
      } else {
        const r = await Cgmp_notificationrulesService.create(payload);
        if (!r.success) throw r.error ?? new Error('Create failed');
        showToast('success', 'Rule created');
      }
      setFormOpen(false);
      load();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Save failed');
    } finally { setSaving(false); }
  };

  const toggleActive = async (rule: Cgmp_notificationrules) => {
    const nextActive = rule.cgmp_isactive === false; // if currently false → activate; if true → pause
    try {
      const r = await Cgmp_notificationrulesService.update(rule.cgmp_notificationruleid, { cgmp_isactive: nextActive });
      if (!r.success) throw r.error ?? new Error('Update failed');
      showToast('success', nextActive ? 'Rule activated' : 'Rule paused');
      load();
    } catch (err) { showToast('error', err instanceof Error ? err.message : 'Failed'); }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this rule?')) return;
    setDeleting(id);
    try {
      await Cgmp_notificationrulesService.delete(id);
      showToast('success', 'Rule deleted');
      load();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Delete failed');
    } finally { setDeleting(null); }
  };

  return (
    <div className="module-workspace">
      <div className="module-header">
        <div>
          <h1 className="module-title">Notification Rules</h1>
          <p className="module-subtitle">Define custom conditions for when you receive notifications</p>
        </div>
        <button className="btn btn--primary btn--sm" onClick={openCreate}>+ New Rule</button>
      </div>

      <div style={{ margin: '0 24px 16px', padding: '10px 14px', background: 'var(--info-bg, #EBF4FF)', border: '1px solid var(--info-border, #90CAF9)', borderRadius: 6, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        ℹ️ <strong>Server-side evaluation:</strong> Notification rules defined here are evaluated by Power Automate flows at event time. Rules created in this UI are applied automatically — no further configuration is required.
      </div>

      {loading && <div className="module-loading">Loading rules…</div>}
      {!loading && rules.length === 0 && (
        <div className="module-empty">
          No rules yet. Create a rule to get notifications only when specific conditions are met.
        </div>
      )}

      {!loading && rules.length > 0 && (
        <div className="module-table-wrap">
          <table className="ism-table">
            <thead>
              <tr>
                <th>Event Type</th>
                <th>Conditions</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map(rule => {
                const conds = parseConditions(rule.cgmp_conditions);
                const evt = EVENT_TYPES.find(e => e.value === rule.cgmp_eventtype)?.label ?? (rule.cgmp_eventtype || 'Any Event');
                return (
                  <tr key={rule.cgmp_notificationruleid}>
                    <td style={{ fontSize: 13, fontWeight: 600 }}>{evt}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {conds.length === 0 ? 'No conditions (matches all)' : conds.map((c, i) => (
                        <span key={i}>{c.field} = {c.value}{i < conds.length - 1 ? ', ' : ''}</span>
                      ))}
                    </td>
                    <td>
                      <span className={`badge badge--status ${rule.cgmp_isactive !== false ? 'status-released' : 'status-draft'}`} style={{ fontSize: 10 }}>
                        {rule.cgmp_isactive !== false ? 'Active' : 'Paused'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn--xs btn--outline" onClick={() => openEdit(rule)}>Edit</button>
                        <button className="btn btn--xs btn--outline" onClick={() => toggleActive(rule)}>
                          {rule.cgmp_isactive !== false ? 'Pause' : 'Activate'}
                        </button>
                        <button className="btn btn--xs btn--danger-outline" onClick={() => handleDelete(rule.cgmp_notificationruleid)} disabled={deleting === rule.cgmp_notificationruleid}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editId ? 'Edit Rule' : 'New Notification Rule'}
        maxWidth={520}
        footer={
          <>
            <button className="btn btn--outline" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</button>
            <button className="btn btn--primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Rule'}</button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="ff-label">Notify me when (event type)</label>
            <select className="ff-input ff-select" value={form.eventtype} onChange={e => setForm(f => ({ ...f, eventtype: e.target.value }))}>
              {EVENT_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label className="ff-label" style={{ margin: 0 }}>Additional Conditions</label>
              <button className="btn btn--xs btn--outline" onClick={addCondition}>+ Add</button>
            </div>
            {form.conditions.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>No conditions — rule matches all events of the selected type.</p>
            )}
            {form.conditions.map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <select className="ff-input ff-select" style={{ flex: 1 }} value={c.field} onChange={e => updateCondition(i, 'field', e.target.value)}>
                  {CONDITION_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>equals</span>
                <input className="ff-input" style={{ flex: 2 }} value={c.value} onChange={e => updateCondition(i, 'value', e.target.value)} placeholder="Value…" />
                <button className="btn btn--xs btn--danger-outline" onClick={() => removeCondition(i)}>✕</button>
              </div>
            ))}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={form.isactive} onChange={e => setForm(f => ({ ...f, isactive: e.target.checked }))} />
            Rule is active
          </label>
        </div>
      </Dialog>
    </div>
  );
}
