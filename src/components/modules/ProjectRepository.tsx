import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useProjects, useChangeList, useSystemUsers } from '../../hooks/useDataverse';
import { FilterBuilder, applyFilterGroup, emptyGroup } from '../ui/FilterBuilder';
import type { FilterGroup, FieldDef } from '../ui/FilterBuilder';
import { Cgmp_projectsService } from '../../generated';
import type { Cgmp_projects } from '../../generated/models/Cgmp_projectsModel';
import type { Cgmp_projectsBase } from '../../generated/models/Cgmp_projectsModel';
import type { Cgmp_projectscgmp_status } from '../../generated/models/Cgmp_projectsModel';
import { useApp } from '../../context/AppContext';
import { SlidePanel, Dialog } from '../ui/Modal';
import { UserPickerSelect } from '../ui/UserPickerSelect';
import { parseCSV as parseCSVUtil } from '../../utils/csv';
import { fmtDateTime } from '../../utils/format';

/* ─────────────────────────────────────────────────────────────────────
   Centralized dropdown option lists.
   Add/remove values here → both Primary and Secondary selects update.
───────────────────────────────────────────────────────────────────── */
export const CONNECTIVITY_OPTIONS = [
  'Facility Internet',
  'S2S VPN over Internet',
  'C2S VPN over Internet',
  'First Mile MPLS + Last Mile Internet',
  'First Mile MPLS + Last Mile S2S VPN over Internet',
  'First Mile MPLS + Last Mile Client Managed',
  'End-to-End MPLS',
  'End-to-End Internet',
  'End-to-End SD-WAN',
  'SD-WAN',
  'Client Private Network',
  'Client MPLS',
  'Zscaler Proxy',
  'ExpressRoute',
  'AWS Direct Connect',
  'Internet + VPN Hybrid',
  'Dual Internet',
  'Dedicated Internet',
  'Client Managed',
  'Plain Internet',
  'DIA (Dedicated Internet Access)',
  'Other',
] as const;

export const POP_OPTIONS = [
  'NA', 'CHC', 'DCC', 'LON', 'Hongkong', 'FRC', 'APC', 'EMEA', 'APAC', 'India', 'Others',
] as const;

export const LINK_PROVIDER_OPTIONS = [
  'Bharti', 'Airtel', 'TATA', 'Sify', 'Jio', 'Vodafone Idea',
  'NTT', 'Verizon', 'AT&T', 'BT', 'Client Managed', 'Other',
] as const;

export const TELEPHONY_OPTIONS = [
  'NA',
  'No Voice',
  'Amazon Connect',
  'NICE CXone',
  'Cisco Webex',
  'Cisco UCCE',
  'Microsoft Teams Telephony',
  'Genesys Cloud',
  'Avaya',
  'PSTN',
  'Client Provided',
  'Client Managed',
  'RingCentral',
  'Other',
] as const;

export const LOCATION_OPTIONS = [
  'Chennai', 'Coimbatore', 'Hyderabad', 'Bengaluru', 'Mumbai', 'Delhi/NCR',
  'Pune', 'Kolkata', 'Noida', 'Gurugram', 'Ahmedabad', 'Kochi',
  'Thiruvananthapuram', 'Singapore', 'London', 'New York', 'Sydney',
  'Dubai', 'Frankfurt', 'Tokyo', 'Manila', 'Kuala Lumpur', 'Others',
] as const;

export const REGION_OPTIONS = [
  'India', 'APAC', 'EMEA', 'AMER', 'North America', 'ANZ',
  'MEA', 'South East Asia', 'Europe', 'GCC', 'LATAM', 'Others',
] as const;

export const COUNTRY_OPTIONS = [
  'India', 'USA', 'UK', 'Singapore', 'Australia', 'UAE', 'Germany',
  'Japan', 'Malaysia', 'Philippines', 'South Africa', 'France',
  'Canada', 'Netherlands', 'New Zealand', 'Others',
] as const;

/* ── Helper: build <option> elements from a readonly string[] const ── */
function toOpts(arr: readonly string[]): React.ReactNode {
  return arr.map(v => <option key={v} value={v}>{v}</option>);
}

/* ── Status config — matches Dataverse numeric codes ── */
const PROJ_STATUS_OPTS = [
  { value: '100000000', label: 'Active' },
  { value: '100000001', label: 'Decommissioned' },
  { value: '100000002', label: 'On Hold' },
  { value: '100000003', label: 'Planned' },
];
const PROJ_STATUS_MAP: Record<string, number> = {
  'active': 100000000, 'decommissioned': 100000001, 'on hold': 100000002, 'planned': 100000003,
};
const PROJ_CSV_COLS = ['Name', 'PIDNumber', 'Status', 'Customer', 'Tower', 'ISM', 'BackupISM', 'Region', 'Country', 'Facility', 'TechPOC', 'Description'];
const PROJ_CSV_TEMPLATE = PROJ_CSV_COLS.join(',') + '\nTest Project,PIDB-0001,Active,Acme Corp,Network,John Smith,,APAC,India,Building A,Jane Doe,Sample project description';

interface ProjImportRow { raw: Record<string, string>; errors: string[]; valid: boolean; }

function parseProjRows(text: string): ProjImportRow[] {
  const allRows = parseCSVUtil(text);
  if (allRows.length < 2) return [];
  const headerRow = allRows[0] ?? [];
  const dataRows = allRows.slice(1).filter(r => r.some(c => c.trim()));
  return dataRows.map(cols => {
    const raw: Record<string, string> = {};
    headerRow.forEach((h, i) => { raw[h.trim()] = (cols[i] ?? '').trim(); });
    const errors: string[] = [];
    if (!raw.Name) errors.push('Name is required');
    if (!raw.PIDNumber) errors.push('PIDNumber is required');
    if (raw.Status && !PROJ_STATUS_MAP[raw.Status.toLowerCase()]) errors.push(`Invalid Status: ${raw.Status}`);
    return { raw, errors, valid: errors.length === 0 };
  });
}

