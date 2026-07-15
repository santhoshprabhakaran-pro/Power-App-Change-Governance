import { useState, useEffect, useRef } from 'react';
import { Dialog } from '../ui/Modal';
import { getBrowserInfo } from '../../utils/format';
import { useApp } from '../../context/AppContext';
import { Cgmp_bridgesService, Cgmp_auditlogsService } from '../../generated';
import type { Cgmp_bridges } from '../../generated/models/Cgmp_bridgesModel';
import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';
import type { Cgmp_bridgesBase } from '../../generated/models/Cgmp_bridgesModel';
import type { Cgmp_bridgescgmp_status, Cgmp_bridgescgmp_template } from '../../generated/models/Cgmp_bridgesModel';
import type { Cgmp_auditlogsBase } from '../../generated/models/Cgmp_auditlogsModel';
import { asAuditEntityType, asAuditEventType } from '../../utils/optionSets';

const TEMPLATE_OPTIONS = [
  { value: '100000000', label: 'Network' },
  { value: '100000001', label: 'Citrix' },
  { value: '100000002', label: 'VMware' },
  { value: '100000003', label: 'Firewall' },
  { value: '100000004', label: 'Patch Activities' },
  { value: '100000005', label: 'Custom' },
];

interface FormState {
  title: string;
  template: string;
  changenumber: string;
  schedstart: string;
  schedend: string;
  participants: string;
  teamsurl: string;
  notes: string;
}

const EMPTY: FormState = { title: '', template: '100000000', changenumber: '', schedstart: '', schedend: '', participants: '', teamsurl: '', notes: '' };

function toLocal(iso: string | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 16);
}

