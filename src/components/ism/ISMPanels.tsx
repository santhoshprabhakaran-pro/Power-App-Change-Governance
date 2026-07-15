/**
 * Shared panel components for ISMWorkspace:
 * ProjectFormPanel, ProjectViewPanel, ChangeDetailPanel
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { Cgmp_projects, Cgmp_projectsBase } from '../../generated/models/Cgmp_projectsModel';
import type { Cgmp_projectscgmp_status } from '../../generated/models/Cgmp_projectsModel';
import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';
import type { Systemusers } from '../../generated/models/SystemusersModel';
import { Cgmp_projectsService } from '../../generated';
import { statusColor, statusLabel, riskLabel, riskColor } from '../../hooks/useDataverse';
import { fmtDateTime } from '../../utils/format';
import { categoryLabel, changeTypeLabel } from '../pmo/ChangeForm';
import { IMPACT_OPTIONS } from '../pmo/options';
import { SlidePanel } from '../ui/Modal';
import AttachmentPanel from '../ui/AttachmentPanel';
import { UserPickerSelect } from '../ui/UserPickerSelect';
import FilteredSelect from '../ui/FilteredSelect';
import {
  CONNECTIVITY_OPTIONS, POP_OPTIONS, LINK_PROVIDER_OPTIONS,
  TELEPHONY_OPTIONS, LOCATION_OPTIONS, REGION_OPTIONS, COUNTRY_OPTIONS,
} from '../modules/ProjectRepository';

/* ─── Shared constants ──────────────────────────────────────────── */

export const PROJ_STATUS_LABEL: Record<number, string> = {
  100000000: 'Active', 100000001: 'Decommissioned', 100000002: 'On Hold', 100000003: 'Planned',
};
export const PROJ_STATUS_CLASS: Record<number, string> = {
  100000000: 'status-released', 100000001: 'status-cancelled',
  100000002: 'status-uat', 100000003: 'status-closed',
};
export const PROJ_STATUS_OPTIONS = [
  { value: '100000000', label: 'Active' },
  { value: '100000001', label: 'Decommissioned' },
  { value: '100000002', label: 'On Hold' },
  { value: '100000003', label: 'Planned' },
];

/* ─── Full Project Form ──────────────────────────────────────────── */

export interface ProjectFormData {
  name: string;
  pidbnumber: string;
  customer: string;
  location: string;
  region: string;
  country: string;
  facility: string;
  tower: string;
  primaryism: string;
  backupism: string;
  techpoc: string;
  distributionlist: string;
  description: string;
  status: string;
  primaryconnectivity: string;
  secondaryconnectivity: string;
  primarypop: string;
  secondarypop: string;
  primarylinkprovider: string;
  secondarylinkprovider: string;
  primarytelephony: string;
  secondarytelephony: string;
}

export function blankProjectForm(defaultISM = ''): ProjectFormData {
  return {
    name: '', pidbnumber: '', customer: '', location: '', region: '', country: '',
    facility: '', tower: '', primaryism: defaultISM, backupism: '', techpoc: '',
    distributionlist: '', description: '', status: '100000000',
    primaryconnectivity: '', secondaryconnectivity: '',
    primarypop: '', secondarypop: '',
    primarylinkprovider: '', secondarylinkprovider: '',
    primarytelephony: '', secondarytelephony: '',
  };
}

export function fromProject(p: Cgmp_projects): ProjectFormData {
  return {
    name: p.cgmp_name ?? '', pidbnumber: p.cgmp_pidbnumber ?? '',
    customer: p.cgmp_customer ?? '', location: p.cgmp_location ?? '',
    region: p.cgmp_region ?? '', country: p.cgmp_country ?? '',
    facility: p.cgmp_facility ?? '', tower: p.cgmp_tower ?? '',
    primaryism: p.cgmp_primaryism ?? '', backupism: p.cgmp_backupism ?? '',
    techpoc: p.cgmp_techpoc ?? '', distributionlist: p.cgmp_distributionlist ?? '',
    description: p.cgmp_description ?? '', status: String(p.cgmp_status as unknown as number),
    primaryconnectivity: p.cgmp_primaryconnectivity ?? '',
    secondaryconnectivity: p.cgmp_secondaryconnectivity ?? '',
    primarypop: p.cgmp_primarypop ?? '', secondarypop: p.cgmp_secondarypop ?? '',
    primarylinkprovider: p.cgmp_primarylinkprovider ?? '',
    secondarylinkprovider: p.cgmp_secondarylinkprovider ?? '',
    primarytelephony: p.cgmp_primarytelephony ?? '',
    secondarytelephony: p.cgmp_secondarytelephony ?? '',
  };
}