const STATUS_CLASS: Record<number, string> = {
  100000000: 'status-released',
  100000001: 'status-cancelled',
  100000002: 'status-uat',
  100000003: 'status-review',
};

/* ── Form state ── */
interface ProjForm {
  name: string;
  pidbnumber: string;
  customer: string;             // displayed as "Client Name"
  location: string;
  region: string;
  country: string;
  facility: string;
  tower: string;
  primaryism: string;
  backupism: string;
  techpoc: string;              // Tech POC — stores fullname from O365
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

const EMPTY_FORM: ProjForm = {
  name: '', pidbnumber: '', customer: '', location: '',
  region: '', country: '', facility: '', tower: '',
  primaryism: '', backupism: '', techpoc: '', distributionlist: '', description: '',
  status: '100000000',
  primaryconnectivity: '', secondaryconnectivity: '',
  primarypop: '', secondarypop: '',
  primarylinkprovider: '', secondarylinkprovider: '',
  primarytelephony: '', secondarytelephony: '',
};

function fromProject(p: Cgmp_projects): ProjForm {
  return {
    name: p.cgmp_name ?? '',
    pidbnumber: p.cgmp_pidbnumber ?? '',
    customer: p.cgmp_customer ?? '',
    location: p.cgmp_location ?? '',
    region: p.cgmp_region ?? '',
    country: p.cgmp_country ?? '',
    facility: p.cgmp_facility ?? '',
    tower: p.cgmp_tower ?? '',
    primaryism: p.cgmp_primaryism ?? '',
    backupism: p.cgmp_backupism ?? '',
    techpoc: p.cgmp_techpoc ?? '',
    distributionlist: p.cgmp_distributionlist ?? '',
    description: p.cgmp_description ?? '',
    status: String(p.cgmp_status as unknown as number),
    primaryconnectivity: p.cgmp_primaryconnectivity ?? '',
    secondaryconnectivity: p.cgmp_secondaryconnectivity ?? '',
    primarypop: p.cgmp_primarypop ?? '',
    secondarypop: p.cgmp_secondarypop ?? '',
    primarylinkprovider: p.cgmp_primarylinkprovider ?? '',
    secondarylinkprovider: p.cgmp_secondarylinkprovider ?? '',
    primarytelephony: p.cgmp_primarytelephony ?? '',
    secondarytelephony: p.cgmp_secondarytelephony ?? '',
  };
}

/* ── Form section divider ── */
function SectionHead({ title }: { title: string }) {
  return (
    <div className="proj-form-section">
      <span className="proj-form-section__label">{title}</span>
      <div className="proj-form-section__line" />
    </div>
  );
}

/* ── Detail panel field row ── */
function DetailRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="proj-detail-row">
      <span className="proj-detail-label">{label}</span>
      <span className="proj-detail-value">{value || '—'}</span>
    </div>
  );
}

/* ── Primary / Secondary pair row in detail panel ── */
function DualDetailRow({ label, primary, secondary }: { label: string; primary?: string | null; secondary?: string | null }) {
  const hasData = primary || secondary;
  return (
    <div className="proj-dual-row">
      <span className="proj-dual-label">{label}</span>
      <div className="proj-dual-values">
        <span className={`proj-dual-primary ${!primary ? 'proj-dual-empty' : ''}`}>
          <span className="proj-dual-tag">Primary</span>
          {primary || '—'}
        </span>
        {hasData && (
          <span className={`proj-dual-secondary ${!secondary ? 'proj-dual-empty' : ''}`}>
            <span className="proj-dual-tag">Secondary</span>
            {secondary || '—'}
          </span>
        )}
      </div>
    </div>
  );
}


/* ── Advanced filter field definitions ── */
export const PROJECT_FILTER_FIELDS: FieldDef[] = [
  { key: 'cgmp_name', label: 'Project Name', type: 'text' },
  { key: 'cgmp_pidbnumber', label: 'PIDB No.', type: 'text' },
  { key: 'cgmp_customer', label: 'Client', type: 'text' },
  { key: 'cgmp_location', label: 'Location', type: 'select', options: LOCATION_OPTIONS.map(v => ({ value: v, label: v })) },
  { key: 'cgmp_region', label: 'Region', type: 'select', options: REGION_OPTIONS.map(v => ({ value: v, label: v })) },
  { key: 'cgmp_country', label: 'Country', type: 'select', options: COUNTRY_OPTIONS.map(v => ({ value: v, label: v })) },
  { key: 'cgmp_tower', label: 'Tower', type: 'text' },
  { key: 'cgmp_facility', label: 'Facility', type: 'text' },
  { key: 'cgmp_primaryism', label: 'Primary ISM', type: 'text' },
  { key: 'cgmp_backupism', label: 'Backup ISM', type: 'text' },
  { key: 'cgmp_techpoc', label: 'Tech POC', type: 'text' },
  { key: 'cgmp_status', label: 'Status', type: 'select', options: PROJ_STATUS_OPTS },
  { key: 'cgmp_primaryconnectivity', label: 'Primary Connectivity', type: 'text' },
  { key: 'cgmp_secondaryconnectivity', label: 'Secondary Connectivity', type: 'text' },
  { key: 'cgmp_primarypop', label: 'Primary POP', type: 'text' },
  { key: 'cgmp_primarylinkprovider', label: 'Primary Link Provider', type: 'text' },
  { key: 'cgmp_primarytelephony', label: 'Primary Telephony', type: 'text' },
  { key: 'cgmp_description', label: 'Description', type: 'text' },
  { key: 'cgmp_distributionlist', label: 'Distribution List', type: 'text' },
];