function fromBridge(b: Cgmp_bridges): FormState {
  return {
    title: b.cgmp_title ?? '',
    template: String(b.cgmp_template as unknown as number),
    changenumber: b.cgmp_changenumber ?? '',
    schedstart: toLocal(b.cgmp_schedstart),
    schedend: toLocal(b.cgmp_schedend),
    participants: b.cgmp_participants ?? '',
    teamsurl: b.cgmp_teamsurl ?? '',
    notes: b.cgmp_pirnotes ?? '',
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  bridge?: Cgmp_bridges | null;
  onSaved: () => void;
  allChanges?: Cgmp_changes[];
}

export default function BridgeForm({ open, onClose, bridge, onSaved, allChanges = [] }: Props) {
  const { showToast, currentUserName, currentUserUpn } = useApp();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<FormState>>({});
  const [saving, setSaving] = useState(false);
  const isEdit = !!bridge;
  const notesAutoFilledRef = useRef(false);

  useEffect(() => {
    if (open) { setForm(bridge ? fromBridge(bridge) : EMPTY); notesAutoFilledRef.current = false; }
    if (!open) setErrors({});
  }, [open, bridge]);

  /* Auto-populate notes from linked change description when change number is entered */
  useEffect(() => {
    if (isEdit || !form.changenumber.trim()) return;
    const matched = allChanges.find(c => c.cgmp_changenumber?.toLowerCase() === form.changenumber.trim().toLowerCase());
    if (matched?.cgmp_description && !notesAutoFilledRef.current && !form.notes.trim()) {
      setForm(prev => ({ ...prev, notes: matched.cgmp_description ?? '' }));
      notesAutoFilledRef.current = true;
    }
  }, [form.changenumber, form.notes, allChanges, isEdit]);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const validate = (): boolean => {
    const e: Partial<FormState> = {};
    if (!form.title.trim()) e.title = 'Title is required';
    if (!form.schedstart) e.schedstart = 'Scheduled start is required';
    if (!form.schedend) e.schedend = 'Scheduled end is required';
    if (form.schedstart && form.schedend && form.schedstart >= form.schedend)
      e.schedend = 'End must be after start';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        cgmp_title: form.title.trim(),
        cgmp_template: parseInt(form.template) as unknown as Cgmp_bridgescgmp_template,
        cgmp_changenumber: form.changenumber.trim() || undefined,
        cgmp_schedstart: new Date(form.schedstart).toISOString(),
        cgmp_schedend: new Date(form.schedend).toISOString(),
        cgmp_participants: form.participants.trim() || undefined,
        cgmp_teamsurl: form.teamsurl.trim() || undefined,
        cgmp_pirnotes: form.notes.trim() || undefined,
      };

      if (isEdit && bridge) {
        const updateResult = await Cgmp_bridgesService.update(bridge.cgmp_bridgeid, payload);
        if (!updateResult.success) throw updateResult.error ?? new Error('Failed to update bridge');
        Cgmp_auditlogsService.create({
          cgmp_auditlogname: `Bridge Updated: ${form.title}`,
          cgmp_entitytype: asAuditEntityType(100000002),
          cgmp_eventtype: asAuditEventType(100000011),
          cgmp_entityid: bridge.cgmp_bridgeid,
          cgmp_entityname: form.title,
          cgmp_username: currentUserName,
          cgmp_useremail: currentUserUpn,
          cgmp_ipaddress: getBrowserInfo(),
          cgmp_newvalues: JSON.stringify({ title: form.title, template: form.template, schedstart: form.schedstart, schedend: form.schedend }),
        } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch(err => { if (import.meta.env.DEV) console.error('Audit log failed:', err); });
        showToast('success', `Bridge "${form.title}" updated`);
      } else {
        const created = await Cgmp_bridgesService.create({
          ...payload,
          cgmp_status: 100000004 as unknown as Cgmp_bridgescgmp_status, // Scheduled
        } as unknown as Omit<Cgmp_bridgesBase, 'cgmp_bridgeid'>);
        if (!created.success) throw created.error ?? new Error('Failed to create bridge');
        const newId = (created.data as { cgmp_bridgeid?: string } | undefined)?.cgmp_bridgeid ?? '';
        Cgmp_auditlogsService.create({
          cgmp_auditlogname: `Bridge Created: ${form.title}`,
          cgmp_entitytype: asAuditEntityType(100000002),
          cgmp_eventtype: asAuditEventType(100000011),
          cgmp_entityid: newId,
          cgmp_entityname: form.title,
          cgmp_username: currentUserName,
          cgmp_useremail: currentUserUpn,
          cgmp_ipaddress: getBrowserInfo(),
          cgmp_newvalues: JSON.stringify({ title: form.title, template: form.template, schedstart: form.schedstart }),
        } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch(err => { if (import.meta.env.DEV) console.error('Audit log failed:', err); });
        showToast('success', `Bridge "${form.title}" created`);
      }
      onSaved();
      onClose();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save bridge');
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
      <button className="btn btn--outline" onClick={onClose} disabled={saving}>Cancel</button>
      <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : isEdit ? 'Update Bridge' : 'Create Bridge'}
      </button>
    </div>
  );

  return (
    <Dialog open={open} onClose={onClose} title={isEdit ? 'Edit Bridge' : 'Create Bridge'} maxWidth={560} footer={footer}>
      <div className="bridge-form">
        <div className="ff-group">
          <label className="ff-label">Title <span className="ff-required">*</span></label>
          <input className={`ff-input ${errors.title ? 'ff-input--error' : ''}`} value={form.title} onChange={set('title')} placeholder="Bridge title" />
          {errors.title && <span className="ff-error">{errors.title}</span>}
        </div>

        <div className="ff-row">
          <div className="ff-group">
            <label className="ff-label">Template <span className="ff-required">*</span></label>
            <select className="ff-input ff-select" value={form.template} onChange={set('template')}>
              {TEMPLATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="ff-group">
            <label className="ff-label">Change Number</label>
            <input className="ff-input" value={form.changenumber} onChange={set('changenumber')} placeholder="CHG-YYYYMMDD-XXXX" />
          </div>
        </div>

        <div className="ff-row">
          <div className="ff-group">
            <label className="ff-label">Scheduled Start <span className="ff-required">*</span></label>
            <input type="datetime-local" className={`ff-input ${errors.schedstart ? 'ff-input--error' : ''}`} value={form.schedstart} onChange={set('schedstart')} />
            {errors.schedstart && <span className="ff-error">{errors.schedstart}</span>}
          </div>
          <div className="ff-group">
            <label className="ff-label">Scheduled End <span className="ff-required">*</span></label>
            <input type="datetime-local" className={`ff-input ${errors.schedend ? 'ff-input--error' : ''}`} value={form.schedend} onChange={set('schedend')} />
            {errors.schedend && <span className="ff-error">{errors.schedend}</span>}
          </div>
        </div>

        <div className="ff-group">
          <label className="ff-label">Teams URL</label>
          <input className="ff-input" value={form.teamsurl} onChange={set('teamsurl')} placeholder="https://teams.microsoft.com/…" />
        </div>

        <div className="ff-group">
          <label className="ff-label">Participants</label>
          <textarea
            className="ff-input ff-textarea"
            rows={3}
            value={form.participants}
            onChange={set('participants')}
            placeholder="Enter participant names, one per line or JSON array…"
          />
        </div>

        <div className="ff-group">
          <label className="ff-label">Execution Notes
            {notesAutoFilledRef.current && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-tertiary)' }}>(auto-filled from change)</span>}
          </label>
          <textarea
            className="ff-input ff-textarea"
            rows={3}
            value={form.notes}
            onChange={e => { notesAutoFilledRef.current = false; set('notes')(e); }}
            placeholder="Notes about this bridge run (auto-filled from linked change description)…"
          />
        </div>
      </div>
    </Dialog>
  );
}