function toOpts(arr: readonly string[]) {
  return arr.map(v => <option key={v} value={v}>{v}</option>);
}

function SectionHead({ title }: { title: string }) {
  return (
    <div className="proj-form-section">
      <span className="proj-form-section__label">{title}</span>
      <div className="proj-form-section__line" />
    </div>
  );
}

export interface ProjectFormPanelProps {
  open: boolean;
  onClose: () => void;
  project: Cgmp_projects | null;
  defaultISM: string;
  onSaved: () => void;
  systemUsers: Systemusers[];
  usersLoading: boolean;
  showToast: (type: 'success' | 'error' | 'info' | 'warning', msg: string) => void;
}

export function ProjectFormPanel({ open, onClose, project, defaultISM, onSaved, systemUsers, usersLoading, showToast }: ProjectFormPanelProps) {
  const [form, setForm] = useState<ProjectFormData>(blankProjectForm(defaultISM));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setForm(project ? fromProject(project) : blankProjectForm(defaultISM));
    setErrors({});
  }, [open, project, defaultISM]);

  const set = useCallback((k: keyof ProjectFormData, v: string) => {
    setForm(prev => ({ ...prev, [k]: v }));
    setErrors(prev => { const next = { ...prev }; delete next[k]; return next; });
  }, []);

  const setField = (k: keyof ProjectFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      set(k, e.target.value);

  const handleSave = useCallback(async () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Project name is required';
    if (Object.keys(e).length > 0) { setErrors(e); return; }

    setSaving(true);
    try {
      const payload = {
        cgmp_name: form.name.trim(),
        cgmp_pidbnumber: form.pidbnumber.trim() || undefined,
        cgmp_customer: form.customer.trim() || undefined,
        cgmp_location: form.location || undefined,
        cgmp_region: form.region || undefined,
        cgmp_country: form.country || undefined,
        cgmp_facility: form.facility.trim() || undefined,
        cgmp_tower: form.tower.trim() || undefined,
        cgmp_primaryism: form.primaryism.trim() || undefined,
        cgmp_backupism: form.backupism.trim() || undefined,
        cgmp_techpoc: form.techpoc || undefined,
        cgmp_distributionlist: form.distributionlist.trim() || undefined,
        cgmp_description: form.description.trim() || undefined,
        cgmp_status: Number(form.status) as unknown as Cgmp_projectscgmp_status,
        cgmp_primaryconnectivity: form.primaryconnectivity || undefined,
        cgmp_secondaryconnectivity: form.secondaryconnectivity || undefined,
        cgmp_primarypop: form.primarypop || undefined,
        cgmp_secondarypop: form.secondarypop || undefined,
        cgmp_primarylinkprovider: form.primarylinkprovider || undefined,
        cgmp_secondarylinkprovider: form.secondarylinkprovider || undefined,
        cgmp_primarytelephony: form.primarytelephony || undefined,
        cgmp_secondarytelephony: form.secondarytelephony || undefined,
      };

      if (project) {
        const prevISM = project.cgmp_primaryism;
        let ownershipHistory: object[] = [];
        try { ownershipHistory = JSON.parse(project.cgmp_ownershiphistory ?? '[]'); } catch { /* ok */ }
        if (!Array.isArray(ownershipHistory)) ownershipHistory = [];
        if (prevISM !== form.primaryism.trim()) {
          ownershipHistory.push({ from: prevISM, to: form.primaryism.trim(), changedAt: new Date().toISOString() });
        }
        const r = await Cgmp_projectsService.update(project.cgmp_projectid, {
          ...payload,
          cgmp_ownershiphistory: JSON.stringify(ownershipHistory),
        });
        if (!r.success) throw r.error ?? new Error('Update failed');
        showToast('success', `Project "${form.name}" updated`);
      } else {
        const r = await Cgmp_projectsService.create(payload as unknown as Omit<Cgmp_projectsBase, 'cgmp_projectid'>);
        if (!r.success) throw r.error ?? new Error('Create failed');
        showToast('success', `Project "${form.name}" created`);
      }
      onSaved();
      onClose();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save project');
    } finally {
      setSaving(false);
    }
  }, [form, project, onSaved, onClose, showToast]);

  const title = project ? `Edit: ${project.cgmp_name}` : 'New Project';
  const subtitle = project ? 'Update project details' : 'Create a new project — Primary ISM is pre-filled';

  return (
    <SlidePanel open={open} onClose={onClose} title={title} subtitle={subtitle} width={640}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn--outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : project ? 'Save Changes' : 'Create Project'}
          </button>
        </div>
      }
    >
      <div className="proj-form">
        <SectionHead title="Basic Information" />
        <div className="ff-row">
          <div className="ff-group">
            <label className="ff-label">PIDB No.</label>
            <input className="ff-input" value={form.pidbnumber} onChange={setField('pidbnumber')} placeholder="Unique PIDB number" />
          </div>
          <div className="ff-group">
            <label className="ff-label">Status</label>
            <select className="ff-input ff-select" value={form.status} onChange={setField('status')}>
              {PROJ_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <div className="ff-group">
          <label className="ff-label">Project Name <span className="ff-required">*</span></label>
          <input className={`ff-input ${errors.name ? 'ff-input--error' : ''}`} value={form.name}
            onChange={setField('name')} placeholder="Enter project name" />
          {errors.name && <span className="ff-error">{errors.name}</span>}
        </div>
        <div className="ff-row">
          <div className="ff-group">
            <label className="ff-label">Client Name</label>
            <input className="ff-input" value={form.customer} onChange={setField('customer')} placeholder="Client / customer name" />
          </div>
          <div className="ff-group">
            <label className="ff-label">Tower</label>
            <input className="ff-input" value={form.tower} onChange={setField('tower')} placeholder="e.g. Network, Servers" />
          </div>
        </div>

        <SectionHead title="Location Details" />
        <div className="ff-row">
          <div className="ff-group">
            <label className="ff-label">Location</label>
            <select className="ff-input ff-select" value={form.location} onChange={setField('location')}>
              <option value="">— Select location —</option>
              {toOpts(LOCATION_OPTIONS)}
            </select>
          </div>
          <div className="ff-group">
            <label className="ff-label">Facility</label>
            <input className="ff-input" value={form.facility} onChange={setField('facility')} placeholder="Facility / data center name" />
          </div>
        </div>
        <div className="ff-row">
          <div className="ff-group">
            <label className="ff-label">Region</label>
            <select className="ff-input ff-select" value={form.region} onChange={setField('region')}>
              <option value="">— Select region —</option>
              {toOpts(REGION_OPTIONS)}
            </select>
          </div>
          <div className="ff-group">
            <label className="ff-label">Country</label>
            <select className="ff-input ff-select" value={form.country} onChange={setField('country')}>
              <option value="">— Select country —</option>
              {toOpts(COUNTRY_OPTIONS)}
            </select>
          </div>
        </div>

        <SectionHead title="Network Connectivity" />
        <div className="ff-row">
          <div className="ff-group">
            <label className="ff-label">Primary Connectivity Type</label>
            <FilteredSelect
              options={CONNECTIVITY_OPTIONS.map(v => ({ value: v, label: v }))}
              value={form.primaryconnectivity}
              onChange={v => set('primaryconnectivity', v)}
              placeholder="— Select —"
            />
          </div>
          <div className="ff-group">
            <label className="ff-label">Secondary Connectivity Type</label>
            <FilteredSelect
              options={CONNECTIVITY_OPTIONS.map(v => ({ value: v, label: v }))}
              value={form.secondaryconnectivity}
              onChange={v => set('secondaryconnectivity', v)}
              placeholder="— Select —"
            />
          </div>
        </div>

        <SectionHead title="POP Details" />
        <div className="ff-row">
          <div className="ff-group">
            <label className="ff-label">Primary POP</label>
            <FilteredSelect
              options={POP_OPTIONS.map(v => ({ value: v, label: v }))}
              value={form.primarypop}
              onChange={v => set('primarypop', v)}
              placeholder="— Select —"
            />
          </div>
          <div className="ff-group">
            <label className="ff-label">Secondary POP</label>
            <FilteredSelect
              options={POP_OPTIONS.map(v => ({ value: v, label: v }))}
              value={form.secondarypop}
              onChange={v => set('secondarypop', v)}
              placeholder="— Select —"
            />
          </div>
        </div>

        <SectionHead title="Link Provider Details" />
        <div className="ff-row">
          <div className="ff-group">
            <label className="ff-label">Primary Link Provider</label>
            <select className="ff-input ff-select" value={form.primarylinkprovider} onChange={setField('primarylinkprovider')}>
              <option value="">— Select —</option>
              {toOpts(LINK_PROVIDER_OPTIONS)}
            </select>
          </div>
          <div className="ff-group">
            <label className="ff-label">Secondary Link Provider</label>
            <select className="ff-input ff-select" value={form.secondarylinkprovider} onChange={setField('secondarylinkprovider')}>
              <option value="">— Select —</option>
              {toOpts(LINK_PROVIDER_OPTIONS)}
            </select>
          </div>
        </div>

        <SectionHead title="Telephony Details" />
        <div className="ff-row">
          <div className="ff-group">
            <label className="ff-label">Primary Telephony Solution</label>
            <select className="ff-input ff-select" value={form.primarytelephony} onChange={setField('primarytelephony')}>
              <option value="">— Select —</option>
              {toOpts(TELEPHONY_OPTIONS)}
            </select>
          </div>
          <div className="ff-group">
            <label className="ff-label">Secondary Telephony Solution</label>
            <select className="ff-input ff-select" value={form.secondarytelephony} onChange={setField('secondarytelephony')}>
              <option value="">— Select —</option>
              {toOpts(TELEPHONY_OPTIONS)}
            </select>
          </div>
        </div>

        <SectionHead title="ISM & Technical POC" />
        <div className="ff-row">
          <div className="ff-group">
            <label className="ff-label">Primary ISM</label>
            <UserPickerSelect users={systemUsers} loading={usersLoading} value={form.primaryism}
              onChange={name => set('primaryism', name)} />
            <span className="ff-hint">Lookup from O365 directory</span>
          </div>
          <div className="ff-group">
            <label className="ff-label">Backup ISM</label>
            <UserPickerSelect users={systemUsers} loading={usersLoading} value={form.backupism}
              onChange={name => set('backupism', name)} />
            <span className="ff-hint">Lookup from O365 directory</span>
          </div>
        </div>
        <div className="ff-row">
          <div className="ff-group">
            <label className="ff-label">Tech POC</label>
            <UserPickerSelect users={systemUsers} loading={usersLoading} value={form.techpoc}
              onChange={name => set('techpoc', name)} />
            <span className="ff-hint">Lookup from O365 directory</span>
          </div>
          <div className="ff-group">
            <label className="ff-label">Distribution List</label>
            <input className="ff-input" value={form.distributionlist} onChange={setField('distributionlist')} placeholder="Email distribution list" />
          </div>
        </div>

        <SectionHead title="Additional Information" />
        <div className="ff-group">
          <label className="ff-label">Description</label>
          <textarea className="ff-input ff-textarea" rows={3} value={form.description}
            onChange={setField('description')} placeholder="Project description, notes, or context" />
        </div>
      </div>
    </SlidePanel>
  );
}