/* ═══════════════════════════════════════════════════════════════════
   Main component
═══════════════════════════════════════════════════════════════════ */
export default function ProjectRepository() {
  const { showToast, navigate } = useApp();
  const { projects, loading, refresh } = useProjects();
  const { changes } = useChangeList();
  const { users: systemUsers, loading: usersLoading } = useSystemUsers();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);
  const [statusFilter, setStatusFilter] = useState('');
  const [towerFilter, setTowerFilter] = useState('');
  const [filterGroup, setFilterGroup] = useState<FilterGroup>(emptyGroup());
  const [sortKey, setSortKey] = useState<keyof Cgmp_projects>('cgmp_name');
  const [sortAsc, setSortAsc] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editProject, setEditProject] = useState<Cgmp_projects | null>(null);
  const [detailProject, setDetailProject] = useState<Cgmp_projects | null>(null);
  const [form, setForm] = useState<ProjForm>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof ProjForm, string>>>({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Cgmp_projects | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  /* Bulk Import (#62) */
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<ProjImportRow[]>([]);
  const [importStep, setImportStep] = useState<'upload' | 'preview' | 'importing' | 'done'>('upload');
  const [importResults, setImportResults] = useState<{ ok: number; failed: number }>({ ok: 0, failed: 0 });
  const importFileRef = useRef<HTMLInputElement | null>(null);

  const regions = useMemo(() => [...new Set(projects.map(p => p.cgmp_region).filter(Boolean) as string[])].sort(), [projects]);
  const towers = useMemo(() => [...new Set(projects.map(p => p.cgmp_tower).filter(Boolean) as string[])].sort(), [projects]);

  /* #63 ISM workload: count projects per ISM UPN */
  const ismWorkloadMap = useMemo(() => {
    const map: Record<string, number> = {};
    projects.forEach(p => { if (p.cgmp_primaryism) map[p.cgmp_primaryism] = (map[p.cgmp_primaryism] ?? 0) + 1; });
    return map;
  }, [projects]);

  /* #64 Network redundancy flag: detects single-point-of-failure.
     'NA' means not applicable — skip those fields entirely. */
  const hasRedundancyRisk = (p: Cgmp_projects): boolean => {
    const isNA = (v: string | undefined) => !v || v.trim().toUpperCase() === 'NA';
    const spof = (a: string | undefined, b: string | undefined) =>
      !isNA(a) && !isNA(b) && !!a && a === b;
    const sec = p.cgmp_secondarypop || p.cgmp_secondarylinkprovider;
    if (!sec) return false;
    return spof(p.cgmp_primarypop, p.cgmp_secondarypop) ||
           spof(p.cgmp_primarylinkprovider, p.cgmp_secondarylinkprovider);
  };

  const filtered = useMemo(() => {
    let list = projects;
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter(p =>
        p.cgmp_name?.toLowerCase().includes(q) ||
        p.cgmp_customer?.toLowerCase().includes(q) ||
        p.cgmp_pidbnumber?.toLowerCase().includes(q) ||
        p.cgmp_primaryism?.toLowerCase().includes(q) ||
        p.cgmp_location?.toLowerCase().includes(q) ||
        p.cgmp_techpoc?.toLowerCase().includes(q)
      );
    }
    if (regionFilter) list = list.filter(p => p.cgmp_region === regionFilter);
    if (towerFilter) list = list.filter(p => p.cgmp_tower === towerFilter);
    if (statusFilter) list = list.filter(p => (p.cgmp_status as unknown as number) === parseInt(statusFilter));
    list = applyFilterGroup(list as unknown as Record<string, unknown>[], PROJECT_FILTER_FIELDS, filterGroup) as unknown as typeof projects;
    return [...list].sort((a, b) => {
      const av = String(a[sortKey] ?? ''), bv = String(b[sortKey] ?? '');
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [projects, debouncedSearch, regionFilter, towerFilter, statusFilter, filterGroup, sortKey, sortAsc]);

  const hasActiveFilters =
    !!debouncedSearch.trim() ||
    !!regionFilter ||
    !!towerFilter ||
    !!statusFilter ||
    filterGroup.conditions.some(
      c => c.field && (c.operator === 'isEmpty' || c.operator === 'isNotEmpty' || c.value !== '')
    );

  const clearAllFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setRegionFilter('');
    setTowerFilter('');
    setStatusFilter('');
    setFilterGroup(emptyGroup());
  };

  const handleSort = (key: keyof Cgmp_projects) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(true); }
  };

  const openCreate = () => { setEditProject(null); setForm(EMPTY_FORM); setFormErrors({}); setFormOpen(true); };
  const openEdit = (p: Cgmp_projects) => { setEditProject(p); setForm(fromProject(p)); setFormErrors({}); setFormOpen(true); };
  const openClone = (p: Cgmp_projects) => {
    setEditProject(null);
    const cloned = fromProject(p);
    cloned.name = `${cloned.name} (Copy)`;
    cloned.pidbnumber = '';
    setForm(cloned);
    setFormErrors({});
    setFormOpen(true);
    showToast('info', `Cloning "${p.cgmp_name}" — update the name and PIDB number before saving`);
  };

  const setField = (k: keyof ProjForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(prev => ({ ...prev, [k]: e.target.value }));

  const validate = (): boolean => {
    const e: Partial<Record<keyof ProjForm, string>> = {};
    if (!form.name.trim()) e.name = 'Project name is required';
    if (!form.pidbnumber.trim()) e.pidbnumber = 'PIDB No. is required';
    setFormErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = useCallback(async () => {
    if (!validate()) return;
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
        cgmp_status: parseInt(form.status) as unknown as Cgmp_projectscgmp_status,
        cgmp_primaryconnectivity: form.primaryconnectivity || undefined,
        cgmp_secondaryconnectivity: form.secondaryconnectivity || undefined,
        cgmp_primarypop: form.primarypop || undefined,
        cgmp_secondarypop: form.secondarypop || undefined,
        cgmp_primarylinkprovider: form.primarylinkprovider || undefined,
        cgmp_secondarylinkprovider: form.secondarylinkprovider || undefined,
        cgmp_primarytelephony: form.primarytelephony || undefined,
        cgmp_secondarytelephony: form.secondarytelephony || undefined,
      };

      if (editProject) {
        let ownershipHistory: any[] = [];
        try { ownershipHistory = JSON.parse(editProject.cgmp_ownershiphistory ?? '[]'); } catch {}
        if (!Array.isArray(ownershipHistory)) ownershipHistory = [];

        /* Track all field changes as audit trail entries */
        const PROJ_STATUS_LABEL: Record<string, string> = { '100000000': 'Active', '100000001': 'Decommissioned', '100000002': 'On Hold', '100000003': 'Planned' };
        const now = new Date().toISOString();
        const fieldDefs: Array<{ label: string; prev: string; next: string }> = [
          { label: 'Name', prev: editProject.cgmp_name ?? '', next: form.name.trim() },
          { label: 'Status', prev: PROJ_STATUS_LABEL[String(editProject.cgmp_status ?? '')] ?? String(editProject.cgmp_status ?? ''), next: PROJ_STATUS_LABEL[form.status] ?? form.status },
          { label: 'Customer', prev: editProject.cgmp_customer ?? '', next: form.customer.trim() },
          { label: 'Region', prev: editProject.cgmp_region ?? '', next: form.region },
          { label: 'Tower', prev: editProject.cgmp_tower ?? '', next: form.tower.trim() },
          { label: 'Primary ISM', prev: editProject.cgmp_primaryism ?? '', next: form.primaryism.trim() },
          { label: 'Backup ISM', prev: editProject.cgmp_backupism ?? '', next: form.backupism.trim() },
          { label: 'Tech POC', prev: editProject.cgmp_techpoc ?? '', next: form.techpoc },
          { label: 'Primary Connectivity', prev: editProject.cgmp_primaryconnectivity ?? '', next: form.primaryconnectivity },
          { label: 'Secondary Connectivity', prev: editProject.cgmp_secondaryconnectivity ?? '', next: form.secondaryconnectivity },
        ];
        for (const { label, prev, next } of fieldDefs) {
          if (prev !== next) {
            ownershipHistory.push({ _type: 'field_change', field: label, before: prev || '—', after: next || '—', changedAt: now });
          }
        }

        const upd = await Cgmp_projectsService.update(editProject.cgmp_projectid, {
          ...payload,
          cgmp_ownershiphistory: JSON.stringify(ownershipHistory),
        });
        if (!upd.success) throw upd.error ?? new Error('Failed to update project');
        showToast('success', `Project "${form.name}" updated`);
      } else {
        const crt = await Cgmp_projectsService.create({
          ...payload,
        } as unknown as Omit<Cgmp_projectsBase, 'cgmp_projectid'>);
        if (!crt.success) throw crt.error ?? new Error('Failed to create project');
        showToast('success', `Project "${form.name}" created`);
      }
      refresh();
      setFormOpen(false);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save project');
    } finally { setSaving(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, editProject, showToast, refresh]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await Cgmp_projectsService.delete(deleteTarget.cgmp_projectid);
      showToast('success', `Project "${deleteTarget.cgmp_name}" deleted`);
      refresh();
      setDeleteTarget(null);
      setDeleteConfirmOpen(false);
      if (detailProject?.cgmp_projectid === deleteTarget.cgmp_projectid) setDetailProject(null);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to delete project');
    } finally { setDeleting(false); }
  }, [deleteTarget, detailProject, showToast, refresh]);

  const handleImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const rows = parseProjRows(text);
      setImportRows(rows);
      setImportStep(rows.length > 0 ? 'preview' : 'upload');
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const doImport = useCallback(async () => {
    const validRows = importRows.filter(r => r.valid);
    if (validRows.length === 0) return;
    setImportStep('importing');
    let ok = 0; let failed = 0;
    for (const row of validRows) {
      try {
        const statusCode = PROJ_STATUS_MAP[row.raw.Status?.toLowerCase() ?? ''] ?? 100000000;
        await Cgmp_projectsService.create({
          cgmp_name: row.raw.Name,
          cgmp_pidbnumber: row.raw.PIDNumber,
          cgmp_status: statusCode as unknown as Cgmp_projectscgmp_status,
          cgmp_customer: row.raw.Customer || undefined,
          cgmp_tower: row.raw.Tower || undefined,
          cgmp_primaryism: row.raw.ISM || undefined,
          cgmp_backupism: row.raw.BackupISM || undefined,
          cgmp_region: row.raw.Region || undefined,
          cgmp_country: row.raw.Country || undefined,
          cgmp_facility: row.raw.Facility || undefined,
          cgmp_techpoc: row.raw.TechPOC || undefined,
          cgmp_description: row.raw.Description || undefined,
          ownerid: '', owneridtype: '',
          statecode: 0 as any,
        } as unknown as Cgmp_projectsBase);
        ok++;
      } catch { failed++; }
    }
    setImportResults({ ok, failed });
    setImportStep('done');
    refresh();
  }, [importRows, refresh]);

  const sortIcon = (key: keyof Cgmp_projects) => sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '';

  const formFooter = (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
      <button className="btn btn--outline" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</button>
      <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : editProject ? 'Update Project' : 'Create Project'}
      </button>
    </div>
  );

  return (
    <div className="module-workspace">
      <div className="module-header">
        <div>
          <h1 className="module-title">Project Repository</h1>
          <p className="module-subtitle">Manage projects, ISM assignments, network details, and ownership</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--outline btn--sm" onClick={() => { setImportStep('upload'); setImportRows([]); setImportOpen(true); }}>Import CSV</button>
          <button className="btn btn--primary btn--sm" onClick={openCreate}>+ New Project</button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        <input
          className="filter-bar__search"
          placeholder="Search by PIDB No., name, client, location, Tech POC, or ISM…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="filter-bar__select" value={regionFilter} onChange={e => setRegionFilter(e.target.value)}>
          <option value="">All Regions</option>
          {regions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="filter-bar__select" value={towerFilter} onChange={e => setTowerFilter(e.target.value)}>
          <option value="">All Towers</option>
          {towers.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="filter-bar__select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          {PROJ_STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="filter-bar__count">{filtered.length} of {projects.length}</span>
      </div>

      {/* Advanced filter builder */}
      <div style={{ padding: '0 0 8px' }}>
        <FilterBuilder
          fields={PROJECT_FILTER_FIELDS}
          value={filterGroup}
          onChange={setFilterGroup}
          matchCount={filtered.length}
          totalCount={projects.length}
          presetKey="projects"
        />
      </div>

      {/* Table */}
      <div className="module-table-wrap">
        {loading ? (
          <div className="module-loading">Loading projects…</div>
        ) : filtered.length === 0 ? (
          hasActiveFilters ? (
            <div
              style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}
              aria-live="polite"
            >
              <p style={{ fontWeight: 600 }}>No items match your filters</p>
              <p style={{ fontSize: 13, marginTop: 4 }}>
                Try adjusting or clearing your filter criteria.
              </p>
              <button
                className="btn btn-secondary"
                style={{ marginTop: 12 }}
                onClick={clearAllFilters}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="module-empty">No projects found.</div>
          )
        ) : (
          <table className="ism-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('cgmp_pidbnumber')} style={{ cursor: 'pointer' }}>PIDB No.{sortIcon('cgmp_pidbnumber')}</th>
                <th onClick={() => handleSort('cgmp_name')} style={{ cursor: 'pointer' }}>Project Name{sortIcon('cgmp_name')}</th>
                <th onClick={() => handleSort('cgmp_customer')} style={{ cursor: 'pointer' }}>Client Name{sortIcon('cgmp_customer')}</th>
                <th onClick={() => handleSort('cgmp_location')} style={{ cursor: 'pointer' }}>Location{sortIcon('cgmp_location')}</th>
                <th onClick={() => handleSort('cgmp_region')} style={{ cursor: 'pointer' }}>Region{sortIcon('cgmp_region')}</th>
                <th>Tower</th>
                <th>Primary ISM</th>
                <th onClick={() => handleSort('cgmp_techpoc')} style={{ cursor: 'pointer' }}>Tech POC{sortIcon('cgmp_techpoc')}</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const sc = p.cgmp_status as unknown as number;
                const ismCount = p.cgmp_primaryism ? (ismWorkloadMap[p.cgmp_primaryism] ?? 0) : 0;
                const redundancy = hasRedundancyRisk(p);
                return (
                  <tr key={p.cgmp_projectid}>
                    <td>
                      <span className="proj-pidb">{p.cgmp_pidbnumber || '—'}</span>
                      {redundancy && <span title="Single point of failure — primary and secondary network paths share the same provider/POP/connectivity" style={{ marginLeft: 4, color: 'var(--orange)', fontSize: 12, cursor: 'help' }}>⚠</span>}
                    </td>
                    <td>
                      <button className="link-btn" onClick={() => setDetailProject(p)}>
                        {p.cgmp_name}
                      </button>
                    </td>
                    <td>{p.cgmp_customer || '—'}</td>
                    <td>{p.cgmp_location || '—'}</td>
                    <td>{p.cgmp_region || '—'}</td>
                    <td>{p.cgmp_tower || '—'}</td>
                    <td>
                      {p.cgmp_primaryism
                        ? <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span>{p.cgmp_primaryism}</span>
                            <span title={`${ismCount} project${ismCount !== 1 ? 's' : ''} assigned to this ISM`}
                              style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 8,
                                background: ismCount > 10 ? 'var(--orange)' : 'var(--hover)',
                                color: ismCount > 10 ? 'white' : 'var(--text-secondary)' }}>
                              {ismCount}
                            </span>
                          </span>
                        : '—'}
                    </td>
                    <td>
                      {p.cgmp_techpoc ? (
                        <span className="proj-techpoc">
                          <span className="proj-techpoc__avatar">{p.cgmp_techpoc.charAt(0).toUpperCase()}</span>
                          {p.cgmp_techpoc}
                        </span>
                      ) : '—'}
                    </td>
                    <td>
                      <span className={`badge badge--status ${STATUS_CLASS[sc] ?? 'status-draft'}`}>
                        {PROJ_STATUS_OPTS.find(o => o.value === String(sc))?.label ?? 'Unknown'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn--xs btn--outline" onClick={() => openEdit(p)}>Edit</button>
                        <button className="btn btn--xs btn--outline" onClick={() => openClone(p)} title="Create a copy of this project as a new Draft">Clone</button>
                        <button className="btn btn--xs btn--danger-outline" onClick={() => { setDeleteTarget(p); setDeleteConfirmOpen(true); }}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Detail panel ── */}
      {!!detailProject && (
        <div className="module-detail-overlay" role="button" tabIndex={0} aria-label="Close" onClick={() => setDetailProject(null)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailProject(null); } }}>
          <div className="module-detail-panel proj-detail-panel" onClick={e => e.stopPropagation()}>
            <div className="module-detail-header">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {detailProject.cgmp_pidbnumber && (
                    <span className="proj-pidb proj-pidb--header">{detailProject.cgmp_pidbnumber}</span>
                  )}
                  <h2 className="module-detail-title">{detailProject.cgmp_name}</h2>
                </div>
                <span className={`badge badge--status ${STATUS_CLASS[detailProject.cgmp_status as unknown as number] ?? 'status-draft'}`}>
                  {PROJ_STATUS_OPTS.find(o => o.value === String(detailProject.cgmp_status as unknown as number))?.label}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <button className="btn btn--xs btn--outline" onClick={() => { openEdit(detailProject); setDetailProject(null); }}>Edit</button>
                <button className="slide-panel__close" onClick={() => setDetailProject(null)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
              </div>
            </div>

            <div className="module-detail-body">
              <div className="proj-detail-section">
                <div className="proj-detail-section__title">Basic Information</div>
                <DetailRow label="Client Name" value={detailProject.cgmp_customer} />
                <DetailRow label="Tower" value={detailProject.cgmp_tower} />
                <DetailRow label="Facility" value={detailProject.cgmp_facility} />
              </div>

              <div className="proj-detail-section">
                <div className="proj-detail-section__title">Location Details</div>
                <DetailRow label="Location" value={detailProject.cgmp_location} />
                <DetailRow label="Region" value={detailProject.cgmp_region} />
                <DetailRow label="Country" value={detailProject.cgmp_country} />
              </div>

              <div className="proj-detail-section">
                <div className="proj-detail-section__title">ISM & Technical POC</div>
                <DetailRow label="Primary ISM" value={detailProject.cgmp_primaryism} />
                <DetailRow label="Backup ISM" value={detailProject.cgmp_backupism} />
                {detailProject.cgmp_techpoc && (
                  <div className="proj-detail-row">
                    <span className="proj-detail-label">Tech POC</span>
                    <span className="proj-detail-value">
                      <span className="proj-techpoc">
                        <span className="proj-techpoc__avatar">{detailProject.cgmp_techpoc.charAt(0).toUpperCase()}</span>
                        {detailProject.cgmp_techpoc}
                      </span>
                    </span>
                  </div>
                )}
                <DetailRow label="Distribution List" value={detailProject.cgmp_distributionlist} />
              </div>

              <div className="proj-detail-section">
                <div className="proj-detail-section__title">Network Connectivity</div>
                <DualDetailRow label="Connectivity Type" primary={detailProject.cgmp_primaryconnectivity} secondary={detailProject.cgmp_secondaryconnectivity} />
                <DualDetailRow label="POP" primary={detailProject.cgmp_primarypop} secondary={detailProject.cgmp_secondarypop} />
                <DualDetailRow label="Link Provider" primary={detailProject.cgmp_primarylinkprovider} secondary={detailProject.cgmp_secondarylinkprovider} />
              </div>

              <div className="proj-detail-section">
                <div className="proj-detail-section__title">Telephony</div>
                <DualDetailRow label="Telephony Solution" primary={detailProject.cgmp_primarytelephony} secondary={detailProject.cgmp_secondarytelephony} />
              </div>

              {detailProject.cgmp_description && (
                <div className="proj-detail-section">
                  <div className="proj-detail-section__title">Description</div>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>{detailProject.cgmp_description}</p>
                </div>
              )}

              {detailProject.cgmp_ownershiphistory && (() => {
                try {
                  const history: any[] = JSON.parse(detailProject.cgmp_ownershiphistory);
                  if (!Array.isArray(history) || history.length === 0) return null;
                  const sorted = [...history].sort((a, b) =>
                    new Date(b.changedAt ?? 0).getTime() - new Date(a.changedAt ?? 0).getTime()
                  );
                  return (
                    <div className="proj-detail-section">
                      <div className="proj-detail-section__title">Project Audit Trail ({sorted.length})</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {sorted.map((h: any, i: number) => (
                          <div key={i} style={{ fontSize: 12, padding: '6px 10px', background: 'var(--surface-alt)', borderRadius: 4, borderLeft: `3px solid ${h._type === 'field_change' ? 'var(--primary)' : 'var(--orange)'}` }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              {h._type === 'field_change' && (
                                <span style={{ fontWeight: 600, color: 'var(--text-secondary)', minWidth: 110 }}>{h.field}</span>
                              )}
                              <span style={{ color: 'var(--danger)', textDecoration: 'line-through' }}>{h._type === 'field_change' ? h.before : h.from}</span>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                              <span style={{ color: 'var(--success)', fontWeight: 500 }}>{h._type === 'field_change' ? h.after : h.to}</span>
                            </div>
                            <div style={{ color: 'var(--text-tertiary)', fontSize: 11, marginTop: 2 }}>
                              {h.changedAt ? fmtDateTime(h.changedAt) : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                } catch { return null; }
              })()}

              {(() => {
                const count = changes.filter(c =>
                  c.cgmp_projectids?.split(',').map(s => s.trim()).includes(detailProject.cgmp_projectid)
                ).length;
                const handleViewChanges = () => {
                  if (count === 0) return;
                  try { localStorage.setItem('pmo-changelist-filters', JSON.stringify({ search: detailProject.cgmp_name ?? '', status: '', risk: '', category: '', dateRange: 'all' })); } catch { /* noop */ }
                  navigate('pmo');
                };
                return (
                  <div
                    style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', cursor: count > 0 ? 'pointer' : 'default' }}
                    onClick={handleViewChanges}
                    title={count > 0 ? `View ${count} change${count !== 1 ? 's' : ''} in PMO workspace` : undefined}
                  >
                    <div className="proj-info-label" style={{ marginBottom: 4 }}>Associated Changes</div>
                    <span style={{ fontSize: 22, fontWeight: 700, color: count > 0 ? 'var(--primary)' : 'var(--text-tertiary)' }}>{count}</span>
                    <span style={{ fontSize: 12, color: count > 0 ? 'var(--primary)' : 'var(--text-tertiary)', marginLeft: 6 }}>change{count !== 1 ? 's' : ''} linked{count > 0 ? ' — view in PMO ›' : ''}</span>
                  </div>
                );
              })()}

              {/* ── Project Health Score (#66) ── */}
              {(() => {
                const projChanges = changes.filter(c =>
                  c.cgmp_projectids?.split(',').map(s => s.trim()).includes(detailProject.cgmp_projectid)
                );
                if (projChanges.length === 0) return null;

                const completed = projChanges.filter(c => (c.cgmp_status as unknown as number) === 100000007).length;
                const failed    = projChanges.filter(c => (c.cgmp_status as unknown as number) === 100000008).length;
                const inProg    = projChanges.filter(c => [100000006, 100000002, 100000004].includes(c.cgmp_status as unknown as number)).length;

                // SLA % — changes that started on time (starttime ≤ endtime and not failed)
                const withDates = projChanges.filter(c => c.cgmp_starttime && c.cgmp_endtime);
                const slaOk     = withDates.filter(c => (c.cgmp_status as unknown as number) !== 100000008).length;
                const slaRate   = withDates.length > 0 ? Math.round((slaOk / withDates.length) * 100) : 100;

                // UAT % — released or completed
                const uatDone   = projChanges.filter(c => [100000003, 100000007].includes(c.cgmp_status as unknown as number)).length;
                const uatRate   = projChanges.length > 0 ? Math.round((uatDone / projChanges.length) * 100) : 0;

                // Concerns — version history entries with _type:'concern'
                let openConcerns = 0;
                projChanges.forEach(c => {
                  try {
                    const vh = JSON.parse(c.cgmp_versionhistory ?? '[]');
                    if (Array.isArray(vh)) openConcerns += vh.filter((e: {_type?: string; resolved?: boolean}) => e._type === 'concern' && !e.resolved).length;
                  } catch { /* noop */ }
                });

                // Aging — changes stuck in Published/UnderReview for >7 days
                const aging = projChanges.filter(c => {
                  if (![100000001, 100000002].includes(c.cgmp_status as unknown as number)) return false;
                  if (!c.cgmp_starttime) return false;
                  return Date.now() - new Date(c.cgmp_starttime).getTime() > 7 * 86400000;
                }).length;

                // Composite score (0-100): weighted average
                const score = Math.max(0, Math.round(
                  slaRate * 0.35 +
                  uatRate * 0.30 +
                  Math.max(0, 100 - openConcerns * 20) * 0.20 +
                  Math.max(0, 100 - aging * 15) * 0.15
                ));

                const scoreColor = score >= 80 ? 'var(--success)' : score >= 60 ? 'var(--orange)' : 'var(--danger)';
                const scoreLabel = score >= 80 ? 'Healthy' : score >= 60 ? 'At Risk' : 'Critical';

                return (
                  <div className="proj-detail-section" style={{ borderTop: `3px solid ${scoreColor}`, paddingTop: 12 }}>
                    <div className="proj-detail-section__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      Project Health Score
                      <span style={{ fontSize: 22, fontWeight: 800, color: scoreColor, marginLeft: 'auto' }}>{score}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: scoreColor, padding: '2px 8px', background: `${scoreColor}22`, borderRadius: 20 }}>{scoreLabel}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                      {[
                        { label: 'SLA Compliance', value: `${slaRate}%`, color: slaRate >= 80 ? 'var(--success)' : slaRate >= 60 ? 'var(--orange)' : 'var(--danger)' },
                        { label: 'UAT Completion', value: `${uatRate}%`, color: uatRate >= 80 ? 'var(--success)' : uatRate >= 60 ? 'var(--orange)' : 'var(--danger)' },
                        { label: 'Open Concerns',  value: openConcerns, color: openConcerns === 0 ? 'var(--success)' : openConcerns <= 2 ? 'var(--orange)' : 'var(--danger)' },
                        { label: 'Aging Changes',  value: aging,        color: aging === 0 ? 'var(--success)' : aging <= 1 ? 'var(--orange)' : 'var(--danger)' },
                      ].map(m => (
                        <div key={m.label} style={{ padding: '8px 12px', borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 2 }}>{m.label}</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: m.color }}>{m.value}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                      <span>In Progress: <b>{inProg}</b></span>
                      <span>Completed: <b style={{ color: 'var(--success)' }}>{completed}</b></span>
                      <span>Failed: <b style={{ color: 'var(--danger)' }}>{failed}</b></span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── Create / Edit form ── */}
      <SlidePanel
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editProject ? `Edit: ${editProject.cgmp_name}` : 'New Project'}
        subtitle={editProject ? `PIDB: ${editProject.cgmp_pidbnumber || '—'}` : 'Fill in project details'}
        width={640}
        footer={formFooter}
      >
        <div className="proj-form">

          <SectionHead title="Basic Information" />
          <div className="ff-row">
            <div className="ff-group">
              <label className="ff-label">PIDB No. <span className="ff-required">*</span></label>
              <input
                className={`ff-input ${formErrors.pidbnumber ? 'ff-input--error' : ''}`}
                value={form.pidbnumber}
                onChange={setField('pidbnumber')}
                placeholder="Unique PIDB number"
              />
              {formErrors.pidbnumber && <span className="ff-error">{formErrors.pidbnumber}</span>}
            </div>
            <div className="ff-group">
              <label className="ff-label">Status</label>
              <select className="ff-input ff-select" value={form.status} onChange={setField('status')}>
                {PROJ_STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div className="ff-group">
            <label className="ff-label">Project Name <span className="ff-required">*</span></label>
            <input
              className={`ff-input ${formErrors.name ? 'ff-input--error' : ''}`}
              value={form.name}
              onChange={setField('name')}
              placeholder="Enter project name"
            />
            {formErrors.name && <span className="ff-error">{formErrors.name}</span>}
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
              <select className="ff-input ff-select" value={form.primaryconnectivity} onChange={setField('primaryconnectivity')}>
                <option value="">— Select —</option>
                {toOpts(CONNECTIVITY_OPTIONS)}
              </select>
            </div>
            <div className="ff-group">
              <label className="ff-label">Secondary Connectivity Type</label>
              <select className="ff-input ff-select" value={form.secondaryconnectivity} onChange={setField('secondaryconnectivity')}>
                <option value="">— Select —</option>
                {toOpts(CONNECTIVITY_OPTIONS)}
              </select>
            </div>
          </div>

          <SectionHead title="POP Details" />
          <div className="ff-row">
            <div className="ff-group">
              <label className="ff-label">Primary POP</label>
              <select className="ff-input ff-select" value={form.primarypop} onChange={setField('primarypop')}>
                <option value="">— Select —</option>
                {toOpts(POP_OPTIONS)}
              </select>
            </div>
            <div className="ff-group">
              <label className="ff-label">Secondary POP</label>
              <select className="ff-input ff-select" value={form.secondarypop} onChange={setField('secondarypop')}>
                <option value="">— Select —</option>
                {toOpts(POP_OPTIONS)}
              </select>
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
              <UserPickerSelect
                users={systemUsers}
                loading={usersLoading}
                value={form.primaryism}
                onChange={name => setForm(prev => ({ ...prev, primaryism: name }))}
              />
              <span className="ff-hint">Lookup from O365 directory</span>
            </div>
            <div className="ff-group">
              <label className="ff-label">Backup ISM</label>
              <UserPickerSelect
                users={systemUsers}
                loading={usersLoading}
                value={form.backupism}
                onChange={name => setForm(prev => ({ ...prev, backupism: name }))}
              />
              <span className="ff-hint">Lookup from O365 directory</span>
            </div>
          </div>
          <div className="ff-group">
            <label className="ff-label">Tech POC</label>
            <UserPickerSelect
              users={systemUsers}
              loading={usersLoading}
              value={form.techpoc}
              onChange={name => setForm(prev => ({ ...prev, techpoc: name }))}
            />
            <span className="ff-hint">Lookup from O365 directory</span>
          </div>
          <div className="ff-group">
            <label className="ff-label">Distribution List</label>
            <input className="ff-input" value={form.distributionlist} onChange={setField('distributionlist')} placeholder="Email distribution list" />
          </div>

          <SectionHead title="Additional Information" />
          <div className="ff-group">
            <label className="ff-label">Description</label>
            <textarea className="ff-input ff-textarea" rows={3} value={form.description} onChange={setField('description')} placeholder="Project description, notes, or context" />
          </div>
        </div>
      </SlidePanel>

      {/* ── Delete confirm ── */}
      {deleteConfirmOpen && deleteTarget && (
        <div className="dialog-overlay" role="button" tabIndex={0} aria-label="Close" onClick={() => setDeleteConfirmOpen(false)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDeleteConfirmOpen(false); } }}>
          <div className="dialog" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="dialog__header">
              <h3 className="dialog__title">Delete Project</h3>
            </div>
            <div className="dialog__body">
              <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>
                Are you sure you want to delete <strong>{deleteTarget.cgmp_name}</strong>? This action cannot be undone.
              </p>
            </div>
            <div className="dialog__footer">
              <button className="btn btn--outline" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>Cancel</button>
              <button className="btn btn--danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Project Import (#62) */}
      <Dialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import Projects from CSV"
        maxWidth={780}
      >
        {importStep === 'upload' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 0' }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
              Upload a CSV file to bulk-import projects. Download the template below to see the expected columns and format.
            </p>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn btn--outline btn--sm" onClick={() => {
                const blob = new Blob([PROJ_CSV_TEMPLATE], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = 'project-import-template.csv'; a.click(); URL.revokeObjectURL(url);
              }}>Download Template</button>
              <input ref={importFileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleImportFile} />
              <button className="btn btn--primary btn--sm" onClick={() => importFileRef.current?.click()}>Upload CSV File</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', background: 'var(--surface)', borderRadius: 6, padding: '8px 12px' }}>
              <strong>Required columns:</strong> Name, PIDNumber &nbsp;|&nbsp; <strong>Optional:</strong> Status, Customer, Tower, ISM, BackupISM, Region, Country, Facility, TechPOC, Description
            </div>
          </div>
        )}

        {importStep === 'preview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {importRows.filter(r => r.valid).length} of {importRows.length} rows valid
              </span>
              <button className="btn btn--outline btn--sm" onClick={() => { setImportStep('upload'); setImportRows([]); }}>← Re-upload</button>
              <button className="btn btn--primary btn--sm" style={{ marginLeft: 'auto' }} disabled={importRows.filter(r => r.valid).length === 0} onClick={doImport}>
                Import {importRows.filter(r => r.valid).length} Projects
              </button>
            </div>
            <div style={{ maxHeight: 340, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--surface-alt)', position: 'sticky', top: 0 }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Status</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Name</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>PIDNumber</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Customer</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>ISM</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {importRows.map((row, i) => (
                    <tr key={i} style={{ background: row.valid ? undefined : '#fff1f0', borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '5px 8px' }}>
                        {row.valid ? <span style={{ color: 'var(--success)', fontWeight: 600 }}>✓</span> : <span style={{ color: 'var(--danger)', fontWeight: 600 }}>✗</span>}
                      </td>
                      <td style={{ padding: '5px 8px' }}>{row.raw.Name || '—'}</td>
                      <td style={{ padding: '5px 8px' }}>{row.raw.PIDNumber || '—'}</td>
                      <td style={{ padding: '5px 8px' }}>{row.raw.Customer || '—'}</td>
                      <td style={{ padding: '5px 8px' }}>{row.raw.ISM || '—'}</td>
                      <td style={{ padding: '5px 8px', color: 'var(--danger)', fontSize: 11 }}>{row.errors.join('; ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {importStep === 'importing' && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
            Importing projects, please wait…
          </div>
        )}

        {importStep === 'done' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 0', textAlign: 'center' }}>
            <div style={{ fontSize: 32 }}>{importResults.failed === 0 ? '✅' : '⚠️'}</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Import Complete</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              <span style={{ color: 'var(--success)' }}>{importResults.ok} succeeded</span>
              {importResults.failed > 0 && <span style={{ color: 'var(--danger)', marginLeft: 12 }}>{importResults.failed} failed</span>}
            </div>
            <button className="btn btn--primary" onClick={() => setImportOpen(false)}>Done</button>
          </div>
        )}
      </Dialog>
    </div>
  );
}
