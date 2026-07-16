import { useState, useCallback, useEffect, useRef } from 'react';
import { Cgmp_changetemplatesService } from '../../generated';
import type { Cgmp_changetemplates } from '../../generated/models/Cgmp_changetemplatesModel';
import { useApp } from '../../context/AppContext';
import { Dialog } from '../ui/Modal';
import { CATEGORY_OPTIONS, CHANGE_TYPE_OPTIONS, RISK_OPTIONS, IMPACT_OPTIONS } from '../pmo/options';

const EMPTY_FORM = {
  name: '',
  category: '',
  changetype: '',
  risklevel: '',
  impactlevel: '',
  location: '',
  region: '',
  country: '',
  description: '',
  projectids: '',
  timeline: '',
  uatrequired: false,
  isemergency: false,
};

function TemplateCard({
  t,
  onEdit,
  onDelete,
  isDeleting,
}: {
  t: Cgmp_changetemplates;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting?: boolean;
}) {
  const risk = RISK_OPTIONS.find((o) => o.value === String(t.cgmp_risklevel))?.label ?? '—';
  const cat = CATEGORY_OPTIONS.find((o) => o.value === String(t.cgmp_category))?.label ?? '—';
  return (
    <div className="settings-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{t.cgmp_name || 'Untitled Template'}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
            {cat} · {risk} Risk
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn--xs btn--outline" onClick={onEdit}>
            Edit
          </button>
          <button className="btn btn--xs btn--danger-outline" onClick={onDelete} disabled={isDeleting}>
            Delete
          </button>
        </div>
      </div>
      {t.cgmp_description && (
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
          {t.cgmp_description.slice(0, 120)}
          {(t.cgmp_description.length ?? 0) > 120 ? '…' : ''}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        {t.cgmp_location && <span className="badge badge--status badge--sm status-draft">{t.cgmp_location}</span>}
        {t.cgmp_uatrequired && <span className="badge badge--status badge--sm status-review">UAT Required</span>}
        {t.cgmp_isemergency && <span className="badge badge--status badge--sm status-cancelled">Emergency</span>}
      </div>
    </div>
  );
}

export default function ChangeTemplates() {
  const { showToast, isAdmin } = useApp();
  const [templates, setTemplates] = useState<Cgmp_changetemplates[]>([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // G2-13: Undo toast state
  const [undoState, setUndoState] = useState<{ label: string; snapshot: any } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showUndo = useCallback((label: string, snapshot: any) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoState({ label, snapshot });
    undoTimerRef.current = setTimeout(() => setUndoState(null), 5000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await Cgmp_changetemplatesService.getAll({ orderBy: ['cgmp_name asc'], top: 200 });
      setTemplates(r.data ?? []);
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditId(null);
    setFormOpen(true);
  };
  const openEdit = (t: Cgmp_changetemplates) => {
    setForm({
      name: t.cgmp_name ?? '',
      category: t.cgmp_category ?? '',
      changetype: t.cgmp_changetype ?? '',
      risklevel: t.cgmp_risklevel != null ? String(t.cgmp_risklevel) : '',
      impactlevel: t.cgmp_impactlevel != null ? String(t.cgmp_impactlevel) : '',
      location: t.cgmp_location ?? '',
      region: t.cgmp_region ?? '',
      country: t.cgmp_country ?? '',
      description: t.cgmp_description ?? '',
      projectids: t.cgmp_projectids ?? '',
      timeline: t.cgmp_timeline ?? '',
      uatrequired: t.cgmp_uatrequired ?? false,
      isemergency: t.cgmp_isemergency ?? false,
    });
    setEditId(t.cgmp_changetemplateid);
    setFormOpen(true);
  };

  const set = (key: keyof typeof EMPTY_FORM, val: string | boolean) => setForm((f) => ({ ...f, [key]: val }));

  const handleSave = async () => {
    if (!form.name.trim()) {
      showToast('error', 'Template name is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        cgmp_name: form.name.trim(),
        cgmp_category: form.category || undefined,
        cgmp_changetype: form.changetype || undefined,
        cgmp_risklevel: form.risklevel ? Number(form.risklevel) : undefined,
        cgmp_impactlevel: form.impactlevel ? Number(form.impactlevel) : undefined,
        cgmp_location: form.location || undefined,
        cgmp_region: form.region || undefined,
        cgmp_country: form.country || undefined,
        cgmp_description: form.description || undefined,
        cgmp_projectids: form.projectids || undefined,
        cgmp_timeline: form.timeline || undefined,
        cgmp_uatrequired: form.uatrequired,
        cgmp_isemergency: form.isemergency,
      } as any;
      if (editId) {
        const r = await Cgmp_changetemplatesService.update(editId, payload);
        if (!r.success) throw r.error ?? new Error('Update failed');
        showToast('success', 'Template updated');
      } else {
        const r = await Cgmp_changetemplatesService.create(payload);
        if (!r.success) throw r.error ?? new Error('Create failed');
        showToast('success', 'Template created');
      }
      setFormOpen(false);
      load();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // G2-13: Delete with undo — snapshot saved before delete
  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this template?')) return;
    const snapshot = templates.find((t) => t.cgmp_changetemplateid === id);
    setDeletingId(id);
    try {
      await Cgmp_changetemplatesService.delete(id);
      showToast('success', 'Template deleted');
      load();
      if (snapshot) showUndo('Template deleted', snapshot);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="module-workspace">
      <div className="module-header">
        <div>
          <h1 className="module-title">Change Templates</h1>
          <p className="module-subtitle">Reusable templates to pre-fill common change type fields</p>
        </div>
        {isAdmin && (
          <button className="btn btn--primary btn--sm" onClick={openCreate}>
            + New Template
          </button>
        )}
      </div>

      {loading && <div className="module-loading">Loading templates…</div>}
      {!loading && templates.length === 0 && (
        <div className="module-empty">
          No templates yet.{' '}
          {isAdmin ? 'Create your first template using the button above.' : 'Contact your admin to create templates.'}
        </div>
      )}

      {!loading && templates.length > 0 && (
        <div
          style={{
            padding: '12px 24px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 12,
          }}
        >
          {templates.map((t) => (
            <TemplateCard
              key={t.cgmp_changetemplateid}
              t={t}
              onEdit={() => openEdit(t)}
              onDelete={() => handleDelete(t.cgmp_changetemplateid)}
              isDeleting={deletingId === t.cgmp_changetemplateid}
            />
          ))}
        </div>
      )}

      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editId ? 'Edit Template' : 'New Change Template'}
        maxWidth={560}
        footer={
          <>
            <button className="btn btn--outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Template'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="ff-label">Template Name *</label>
            <input
              className="ff-input"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Standard Software Deployment"
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label className="ff-label">Category</label>
              <select
                className="ff-input ff-select"
                value={form.category}
                onChange={(e) => set('category', e.target.value)}
              >
                <option value="">Select…</option>
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="ff-label">Change Type</label>
              <select
                className="ff-input ff-select"
                value={form.changetype}
                onChange={(e) => set('changetype', e.target.value)}
              >
                <option value="">Select…</option>
                {CHANGE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="ff-label">Risk Level</label>
              <select
                className="ff-input ff-select"
                value={form.risklevel}
                onChange={(e) => set('risklevel', e.target.value)}
              >
                <option value="">Select…</option>
                {RISK_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="ff-label">Impact Level</label>
              <select
                className="ff-input ff-select"
                value={form.impactlevel}
                onChange={(e) => set('impactlevel', e.target.value)}
              >
                <option value="">Select…</option>
                {IMPACT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div>
              <label className="ff-label">Location</label>
              <input
                className="ff-input"
                value={form.location}
                onChange={(e) => set('location', e.target.value)}
                placeholder="e.g. Chennai"
              />
            </div>
            <div>
              <label className="ff-label">Region</label>
              <input
                className="ff-input"
                value={form.region}
                onChange={(e) => set('region', e.target.value)}
                placeholder="e.g. APAC"
              />
            </div>
            <div>
              <label className="ff-label">Country</label>
              <input
                className="ff-input"
                value={form.country}
                onChange={(e) => set('country', e.target.value)}
                placeholder="e.g. India"
              />
            </div>
          </div>
          <div>
            <label className="ff-label">Default Description</label>
            <textarea
              className="ff-input"
              rows={3}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Default change description…"
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
          <div>
            <label className="ff-label">Default Timeline</label>
            <input
              className="ff-input"
              value={form.timeline}
              onChange={(e) => set('timeline', e.target.value)}
              placeholder="e.g. 2 hours maintenance window"
            />
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.uatrequired}
                onChange={(e) => set('uatrequired', e.target.checked)}
              />
              UAT Required
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.isemergency}
                onChange={(e) => set('isemergency', e.target.checked)}
              />
              Emergency Change
            </label>
          </div>
        </div>
      </Dialog>

      {/* G2-13: Undo toast — shown for 5 seconds after delete */}
      {undoState && (
        <div
          className="undo-toast"
          role="status"
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--surface-alt)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '10px 20px',
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            zIndex: 9999,
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          }}
        >
          <span style={{ fontSize: 14 }}>{undoState.label}</span>
          <button
            className="btn btn--sm btn--primary"
            onClick={async () => {
              const snapshot = undoState.snapshot as Cgmp_changetemplates;
              setUndoState(null);
              if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
              try {
                await Cgmp_changetemplatesService.create(snapshot as any);
                load();
                showToast('success', 'Template restored');
              } catch {
                showToast('error', 'Failed to restore template');
              }
            }}
          >
            Undo
          </button>
          <button
            className="btn btn--sm btn--ghost"
            onClick={() => {
              setUndoState(null);
              if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
            }}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