/* ─── Project View Panel ─────────────────────────────────────────── */

export function ProjectViewPanel({ project, open, onClose }: { project: Cgmp_projects | null; open: boolean; onClose: () => void }) {
  const uatUsers = useMemo(() => {
    if (!project?.cgmp_uatusers?.trim()) return [];
    try {
      const p = JSON.parse(project.cgmp_uatusers);
      if (Array.isArray(p)) return p;
      if (p && typeof p === 'object') return Object.values(p);
    } catch { /* fall through */ }
    return [];
  }, [project?.cgmp_uatusers]);

  if (!project) return null;
  const sc = project.cgmp_status as unknown as number;

  const Row = ({ label, value }: { label: string; value?: string | null }) => (
    <div className="proj-detail-row">
      <span className="proj-detail-label">{label}</span>
      <span className="proj-detail-value">{value || '—'}</span>
    </div>
  );

  return (
    <SlidePanel open={open} onClose={onClose} title={project.cgmp_name}
      subtitle={project.cgmp_pidbnumber ? `PIDB: ${project.cgmp_pidbnumber}` : 'Project Details'}
      width={540}
      footer={<button className="btn btn--outline" style={{ width: '100%' }} onClick={onClose}>Close</button>}
    >
      <div style={{ padding: '0 20px' }}>
        <div className="proj-detail-section">
          <div className="proj-detail-section__title">Overview</div>
          <div className="proj-detail-row">
            <span className="proj-detail-label">Status</span>
            <span className={`badge badge--status ${PROJ_STATUS_CLASS[sc] ?? 'status-draft'}`}>
              {PROJ_STATUS_LABEL[sc] ?? 'Unknown'}
            </span>
          </div>
          <Row label="PIDB No." value={project.cgmp_pidbnumber} />
          <Row label="Client Name" value={project.cgmp_customer} />
          <Row label="Tower" value={project.cgmp_tower} />
          <Row label="UAT Users" value={uatUsers.length > 0 ? `${uatUsers.length} user${uatUsers.length !== 1 ? 's' : ''} registered` : 'None registered'} />
        </div>

        <div className="proj-detail-section">
          <div className="proj-detail-section__title">Location</div>
          <Row label="Location" value={project.cgmp_location} />
          <Row label="Facility" value={project.cgmp_facility} />
          <Row label="Region" value={project.cgmp_region} />
          <Row label="Country" value={project.cgmp_country} />
        </div>

        <div className="proj-detail-section">
          <div className="proj-detail-section__title">Network Connectivity</div>
          <Row label="Primary Connectivity" value={project.cgmp_primaryconnectivity} />
          <Row label="Secondary Connectivity" value={project.cgmp_secondaryconnectivity} />
          <Row label="Primary POP" value={project.cgmp_primarypop} />
          <Row label="Secondary POP" value={project.cgmp_secondarypop} />
          <Row label="Primary Link Provider" value={project.cgmp_primarylinkprovider} />
          <Row label="Secondary Link Provider" value={project.cgmp_secondarylinkprovider} />
        </div>

        <div className="proj-detail-section">
          <div className="proj-detail-section__title">Telephony</div>
          <Row label="Primary Telephony" value={project.cgmp_primarytelephony} />
          <Row label="Secondary Telephony" value={project.cgmp_secondarytelephony} />
        </div>

        <div className="proj-detail-section">
          <div className="proj-detail-section__title">Contacts</div>
          <Row label="Primary ISM" value={project.cgmp_primaryism} />
          <Row label="Backup ISM" value={project.cgmp_backupism} />
          <Row label="Tech POC" value={project.cgmp_techpoc} />
          <Row label="Distribution List" value={project.cgmp_distributionlist} />
        </div>

        <div className="proj-detail-section">
          <div className="proj-detail-section__title">Description</div>
          {project.cgmp_description
            ? <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>{project.cgmp_description}</p>
            : <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>—</span>}
        </div>

        {uatUsers.length > 0 && (
          <div className="proj-detail-section">
            <div className="proj-detail-section__title">UAT Users ({uatUsers.length})</div>
            {(uatUsers as Array<{ name?: string; email?: string; phone?: string }>).map((u, i) => (
              <div key={i} className="proj-detail-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{u.name || '—'}</span>
                {u.email && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{u.email}</span>}
                {u.phone && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{u.phone}</span>}
              </div>
            ))}
          </div>
        )}

        <div className="proj-detail-section">
          <AttachmentPanel objectId={project.cgmp_projectid} objectTypeCode="cgmp_projects" />
        </div>
      </div>
    </SlidePanel>
  );
}

/* ─── Change Detail Panel ────────────────────────────────────────── */

function impactLabel(code: number): string {
  return IMPACT_OPTIONS.find(o => o.value === String(code))?.label ?? (code ? String(code) : '—');
}

export function ChangeDetailPanel({ change, open, onClose }: { change: Cgmp_changes | null; open: boolean; onClose: () => void }) {
  if (!change) return null;
  const sc = change.cgmp_status as unknown as number;
  const rc = change.cgmp_risklevel as unknown as number;
  const ic = change.cgmp_impactlevel as unknown as number;
  const linkedProjectCount = change.cgmp_projectids
    ? change.cgmp_projectids.split(',').map(s => s.trim()).filter(Boolean).length
    : 0;

  const Row = ({ label, value }: { label: string; value?: string | null }) => (
    <div className="proj-detail-row">
      <span className="proj-detail-label">{label}</span>
      <span className="proj-detail-value">{value || '—'}</span>
    </div>
  );

  return (
    <SlidePanel open={open} onClose={onClose}
      title={change.cgmp_changenumber ?? 'Change Details'}
      subtitle={change.cgmp_title ?? ''}
      width={540}
      footer={<button className="btn btn--outline" style={{ width: '100%' }} onClick={onClose}>Close</button>}
    >
      <div style={{ padding: '0 20px' }}>
        <div className="proj-detail-section">
          <div className="proj-detail-section__title">Status & Flags</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '4px 0 6px' }}>
            <span className={`badge badge--status ${statusColor(sc)}`}>{statusLabel(sc)}</span>
            <span className={`badge badge--risk ${riskColor(rc)}`}>{riskLabel(rc)}</span>
            {change.cgmp_isemergency && <span className="badge" style={{ background: 'var(--danger)', color: 'white' }}>Emergency</span>}
            {change.cgmp_isweekend && <span className="badge" style={{ background: '#8764B8', color: 'white' }}>Weekend</span>}
          </div>
          <Row label="Status" value={statusLabel(sc)} />
          <Row label="Risk Level" value={riskLabel(rc)} />
          <Row label="Impact Level" value={impactLabel(ic)} />
          <Row label="Emergency" value={change.cgmp_isemergency ? 'Yes' : 'No'} />
          <Row label="Weekend Change" value={change.cgmp_isweekend ? 'Yes' : 'No'} />
        </div>

        <div className="proj-detail-section">
          <div className="proj-detail-section__title">Classification</div>
          <Row label="Category" value={categoryLabel(change.cgmp_category as unknown as number)} />
          <Row label="Change Type" value={changeTypeLabel(change.cgmp_changetype as unknown as number)} />
          <Row label="Owner" value={(change.cgmp_createdby as string | undefined) || change.owneridname} />
          <Row label="Change Number" value={change.cgmp_changenumber} />
          <Row label="Impacted Projects" value={linkedProjectCount > 0 ? `${linkedProjectCount} project${linkedProjectCount !== 1 ? 's' : ''}` : 'None'} />
        </div>

        <div className="proj-detail-section">
          <div className="proj-detail-section__title">Schedule & Location</div>
          <Row label="Start Date" value={fmtDateTime(change.cgmp_starttime)} />
          <Row label="End Date" value={fmtDateTime(change.cgmp_endtime)} />
          <Row label="Location" value={change.cgmp_location} />
          <Row label="Region" value={change.cgmp_region} />
          <Row label="Country" value={change.cgmp_country} />
          <Row label="Facility" value={change.cgmp_facility} />
        </div>

        <div className="proj-detail-section">
          <div className="proj-detail-section__title">IT Ops Review</div>
          <Row label="Reviewed By" value={change.cgmp_reviewedby} />
          <Row label="Reviewed At" value={fmtDateTime(change.cgmp_reviewedat)} />
          <Row label="Review Notes" value={change.cgmp_reviewnotes} />
        </div>

        <div className="proj-detail-section">
          <div className="proj-detail-section__title">Description</div>
          {change.cgmp_description
            ? <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>{change.cgmp_description}</p>
            : <span className="proj-detail-value" style={{ fontSize: 13 }}>—</span>}
        </div>

        <div className="proj-detail-section">
          <div className="proj-detail-section__title">PIR Notes</div>
          {change.cgmp_pirnotes
            ? <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>{change.cgmp_pirnotes}</p>
            : <span className="proj-detail-value" style={{ fontSize: 13 }}>—</span>}
        </div>

        <div className="proj-detail-section">
          <AttachmentPanel objectId={change.cgmp_changeid} readOnly />
        </div>
      </div>
    </SlidePanel>
  );
}
