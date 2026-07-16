import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ProjectMultiSelect } from '../ui/ProjectMultiSelect';
import { SlidePanel } from '../ui/Modal';
import ConfirmDialog from '../ui/ConfirmDialog';
import AttachmentPanel from '../ui/AttachmentPanel';
import { Field, Input, Textarea, Select, DateTimeInput, Toggle, FormRow, FormSection } from '../ui/FormFields';
import { UserPickerSelect } from '../ui/UserPickerSelect';
import { useApp } from '../../context/AppContext';
import {
  Cgmp_changesService,
  Cgmp_auditlogsService,
  Cre09_knowledgebasearticlesService,
  Cgmp_blackoutperiodsService,
  Cgmp_notificationsService,
  Cgmp_changehistoryService,
} from '../../generated';
import type { Cgmp_blackoutperiods } from '../../generated/models/Cgmp_blackoutperiodsModel';
import type { Cgmp_changetemplates } from '../../generated/models/Cgmp_changetemplatesModel';
import type { Cre09_knowledgebasearticles } from '../../generated/models/Cre09_knowledgebasearticlesModel';
import type { Cgmp_changes } from '../../generated/models/Cgmp_changesModel';
import type { Cgmp_changesBase } from '../../generated/models/Cgmp_changesModel';
import type {
  Cgmp_changescgmp_changetype,
  Cgmp_changescgmp_impactlevel,
} from '../../generated/models/Cgmp_changesModel';
import type { Cgmp_auditlogsBase } from '../../generated/models/Cgmp_auditlogsModel';
import {
  asStatus,
  asRisk,
  asCategory,
  asAuditEventType,
  asAuditEntityType,
  asNotifCategory,
  asNotifPriority,
} from '../../utils/optionSets';
import { CATEGORY_OPTIONS, CHANGE_TYPE_OPTIONS, RISK_OPTIONS, IMPACT_OPTIONS } from './options';
import { VersionHistory } from './VersionHistory';
import type { HistoryEntry } from './VersionHistory';
import { CommentsSection } from './CommentsSection';
import { parseDatetimeLocal, getBrowserInfo, fmtDateTime, getDisplayTimezone } from '../../utils/format';
import { trackAppEvent, trackAppException } from '../../utils/appInsights';
import { getQuietHoursSnoozedUntil, isNotifCategoryEnabled } from '../../utils/notifications';
import { getAllowedTransitions, STATUS } from '../../utils/roles';
import {
  statusLabel,
  riskLabel,
  useProjects,
  useSystemUsers,
  useChangeList,
  useAllUserProfiles,
} from '../../hooks/useDataverse';

function impactLabel(code: number): string {
  return IMPACT_OPTIONS.find((o) => o.value === String(code))?.label ?? String(code);
}

/* ── G2-19: XOR obfuscation for localStorage draft ── */
function obfuscate(data: string, key: string): string {
  const keyBytes = Array.from(key).map((c) => c.charCodeAt(0));
  return Array.from(data)
    .map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ keyBytes[i % keyBytes.length]))
    .join('');
}

function deobfuscate(data: string, key: string): string {
  return obfuscate(data, key); // XOR is its own inverse
}

export type FormMode = 'create' | 'edit' | 'view';

interface FormState {
  title: string;
  changenumber: string;
  owner: string;
  changepoc: string;
  status: string;
  category: string;
  changetype: string;
  risklevel: string;
  impactlevel: string;
  starttime: string;
  endtime: string;
  isemergency: boolean;
  isweekend: boolean;
  uatrequired: boolean;
  description: string;
  timeline: string;
  location: string;
  region: string;
  country: string;
  facility: string;
  projectids: string;
  pirnotes: string;
  parentchangeid: string;
  parentChangenumber: string;
  closureremarks: string;
}

function toDatetimeLocal(iso: string | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toISOString().slice(0, 16);
  } catch {
    return '';
  }
}

function blankForm(): FormState {
  return {
    title: '',
    changenumber: '',
    owner: '',
    changepoc: '',
    status: '100000000',
    category: '',
    changetype: '',
    risklevel: '',
    impactlevel: '',
    starttime: '',
    endtime: '',
    isemergency: false,
    isweekend: false,
    uatrequired: false,
    description: '',
    timeline: '',
    location: '',
    region: '',
    country: '',
    facility: '',
    projectids: '',
    pirnotes: '',
    parentchangeid: '',
    parentChangenumber: '',
    closureremarks: '',
  };
}

function fromChange(c: Cgmp_changes): FormState {
  return {
    title: c.cgmp_title ?? '',
    changenumber: c.cgmp_changenumber ?? '',
    owner: c.cgmp_createdby ?? c.owneridname ?? '',
    changepoc: (c as any).cgmp_changepoc ?? '', // cgmp_changepoc absent from generated type
    status: String(c.cgmp_status as unknown as number), // option-set bridge cast — generated type is opaque
    category: String(c.cgmp_category as unknown as number), // option-set bridge cast
    changetype: String(c.cgmp_changetype as unknown as number), // option-set bridge cast
    risklevel: String(c.cgmp_risklevel as unknown as number), // option-set bridge cast
    impactlevel: String(c.cgmp_impactlevel as unknown as number), // option-set bridge cast
    starttime: toDatetimeLocal(c.cgmp_starttime),
    endtime: toDatetimeLocal(c.cgmp_endtime),
    isemergency: c.cgmp_isemergency ?? false,
    isweekend: c.cgmp_isweekend ?? false,
    uatrequired: (c as any).cgmp_uatrequired ?? false, // cgmp_uatrequired absent from generated type
    description: c.cgmp_description ?? '',
    timeline: c.cgmp_timeline ?? '',
    location: c.cgmp_location ?? '',
    region: c.cgmp_region ?? '',
    country: c.cgmp_country ?? '',
    facility: c.cgmp_facility ?? '',
    projectids: c.cgmp_projectids ?? '',
    pirnotes: c.cgmp_pirnotes ?? '',
    parentchangeid: c.cgmp_parentchangeid ?? '',
    parentChangenumber: '', // UI-only text input; GUID resolved from parentchangeid
    closureremarks: c.cgmp_closureremarks ?? '',
  };
}

function validate(form: FormState, editChange?: Cgmp_changes): Record<string, string> {
  const e: Record<string, string> = {};
  if (!form.changenumber.trim()) e.changenumber = 'Change number is required';
  if (!form.title.trim()) e.title = 'Title is required';
  if (!form.category) e.category = 'Category is required';
  if (!form.changetype) e.changetype = 'Change type is required';
  if (!form.risklevel) e.risklevel = 'Risk level is required';
  if (!form.impactlevel) e.impactlevel = 'Impact level is required';
  if (!form.starttime) e.starttime = 'Start time is required';
  if (!form.endtime) e.endtime = 'End time is required';
  if (form.starttime && form.endtime && form.starttime >= form.endtime) e.endtime = 'End time must be after start time';
  if (!editChange && form.starttime) {
    const d = parseDatetimeLocal(form.starttime);
    if (d && d <= new Date()) {
      e.starttime = 'Start time must be in the future for new changes';
    }
  }
  return e;
}

/* ── Read-only field for view mode ── */
function ReadField({ label, value }: { label: string; value: string | boolean | undefined }) {
  const display = value === true ? 'Yes' : value === false ? 'No' : (value ?? '—');
  return (
    <div className="view-field">
      <span className="view-field__label">{label}</span>
      <span className="view-field__value">{String(display) || '—'}</span>
    </div>
  );
}

function HelpTip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle', marginLeft: 4 }}>
      <button
        type="button"
        className="help-tip-btn"
        onClick={() => setShow((s) => !s)}
        aria-label="Help"
        aria-expanded={show}
      >
        ?
      </button>
      {show && (
        <div className="help-tip-popover" role="tooltip">
          {text}
          <button type="button" className="help-tip-close" onClick={() => setShow(false)} aria-label="Close help">
            ×
          </button>
        </div>
      )}
    </span>
  );
}

/* ── Related KB Articles (#84) ── */
function RelatedKBArticles({ changeId, categoryCode }: { changeId: string; categoryCode: number | undefined }) {
  const [articles, setArticles] = useState<Cre09_knowledgebasearticles[]>([]);
  const [loaded, setLoaded] = useState(false);

  const catLabel = useMemo(() => {
    return CATEGORY_OPTIONS.find((o) => o.value === String(categoryCode))?.label?.toLowerCase() ?? '';
  }, [categoryCode]);

  useEffect(() => {
    let cancelled = false;
    Cre09_knowledgebasearticlesService.getAll({ top: 100, filter: 'cre09_cgmp_ispublished eq true' })
      .then((res) => {
        if (cancelled) return;
        const all = res.data ?? [];
        const matched = all.filter((a) => {
          if (a.cre09_cgmp_relatedchangeid === changeId) return true;
          if (!catLabel) return false;
          const tags = (a.cre09_cgmp_tags ?? '').toLowerCase();
          return tags
            .split(',')
            .map((t) => t.trim())
            .some((t) => t === catLabel || t.includes(catLabel));
        });
        setArticles(matched);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [changeId, catLabel]);

  if (!loaded || articles.length === 0) return null;

  const CAT_LABEL: Record<number, string> = {
    100000000: 'SOP',
    100000001: 'FAQ',
    100000002: 'Troubleshooting',
    100000003: 'Runbook',
    100000004: 'Lessons Learned',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {articles.map((a) => (
        <div
          key={a.cre09_knowledgebasearticleid}
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
              {a.cre09_cgmp_title ?? '—'}
            </span>
            {a.cre09_cgmp_category != null && (
              <span className="status-badge status-published" style={{ fontSize: 11 }}>
                {CAT_LABEL[a.cre09_cgmp_category as unknown as number] ?? 'Article'}
              </span>
            )}
          </div>
          {a.cre09_cgmp_tags && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {a.cre09_cgmp_tags
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
                .map((t) => (
                  <span
                    key={t}
                    style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 10,
                      background: 'var(--primary-light)',
                      color: 'var(--primary)',
                    }}
                  >
                    {t}
                  </span>
                ))}
            </div>
          )}
          {a.cre09_cgmp_authorname && (
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>By {a.cre09_cgmp_authorname}</span>
          )}
        </div>
      ))}
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  mode: FormMode;
  change?: Cgmp_changes;
  onSaved: () => void;
  initialTemplate?: Cgmp_changetemplates;
}

export default function ChangeForm({ open, onClose, mode, change, onSaved, initialTemplate }: Props) {
  const { showToast, userProfile, currentUserName, currentUserUpn, setNavigationGuard } = useApp();
  const { projects } = useProjects();
  const { users: systemUsers, loading: usersLoading } = useSystemUsers();
  const { changes: allChanges } = useChangeList();
  const { profiles: allProfiles } = useAllUserProfiles();
  const [form, setForm] = useState<FormState>(blankForm);
  const [reschedWorking, setReschedWorking] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [validationSummary, setValidationSummary] = useState('');
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [autoSavedAt, setAutoSavedAt] = useState<Date | null>(null);
  const [draftRestoreVisible, setDraftRestoreVisible] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [concurrentEditor, setConcurrentEditor] = useState<string | null>(null);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [navGuardOpen, setNavGuardOpen] = useState(false);
  const [blackoutConfirmOpen, setBlackoutConfirmOpen] = useState(false);
  const blackoutConfirmResolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  const [blackoutPeriods, setBlackoutPeriods] = useState<Cgmp_blackoutperiods[]>([]);
  useEffect(() => {
    Cgmp_blackoutperiodsService.getAll({ top: 100 })
      .then((r) => setBlackoutPeriods(r.data ?? []))
      .catch((err) => {
        if (import.meta.env.DEV) console.error('Background operation failed:', err);
      });
  }, []);

  const draftKey = currentUserUpn ? `cgmp-create-draft-${currentUserUpn}` : null;

  /* Check for existing draft when opening in create mode */
  useEffect(() => {
    if (!open || mode !== 'create' || !draftKey) return;
    try {
      const rawStored = localStorage.getItem(draftKey);
      if (rawStored) {
        let saved: { form: FormState; versionHistory?: string; savedAt: number } | null = null;
        try {
          const obfKey = currentUserUpn || 'cgmp-default';
          saved = JSON.parse(deobfuscate(rawStored, obfKey)) as {
            form: FormState;
            versionHistory?: string;
            savedAt: number;
          };
        } catch {
          // Stale or plain-text entry from before obfuscation — clear it
          localStorage.removeItem(draftKey);
          return;
        }
        if (!saved?.form) return;
        if (!saved.savedAt || Date.now() - saved.savedAt > 86_400_000) {
          localStorage.removeItem(draftKey);
          return;
        }
        setDraftSavedAt(new Date(saved.savedAt).toISOString());
        setDraftRestoreVisible(true);
      }
    } catch {}
  }, [open, mode, draftKey, currentUserUpn]);

  /* Auto-save draft every 30s in create mode */
  useEffect(() => {
    if (!open || mode !== 'create' || !draftKey) return;
    const id = setInterval(() => {
      try {
        const draftPayload = JSON.stringify({ form, versionHistory: '[]', savedAt: Date.now() });
        const obfKey = currentUserUpn || 'cgmp-default';
        localStorage.setItem(draftKey, obfuscate(draftPayload, obfKey));
      } catch {}
    }, 30000);
    return () => clearInterval(id);
  }, [open, mode, form, draftKey, currentUserUpn]);

  const blackoutWarning = useMemo(() => {
    if (!form.starttime && !form.endtime) return null;
    const start = form.starttime ? new Date(form.starttime) : null;
    const end = form.endtime ? new Date(form.endtime) : null;
    return (
      blackoutPeriods.find((bp) => {
        const bpStart = bp.cgmp_startdate ? new Date(bp.cgmp_startdate) : null;
        const bpEnd = bp.cgmp_enddate ? new Date(bp.cgmp_enddate) : null;
        if (!bpStart || !bpEnd) return false;
        const sOverlap = start && start <= bpEnd && start >= bpStart;
        const eOverlap = end && end <= bpEnd && end >= bpStart;
        const spansBlackout = start && end && start <= bpStart && end >= bpEnd;
        return sOverlap || eOverlap || spansBlackout;
      }) ?? null
    );
  }, [form.starttime, form.endtime, blackoutPeriods]);

  const [parentSearch, setParentSearch] = useState('');
  const parentOpts = useMemo(() => {
    const q = parentSearch.toLowerCase();
    return allChanges
      .filter((c) => c.cgmp_changeid !== change?.cgmp_changeid)
      .filter((c) => !q || c.cgmp_changenumber?.toLowerCase().includes(q) || c.cgmp_title?.toLowerCase().includes(q))
      .slice(0, 20);
  }, [allChanges, parentSearch, change?.cgmp_changeid]);

  const _autoSaveFormRef = useRef(form);
  _autoSaveFormRef.current = form;
  const _autoSaveChangeRef = useRef(change);
  _autoSaveChangeRef.current = change;

  /* ── Derive dropdown options from project repo ── */
  const { regionOptions, locationOptions, facilityOptions, regionToCountries } = useMemo(() => {
    const regions = new Set<string>();
    const locations = new Set<string>();
    const facilities = new Set<string>();
    const rToC = new Map<string, Set<string>>();

    for (const p of projects) {
      if (p.cgmp_region) {
        regions.add(p.cgmp_region);
        if (p.cgmp_country) {
          if (!rToC.has(p.cgmp_region)) rToC.set(p.cgmp_region, new Set());
          rToC.get(p.cgmp_region)!.add(p.cgmp_country);
        }
      }
      if (p.cgmp_location) locations.add(p.cgmp_location);
      if (p.cgmp_facility) facilities.add(p.cgmp_facility);
    }

    return {
      regionOptions: [...regions].sort().map((r) => ({ value: r, label: r })),
      locationOptions: [...locations].sort().map((l) => ({ value: l, label: l })),
      facilityOptions: [...facilities].sort().map((f) => ({ value: f, label: f })),
      regionToCountries: rToC,
    };
  }, [projects]);

  const countryOptions = useMemo(() => {
    const selectedRegions = form.region.split(',').filter(Boolean);
    if (selectedRegions.length === 0) return [];
    const countries = new Set<string>();
    selectedRegions.forEach((r) => {
      const rc = regionToCountries.get(r);
      if (rc) rc.forEach((c) => countries.add(c));
    });
    return [...countries].sort().map((c) => ({ value: c, label: c }));
  }, [form.region, regionToCountries]);

  const schedulingConflicts = useMemo(() => {
    if (!form.starttime || !form.endtime || !form.location) return [];
    const formStart = new Date(form.starttime).getTime();
    const formEnd = new Date(form.endtime).getTime();
    if (isNaN(formStart) || isNaN(formEnd) || formEnd <= formStart) return [];
    const formLocs = form.location
      .split(',')
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean);
    const INACTIVE_STATUSES = new Set([100000000, 100000007, 100000008, 100000009]); // Draft, Completed, Failed, Closed
    return allChanges.filter((c) => {
      if (c.cgmp_changeid === change?.cgmp_changeid) return false;
      const s = c.cgmp_status as unknown as number;
      if (INACTIVE_STATUSES.has(s)) return false;
      if (!c.cgmp_starttime || !c.cgmp_endtime) return false;
      const cStart = new Date(c.cgmp_starttime).getTime();
      const cEnd = new Date(c.cgmp_endtime).getTime();
      if (cEnd <= formStart || cStart >= formEnd) return false;
      const cLocs = (c.cgmp_location ?? '')
        .split(',')
        .map((l) => l.trim().toLowerCase())
        .filter(Boolean);
      return cLocs.some((l) => formLocs.includes(l));
    });
  }, [form.starttime, form.endtime, form.location, allChanges, change?.cgmp_changeid]);

  useEffect(() => {
    if (!open) return;
    if (mode === 'create') {
      if (change) {
        // Clone scenario: copy fields from the source change but generate a provisional change number.
        // The original change number must not be reused; a placeholder is generated so the user
        // can update it before saving. Async beforeunload writes are intentionally avoided here —
        // audit logs are event-driven on explicit save, not on page close. (F-016)
        const timestamp = Date.now().toString(36).toUpperCase();
        const cloneNumber = `CHG-CLONE-${timestamp}`;
        const cloned = fromChange(change);
        cloned.changenumber = cloneNumber;
        cloned.status = '100000000'; // Always start cloned changes as Draft
        setForm(cloned);
        showToast('info', 'Change cloned — please update the change number before saving.');
      } else {
        const base = blankForm();
        if (initialTemplate) {
          base.category = initialTemplate.cgmp_category ?? '';
          base.changetype = initialTemplate.cgmp_changetype ?? '';
          base.risklevel = initialTemplate.cgmp_risklevel != null ? String(initialTemplate.cgmp_risklevel) : '';
          base.impactlevel = initialTemplate.cgmp_impactlevel != null ? String(initialTemplate.cgmp_impactlevel) : '';
          base.location = initialTemplate.cgmp_location ?? '';
          base.region = initialTemplate.cgmp_region ?? '';
          base.country = initialTemplate.cgmp_country ?? '';
          base.description = initialTemplate.cgmp_description ?? '';
          base.timeline = initialTemplate.cgmp_timeline ?? '';
          base.uatrequired = initialTemplate.cgmp_uatrequired ?? false;
          base.isemergency = initialTemplate.cgmp_isemergency ?? false;
        }
        setForm(base);
      }
    } else if (change) {
      setForm(fromChange(change));
    }
    setErrors({});
    setValidationSummary('');
    setIsDirty(false);
  }, [open, mode, change, initialTemplate]);

  /* ── Concurrent edit detection ── */
  useEffect(() => {
    if (!open || mode !== 'edit' || !change?.cgmp_changeid) return;
    setConcurrentEditor(null);

    const checkAndLock = async () => {
      try {
        // Check for recent "EditOpen" audit logs for this change (last 10 min)
        const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const r = await Cgmp_auditlogsService.getAll({
          filter: `cgmp_entityid eq '${change.cgmp_changeid}' and cgmp_eventtype eq 100000003 and createdon ge ${tenMinAgo}`,
          top: 5,
          orderBy: ['createdon desc'],
        });
        const recent = (r.data ?? []).filter((log) => {
          if (!log.cgmp_newvalues) return false;
          try {
            const parsed = JSON.parse(log.cgmp_newvalues) as { editedBy?: string };
            return parsed.editedBy && parsed.editedBy !== currentUserName;
          } catch {
            return false;
          }
        });
        if (recent.length > 0) {
          try {
            const parsed = JSON.parse(recent[0].cgmp_newvalues ?? '{}') as { editedBy?: string };
            setConcurrentEditor(parsed.editedBy ?? 'Another user');
          } catch {
            setConcurrentEditor('Another user');
          }
        }
        // Log that current user opened it
        Cgmp_auditlogsService.create({
          cgmp_auditlogname: `EditOpen: ${change.cgmp_changenumber}`,
          cgmp_entitytype: asAuditEntityType(100000000),
          cgmp_eventtype: asAuditEventType(100000003),
          cgmp_entityid: change.cgmp_changeid,
          cgmp_entityname: change.cgmp_changenumber,
          cgmp_username: currentUserName,
          cgmp_useremail: currentUserUpn,
          cgmp_ipaddress: getBrowserInfo(),
          cgmp_newvalues: JSON.stringify({ editedBy: currentUserName, openedAt: new Date().toISOString() }),
        } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch((err) => {
          if (import.meta.env.DEV) console.error('Audit log failed:', err);
        }); // SDK requires typed cast
      } catch {
        /* non-fatal */
      }
    };

    checkAndLock();
  }, [open, mode, change?.cgmp_changeid, currentUserName]);

  const set = useCallback(
    (key: keyof FormState, value: string | boolean) => {
      setForm((prev) => {
        const next = { ...prev, [key]: value };
        /* Remove countries no longer valid when region selection changes */
        if (key === 'region' && typeof value === 'string') {
          const selectedRegions = value.split(',').filter(Boolean);
          const available = new Set<string>();
          selectedRegions.forEach((r) => {
            const rc = regionToCountries.get(r);
            if (rc) rc.forEach((c) => available.add(c));
          });
          if (available.size > 0) {
            const validCountries = prev.country
              .split(',')
              .filter(Boolean)
              .filter((c) => available.has(c));
            next.country = validCountries.join(',');
          }
        }
        return next;
      });
      setErrors((prev) => {
        const n = { ...prev };
        delete n[key];
        return n;
      });
      setIsDirty(true);
    },
    [regionToCountries]
  );

  const handleClose = useCallback(() => {
    if (isDirty) {
      setDiscardConfirm(true);
      return;
    }
    onClose();
  }, [isDirty, onClose]);

  const handleSave = useCallback(async () => {
    // Defense-in-depth: Observer role (100000005) must never mutate data.
    // The UI already hides the Save button for Observers; this guard is a
    // programmatic backstop in case the button is somehow reached.
    if ((userProfile?.cgmp_role as unknown as number) === 100000005) return;
    const errs = validate(form, change);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      const errCount = Object.keys(errs).length;
      setValidationSummary(
        `Form has ${errCount} error${errCount !== 1 ? 's' : ''}. Please review the highlighted fields.`
      );
      const fieldIdMap: Record<string, string> = {
        title: 'cf-title',
        changenumber: 'cf-chgnum',
        category: 'cf-cat',
        changetype: 'cf-type',
        risklevel: 'cf-risk',
        impactlevel: 'cf-impact',
        starttime: 'cf-start',
        endtime: 'cf-end',
      };
      const firstErrorId = fieldIdMap[Object.keys(errs)[0]] ?? Object.keys(errs)[0];
      setTimeout(() => {
        const firstInvalid = document.querySelector(`[id="${firstErrorId}"]`) as HTMLElement | null;
        firstInvalid?.focus();
      }, 50);
      return;
    }
    setValidationSummary('');

    /* Blackout period gate: non-emergency changes need confirmation */
    if (blackoutWarning && !form.isemergency) {
      const confirmed = await new Promise<boolean>((resolve) => {
        blackoutConfirmResolveRef.current = resolve;
        setBlackoutConfirmOpen(true);
      });
      if (!confirmed) return;
    }

    setSaving(true);
    try {
      const base = {
        cgmp_title: form.title.trim(),
        cgmp_changenumber: form.changenumber.trim(),
        cgmp_createdby: form.owner.trim() || undefined,
        cgmp_changepoc: form.changepoc.trim() || undefined,
        cgmp_category: asCategory(Number(form.category)),
        cgmp_changetype: Number(form.changetype) as unknown as Cgmp_changescgmp_changetype, // no asChangeType helper in optionSets
        cgmp_risklevel: asRisk(Number(form.risklevel)),
        cgmp_impactlevel: Number(form.impactlevel) as unknown as Cgmp_changescgmp_impactlevel, // no asImpactLevel helper in optionSets
        cgmp_starttime: new Date(form.starttime).toISOString(),
        cgmp_endtime: new Date(form.endtime).toISOString(),
        cgmp_isemergency: form.isemergency,
        cgmp_isweekend: form.isweekend,
        cgmp_uatrequired: form.uatrequired,
        cgmp_description: form.description || undefined,
        cgmp_timeline: form.timeline || undefined,
        cgmp_location: form.location || undefined,
        cgmp_region: form.region || undefined,
        cgmp_country: form.country || undefined,
        cgmp_facility: form.facility || undefined,
        cgmp_projectids: form.projectids || undefined,
        cgmp_pirnotes: form.pirnotes || undefined,
        cgmp_parentchangeid:
          form.parentchangeid ||
          (form.parentChangenumber
            ? allChanges.find((c) => c.cgmp_changenumber === form.parentChangenumber)?.cgmp_changeid
            : undefined) ||
          undefined,
        cgmp_closureremarks: form.closureremarks || undefined,
      } as any; // SDK requires partial type bypass — option-set fields conflict with generated types

      if (mode === 'create') {
        const result = await Cgmp_changesService.create({
          ...base,
          cgmp_status: asStatus(100000000),
        } as unknown as Omit<Cgmp_changesBase, 'cgmp_changeid'>); // SDK requires typed cast
        if (!result.success) throw result.error ?? new Error('Failed to create change');
        const created = result.data as Cgmp_changes | undefined;
        if (created?.cgmp_changeid) {
          Cgmp_auditlogsService.create({
            cgmp_auditlogname: `${form.changenumber} Created`,
            cgmp_entitytype: asAuditEntityType(100000000),
            cgmp_eventtype: asAuditEventType(100000002),
            cgmp_entityid: created.cgmp_changeid,
            cgmp_entityname: form.changenumber,
            cgmp_username: currentUserName,
            cgmp_useremail: currentUserUpn,
            cgmp_ipaddress: getBrowserInfo(),
            cgmp_newvalues: JSON.stringify({ title: form.title, status: 'Draft' }),
          } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch((err) => {
            if (import.meta.env.DEV) console.error('Audit log failed:', err);
          }); // SDK requires typed cast
          Cgmp_changehistoryService.create({
            cgmp_actor: currentUserUpn ?? currentUserName ?? '',
            cgmp_changeid: created.cgmp_changeid,
            cgmp_eventtype: 'ChangeCreated',
            cgmp_details: JSON.stringify({
              action: 'created',
              changedFields: (Object.keys(form) as (keyof FormState)[]).filter((k) => !!form[k]),
            }),
            cgmp_timestamp: new Date().toISOString(),
          } as any).catch(() => {}); // SDK requires untyped cast — no generated type available for changehistory
        }
        try {
          if (draftKey) localStorage.removeItem(draftKey);
        } catch {}
        setDraftRestoreVisible(false);
        showToast('success', `Change ${form.changenumber} created`);
        // G2-8: track change creation
        if (created?.cgmp_changeid) {
          trackAppEvent('change.created', { changeId: created.cgmp_changeid, category: form.category });
        }
      } else if (mode === 'edit' && change) {
        const prevFormState = fromChange(change);
        const prevSnap = { title: change.cgmp_title, status: change.cgmp_statusname };
        // Re-fetch latest history to avoid overwriting concurrent edits
        const latestChange = await Cgmp_changesService.get(change.cgmp_changeid, {
          select: ['cgmp_versionhistory'] as any,
        });
        const prevHistory = JSON.parse(
          latestChange.data?.cgmp_versionhistory ?? change.cgmp_versionhistory ?? '[]'
        ) as object[];
        const newHistory = [
          ...prevHistory,
          {
            timestamp: new Date().toISOString(),
            previousValues: prevSnap,
          },
        ];
        // If the change was previously Released or further, editing revokes IT Ops approval
        // and moves it back to Published (requires re-review)
        const originalStatus = change.cgmp_status as unknown as number;
        const isPostRelease = originalStatus >= STATUS.Released;
        const effectiveStatus = isPostRelease ? STATUS.Published : Number(form.status);

        // Track actualstarttime when transitioning to InProgress
        if (effectiveStatus === STATUS.InProgress) {
          (base as Record<string, unknown>).cgmp_actualstarttime = new Date().toISOString();
        }

        // Append MTTR entry when closing/completing a change that has an actual start time
        if (
          (effectiveStatus === STATUS.Closed || effectiveStatus === STATUS.Completed) &&
          change.cgmp_actualstarttime
        ) {
          const mttrMinutes = Math.round((Date.now() - new Date(change.cgmp_actualstarttime).getTime()) / 60000);
          newHistory.push({ _type: 'mttr', minutes: mttrMinutes, at: new Date().toISOString() });
        }

        const updatePayload: Record<string, unknown> = {
          ...base,
          cgmp_status: asStatus(effectiveStatus),
          cgmp_versionhistory: JSON.stringify(newHistory),
        };

        if (isPostRelease) {
          // Clear previous approval — IT Ops must re-approve
          updatePayload.cgmp_reviewedby = null;
          updatePayload.cgmp_reviewedat = null;
          updatePayload.cgmp_reviewnotes = null;
        }

        const updateResult = await Cgmp_changesService.update(
          change.cgmp_changeid,
          updatePayload as Parameters<typeof Cgmp_changesService.update>[1]
        );
        if (!updateResult.success) throw updateResult.error ?? new Error('Failed to update change');
        Cgmp_auditlogsService.create({
          cgmp_auditlogname: `${form.changenumber} Updated`,
          cgmp_entitytype: asAuditEntityType(100000000),
          cgmp_eventtype: asAuditEventType(100000003),
          cgmp_entityid: change.cgmp_changeid,
          cgmp_entityname: form.changenumber,
          cgmp_username: currentUserName,
          cgmp_useremail: currentUserUpn,
          cgmp_ipaddress: getBrowserInfo(),
          cgmp_previousvalues: JSON.stringify(prevSnap),
          cgmp_newvalues: JSON.stringify({
            title: form.title,
            status: isPostRelease ? 'Published (Re-Review Required)' : form.status,
          }),
        } as unknown as Omit<Cgmp_auditlogsBase, 'cgmp_auditlogid'>).catch((err) => {
          if (import.meta.env.DEV) console.error('Audit log failed:', err);
        }); // SDK requires typed cast
        showToast(
          'success',
          isPostRelease
            ? `Change ${form.changenumber} updated — returned to review queue (approval revoked)`
            : `Change ${form.changenumber} updated`
        );

        const changedFields = (Object.keys(form) as (keyof FormState)[]).filter(
          (k) => String(form[k]) !== String(prevFormState[k])
        );
        Cgmp_changehistoryService.create({
          cgmp_actor: currentUserUpn ?? currentUserName ?? '',
          cgmp_changeid: change.cgmp_changeid,
          cgmp_eventtype: 'ChangeUpdated',
          cgmp_details: JSON.stringify({ action: 'updated', changedFields }),
          cgmp_timestamp: new Date().toISOString(),
        } as any).catch(() => {}); // SDK requires untyped cast — no generated type available for changehistory

        // Notify Admins when an emergency change is published
        if (form.isemergency && effectiveStatus === STATUS.Published) {
          allProfiles
            .filter((p: any) => (p.cgmp_role as unknown as number) === 100000000)
            .forEach((admin: any) => {
              // G2-7: skip if admin opted out of Emergency notifications
              if (!isNotifCategoryEnabled(admin.cgmp_notificationcategories, 100000005)) return;
              // G2-6: apply quiet-hours snooze when admin is in their quiet window
              const snoozedUntil = getQuietHoursSnoozedUntil(admin.cgmp_quiethoursstart, admin.cgmp_quiethoursend);
              Cgmp_notificationsService.create({
                cgmp_title: `Emergency Change Published: ${form.changenumber}`,
                cgmp_message: `Emergency change ${form.changenumber} — ${form.title} has been published and requires immediate attention. 240-minute SLA applies.`,
                cgmp_category: asNotifCategory(100000000),
                cgmp_priority: asNotifPriority(100000000),
                cgmp_recipientid: admin.cgmp_userprofileid,
                cgmp_relatedchangeid: change.cgmp_changeid,
                cgmp_actionurl: `#pmo?change=${form.changenumber ?? ''}`,
                statecode: 0 as any, // SDK requires untyped cast — statecode not in generated type
                ...(snoozedUntil ? { cgmp_snoozeduntil: snoozedUntil } : {}),
              } as any).catch((err) => trackAppException(err, { context: 'notification.create' })); // SDK requires untyped cast
            });
        }
      }

      setIsDirty(false);
      onSaved();
      onClose();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save change');
    } finally {
      setSaving(false);
    }
  }, [form, mode, change, showToast, onSaved, onClose, userProfile]);

  /* Auto-save draft every 60s when dirty in edit mode */
  useEffect(() => {
    if (mode !== 'edit' || !isDirty || saving) return;
    const timer = setInterval(async () => {
      const f = _autoSaveFormRef.current;
      const c = _autoSaveChangeRef.current;
      if (!c?.cgmp_changeid || !f.title.trim()) return;
      try {
        const payload: Record<string, unknown> = {
          cgmp_title: f.title.trim(),
          cgmp_changenumber: f.changenumber.trim(),
          cgmp_createdby: f.owner.trim() || undefined,
          cgmp_changepoc: f.changepoc.trim() || undefined,
          cgmp_description: f.description || undefined,
          cgmp_location: f.location || undefined,
          cgmp_region: f.region || undefined,
          cgmp_country: f.country || undefined,
          cgmp_facility: f.facility || undefined,
          cgmp_projectids: f.projectids || undefined,
          cgmp_pirnotes: f.pirnotes || undefined,
          cgmp_closureremarks: f.closureremarks || undefined,
          cgmp_isemergency: f.isemergency,
          cgmp_isweekend: f.isweekend,
          cgmp_uatrequired: f.uatrequired,
          ...(f.category && { cgmp_category: Number(f.category) }),
          ...(f.changetype && { cgmp_changetype: Number(f.changetype) }),
          ...(f.risklevel && { cgmp_risklevel: Number(f.risklevel) }),
          ...(f.impactlevel && { cgmp_impactlevel: Number(f.impactlevel) }),
          ...(f.starttime && { cgmp_starttime: new Date(f.starttime).toISOString() }),
          ...(f.endtime && { cgmp_endtime: new Date(f.endtime).toISOString() }),
        };
        const r = await Cgmp_changesService.update(
          c.cgmp_changeid,
          payload as Parameters<typeof Cgmp_changesService.update>[1]
        );
        if (r.success) setAutoSavedAt(new Date());
      } catch {
        /* silent — auto-save is best-effort */
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [mode, isDirty, saving]);

  /* Navigation guard: prompt user before SPA navigation when form is dirty (F-5) */
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  useEffect(() => {
    if (mode === 'view') return;
    setNavigationGuard(() => {
      if (!isDirtyRef.current) return true;
      // Show the React dialog instead of window.confirm; navigation is
      // always blocked here — the dialog's confirm button closes the form
      // so the user can then re-navigate freely.
      setNavGuardOpen(true);
      return false;
    });
    return () => setNavigationGuard(null);
  }, [mode, setNavigationGuard]);

  /* Pending reschedule proposals from IT Ops */
  const pendingProposals = useMemo(() => {
    if (!change?.cgmp_versionhistory) return [];
    let hist: any[] = [];
    try {
      hist = JSON.parse(change.cgmp_versionhistory);
    } catch {
      return [];
    }
    const resolved = new Set(
      hist
        .filter((e: any) => e._type === 'rescheduleAccepted' || e._type === 'rescheduleDeclined')
        .map((e: any) => e.proposedTs)
    );
    return hist.filter((e: any) => e._type === 'rescheduleProposed' && !resolved.has(e.timestamp));
  }, [change?.cgmp_versionhistory]);

  const handleAcceptReschedule = useCallback(
    async (proposal: any) => {
      if (!change) return;
      setReschedWorking(true);
      try {
        const latestChange = await Cgmp_changesService.get(change.cgmp_changeid, {
          select: ['cgmp_versionhistory'] as any,
        });
        let hist: any[] = [];
        try {
          hist = JSON.parse(latestChange.data?.cgmp_versionhistory ?? change.cgmp_versionhistory ?? '[]');
        } catch {}
        const alreadyActioned = hist.some(
          (e: any) =>
            (e._type === 'rescheduleAccepted' || e._type === 'rescheduleDeclined') &&
            e.proposedTs === proposal.timestamp
        );
        if (alreadyActioned) {
          showToast('info', 'This proposal was already actioned by another user.');
          return;
        }
        hist.push({
          _type: 'rescheduleAccepted',
          proposedTs: proposal.timestamp,
          by: currentUserUpn,
          timestamp: new Date().toISOString(),
          prevStart: change.cgmp_starttime,
          prevEnd: change.cgmp_endtime,
        });
        const r = await Cgmp_changesService.update(change.cgmp_changeid, {
          cgmp_starttime: new Date(proposal.proposedStart).toISOString(),
          cgmp_endtime: new Date(proposal.proposedEnd).toISOString(),
          cgmp_versionhistory: JSON.stringify(hist),
        } as any);
        if (!r.success) throw r.error ?? new Error('Failed to accept reschedule');
        const proposer = allProfiles.find(
          (p: any) =>
            (proposal.byProfileId && p.cgmp_userprofileid === proposal.byProfileId) ||
            p.cgmp_userprincipalname === proposal.by
        );
        if (proposer) {
          // G2-7: skip if proposer opted out of Review Request notifications
          if (isNotifCategoryEnabled((proposer as any).cgmp_notificationcategories, 100000000)) {
            // G2-6: apply quiet-hours snooze when proposer is in their quiet window
            const snoozedUntil = getQuietHoursSnoozedUntil(
              (proposer as any).cgmp_quiethoursstart,
              (proposer as any).cgmp_quiethoursend
            );
            Cgmp_notificationsService.create({
              cgmp_title: `Reschedule Accepted: ${change.cgmp_changenumber}`,
              cgmp_category: asNotifCategory(100000000),
              cgmp_priority: asNotifPriority(100000001),
              cgmp_message: `PMO has accepted your reschedule proposal for ${change.cgmp_changenumber}. New window: ${fmtDateTime(proposal.proposedStart)} – ${fmtDateTime(proposal.proposedEnd)}.`,
              cgmp_relatedchangeid: change.cgmp_changeid,
              cgmp_actionurl: `#pmo?change=${change.cgmp_changenumber ?? ''}`,
              cgmp_recipientid: (proposer as any).cgmp_userprofileid,
              ownerid: (proposer as any).cgmp_userprofileid,
              statecode: 0 as any, // SDK requires untyped cast — statecode not in generated type
              ...(snoozedUntil ? { cgmp_snoozeduntil: snoozedUntil } : {}),
            } as any).catch((err) => trackAppException(err, { context: 'notification.create' })); // SDK requires untyped cast
          }
        }
        showToast('success', `Reschedule accepted for ${change.cgmp_changenumber} — schedule updated`);
        onSaved();
      } catch (err) {
        showToast('error', err instanceof Error ? err.message : 'Failed to accept reschedule');
      } finally {
        setReschedWorking(false);
      }
    },
    [change, currentUserUpn, allProfiles, showToast, onSaved]
  );

  const handleDeclineReschedule = useCallback(
    async (proposal: any) => {
      if (!change) return;
      setReschedWorking(true);
      try {
        const latestChange = await Cgmp_changesService.get(change.cgmp_changeid, {
          select: ['cgmp_versionhistory'] as any,
        });
        let hist: any[] = [];
        try {
          hist = JSON.parse(latestChange.data?.cgmp_versionhistory ?? change.cgmp_versionhistory ?? '[]');
        } catch {}
        const alreadyActionedDecline = hist.some(
          (e: any) =>
            (e._type === 'rescheduleAccepted' || e._type === 'rescheduleDeclined') &&
            e.proposedTs === proposal.timestamp
        );
        if (alreadyActionedDecline) {
          showToast('info', 'This proposal was already actioned by another user.');
          return;
        }
        hist.push({
          _type: 'rescheduleDeclined',
          proposedTs: proposal.timestamp,
          by: currentUserUpn,
          timestamp: new Date().toISOString(),
        });
        const r = await Cgmp_changesService.update(change.cgmp_changeid, {
          cgmp_versionhistory: JSON.stringify(hist),
        } as any);
        if (!r.success) throw r.error ?? new Error('Failed to decline reschedule');
        const proposer = allProfiles.find(
          (p: any) =>
            (proposal.byProfileId && p.cgmp_userprofileid === proposal.byProfileId) ||
            p.cgmp_userprincipalname === proposal.by
        );
        if (proposer) {
          // G2-7: skip if proposer opted out of Review Request notifications
          if (isNotifCategoryEnabled((proposer as any).cgmp_notificationcategories, 100000000)) {
            // G2-6: apply quiet-hours snooze when proposer is in their quiet window
            const snoozedUntilDecline = getQuietHoursSnoozedUntil(
              (proposer as any).cgmp_quiethoursstart,
              (proposer as any).cgmp_quiethoursend
            );
            Cgmp_notificationsService.create({
              cgmp_title: `Reschedule Declined: ${change.cgmp_changenumber}`,
              cgmp_category: asNotifCategory(100000000),
              cgmp_priority: asNotifPriority(100000001),
              cgmp_message: `PMO has declined your reschedule proposal for ${change.cgmp_changenumber}. The original schedule remains in effect.`,
              cgmp_relatedchangeid: change.cgmp_changeid,
              cgmp_actionurl: `#pmo?change=${change.cgmp_changenumber ?? ''}`,
              cgmp_recipientid: (proposer as any).cgmp_userprofileid,
              ownerid: (proposer as any).cgmp_userprofileid,
              statecode: 0 as any, // SDK requires untyped cast — statecode not in generated type
              ...(snoozedUntilDecline ? { cgmp_snoozeduntil: snoozedUntilDecline } : {}),
            } as any).catch((err) => trackAppException(err, { context: 'notification.create' })); // SDK requires untyped cast
          }
        }
        showToast('success', `Reschedule declined for ${change.cgmp_changenumber}`);
        onSaved();
      } catch (err) {
        showToast('error', err instanceof Error ? err.message : 'Failed to decline reschedule');
      } finally {
        setReschedWorking(false);
      }
    },
    [change, currentUserUpn, allProfiles, showToast, onSaved]
  );

  const title =
    mode === 'create' ? 'Create Change' : mode === 'edit' ? `Edit: ${form.changenumber}` : form.changenumber;
  const subtitle = mode === 'view' ? 'Read-only' : 'Fill all required fields';

  const footer =
    mode !== 'view' ? (
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
        {autoSavedAt && (
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginRight: 'auto' }}>
            Auto-saved {autoSavedAt.toLocaleTimeString(undefined, { timeZone: getDisplayTimezone() })}
          </span>
        )}
        <button className="btn btn--outline" onClick={handleClose} disabled={saving}>
          Cancel
        </button>
        <button
          className="btn btn--primary"
          onClick={handleSave}
          disabled={saving || (!!concurrentEditor && mode === 'edit')}
        >
          {saving ? 'Saving…' : mode === 'create' ? 'Create Change' : 'Save Changes'}
        </button>
      </div>
    ) : (
      <button className="btn btn--outline" style={{ width: '100%' }} onClick={handleClose}>
        Close
      </button>
    );

  return (
    <>
      <SlidePanel open={open} onClose={handleClose} title={title} subtitle={subtitle} width={560} footer={footer}>
        {draftRestoreVisible && mode === 'create' && (
          <div
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 16px',
              background: 'var(--warning-light, #fffbeb)',
              border: '1px solid var(--warning, #d97706)',
              borderRadius: 6,
              marginBottom: 8,
              fontSize: 13,
            }}
          >
            <span style={{ flex: 1 }}>
              Unsaved draft found (saved at{' '}
              {draftSavedAt
                ? new Date(draftSavedAt).toLocaleTimeString(undefined, { timeZone: getDisplayTimezone() })
                : ''}
              ). Restore it?
            </span>
            <button
              className="btn btn--xs btn--primary"
              onClick={() => {
                try {
                  if (!draftKey) return;
                  const rawStored = localStorage.getItem(draftKey);
                  if (rawStored) {
                    try {
                      const obfKey = currentUserUpn || 'cgmp-default';
                      const saved = JSON.parse(deobfuscate(rawStored, obfKey)) as { form: FormState };
                      if (saved?.form) {
                        setForm(saved.form);
                        setIsDirty(true);
                      }
                    } catch {
                      try {
                        if (draftKey) localStorage.removeItem(draftKey);
                      } catch {}
                    }
                  }
                } catch {}
                setDraftRestoreVisible(false);
              }}
            >
              Restore
            </button>
            <button
              className="btn btn--xs btn--outline"
              onClick={() => {
                try {
                  if (draftKey) localStorage.removeItem(draftKey);
                } catch {}
                setDraftRestoreVisible(false);
              }}
            >
              Discard
            </button>
          </div>
        )}
        {concurrentEditor && mode === 'edit' && (
          <div
            className="concurrent-edit-banner concurrent-edit-banner--block"
            role="alert"
            style={{ flexDirection: 'column', gap: 8, alignItems: 'flex-start', padding: '12px 16px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
                style={{ color: 'var(--danger)', flexShrink: 0 }}
              >
                <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
              </svg>
              <span>
                <strong>{concurrentEditor}</strong> is currently editing this change. Editing is blocked to prevent
                conflicts.
              </span>
            </div>
            <button
              type="button"
              className="btn btn--xs btn--outline"
              style={{ borderColor: 'currentColor' }}
              onClick={() => setConcurrentEditor(null)}
            >
              Override — Edit Anyway
            </button>
          </div>
        )}
        {/* Reschedule Proposal Banner — always visible regardless of edit/view mode */}
        {pendingProposals.length > 0 && change && (
          <div
            role="alert"
            style={{
              margin: '0 0 16px',
              padding: '12px 16px',
              background: '#FFF3CD',
              border: '1px solid #FFD700',
              borderRadius: 6,
            }}
          >
            {pendingProposals.map((p: any, i: number) => {
              const userRole = (userProfile?.cgmp_role as unknown as number) ?? -1;
              const canAct = userRole === 100000000 || userRole === 100000001;
              return (
                <div key={p.timestamp ?? i} style={{ marginBottom: i < pendingProposals.length - 1 ? 12 : 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                    ⏱ IT Ops has proposed a new time window
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      marginBottom: canAct ? 10 : 0,
                      lineHeight: 1.8,
                    }}
                  >
                    <strong>Proposed by:</strong> {p.by}
                    <br />
                    <strong>New Start:</strong> {fmtDateTime(p.proposedStart)}
                    <br />
                    <strong>New End:</strong> {fmtDateTime(p.proposedEnd)}
                    <br />
                    {p.reason && (
                      <>
                        <strong>Reason:</strong> {p.reason}
                      </>
                    )}
                  </div>
                  {canAct && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn btn--xs btn--primary"
                        onClick={() => handleAcceptReschedule(p)}
                        disabled={reschedWorking}
                      >
                        {reschedWorking ? 'Processing…' : `Accept & Apply Schedule (${change.cgmp_changenumber})`}
                      </button>
                      <button
                        className="btn btn--xs btn--outline"
                        onClick={() => handleDeclineReschedule(p)}
                        disabled={reschedWorking}
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="change-form">
          {mode === 'view' && change ? (
            /* ── View mode ── */
            <>
              {change.cgmp_isemergency && (
                <div
                  className="banner banner--danger"
                  style={{
                    marginBottom: 12,
                    padding: '8px 14px',
                    background: 'var(--danger-faint, rgba(220,53,69,0.08))',
                    border: '1px solid var(--danger)',
                    borderRadius: 6,
                    color: 'var(--danger)',
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
                  EMERGENCY CHANGE — 240-minute SLA applies. Admin notified on submission.
                </div>
              )}
              <FormSection title="Basic Information" />
              <div className="view-grid">
                <ReadField label="Title" value={change.cgmp_title} />
                <div className="view-field">
                  <span className="view-field__label">Change Number</span>
                  <span className="view-field__value" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {change.cgmp_changenumber ?? '—'}
                    {change.cgmp_changenumber && (
                      <button
                        className="btn btn--xs btn--ghost"
                        title={`Copy ${change.cgmp_changenumber}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(change.cgmp_changenumber ?? '');
                          showToast('success', 'Copied!');
                        }}
                        style={{ padding: '2px 6px', fontSize: 10 }}
                      >
                        &#10697;
                      </button>
                    )}
                  </span>
                </div>
                <ReadField
                  label="Status"
                  value={change.cgmp_statusname || statusLabel(change.cgmp_status as unknown as number)}
                />
                <ReadField label="Owner" value={change.cgmp_createdby || change.owneridname} />
                <ReadField label="Change POC" value={(change as any).cgmp_changepoc || undefined} />
              </div>

              <FormSection title="Classification" />
              <div className="view-grid">
                <ReadField
                  label="Category"
                  value={change.cgmp_categoryname || categoryLabel(change.cgmp_category as unknown as number)}
                />
                <ReadField
                  label="Change Type"
                  value={change.cgmp_changetypename || changeTypeLabel(change.cgmp_changetype as unknown as number)}
                />
                <ReadField
                  label="Risk Level"
                  value={change.cgmp_risklevelname || riskLabel(change.cgmp_risklevel as unknown as number)}
                />
                <ReadField
                  label="Impact Level"
                  value={change.cgmp_impactlevelname || impactLabel(change.cgmp_impactlevel as unknown as number)}
                />
              </div>

              <FormSection title="Schedule" />
              <div className="view-grid">
                <ReadField label="Start Time" value={fmtDateTime(change.cgmp_starttime)} />
                <ReadField label="End Time" value={fmtDateTime(change.cgmp_endtime)} />
                <ReadField label="Is Emergency" value={change.cgmp_isemergency} />
                <ReadField label="Is Weekend" value={change.cgmp_isweekend} />
                <div className="view-field">
                  <span className="view-field__label">UAT Required</span>
                  <span className={`badge ${(change as any).cgmp_uatrequired ? 'badge--yes' : 'badge--no'}`}>
                    {(change as any).cgmp_uatrequired ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>

              <FormSection title="Location" />
              <div className="view-grid">
                <div className="view-field">
                  <span className="view-field__label">Location</span>
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {change.cgmp_location ? (
                      change.cgmp_location
                        .split(',')
                        .map((l) => l.trim())
                        .filter(Boolean)
                        .map((loc) => (
                          <span key={loc} className="badge">
                            {loc}
                          </span>
                        ))
                    ) : (
                      <span className="view-field__value">—</span>
                    )}
                  </span>
                </div>
                <div className="view-field">
                  <span className="view-field__label">Region</span>
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {change.cgmp_region ? (
                      change.cgmp_region
                        .split(',')
                        .filter(Boolean)
                        .map((r) => (
                          <span key={r} className="badge">
                            {r.trim()}
                          </span>
                        ))
                    ) : (
                      <span className="view-field__value">—</span>
                    )}
                  </span>
                </div>
                <div className="view-field">
                  <span className="view-field__label">Country</span>
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {change.cgmp_country ? (
                      change.cgmp_country
                        .split(',')
                        .filter(Boolean)
                        .map((c) => (
                          <span key={c} className="badge">
                            {c.trim()}
                          </span>
                        ))
                    ) : (
                      <span className="view-field__value">—</span>
                    )}
                  </span>
                </div>
                <div className="view-field">
                  <span className="view-field__label">Facility</span>
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {change.cgmp_facility ? (
                      change.cgmp_facility
                        .split(',')
                        .map((f) => f.trim())
                        .filter(Boolean)
                        .map((fac) => (
                          <span key={fac} className="badge">
                            {fac}
                          </span>
                        ))
                    ) : (
                      <span className="view-field__value">—</span>
                    )}
                  </span>
                </div>
              </div>

              {change.cgmp_description && (
                <>
                  <FormSection title="Description" />
                  <p className="view-text">{change.cgmp_description}</p>
                </>
              )}
              {change.cgmp_projectids && (
                <>
                  <FormSection title="Impacted Projects" />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                    {change.cgmp_projectids
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .map((id) => (
                        <span key={id} className="proj-ms__tag proj-ms__tag--readonly">
                          {projects.find((p) => p.cgmp_projectid === id)?.cgmp_name ?? id}
                        </span>
                      ))}
                  </div>
                </>
              )}
              {change.cgmp_parentchangeid && (
                <>
                  <FormSection title="Parent Change (Dependency)" />
                  {(() => {
                    const parent = (allChanges ?? []).find(
                      (c: Cgmp_changes) => c.cgmp_changeid === change.cgmp_parentchangeid
                    );
                    return (
                      <p className="view-text">
                        {parent ? `${parent.cgmp_changenumber} — ${parent.cgmp_title}` : change.cgmp_parentchangeid}
                      </p>
                    );
                  })()}
                </>
              )}
              {change.cgmp_pirnotes && (
                <>
                  <FormSection title="PIR Notes" />
                  <p className="view-text">{change.cgmp_pirnotes}</p>
                </>
              )}

              {(change.cgmp_lessonslearned ||
                change.cgmp_closureremarks ||
                change.cgmp_downtimeminutes != null ||
                change.cgmp_rollbackinitiated) && (
                <>
                  <FormSection title="Post-Implementation" />
                  <div className="view-grid">
                    {change.cgmp_downtimeminutes != null && (
                      <ReadField label="Downtime (min)" value={String(change.cgmp_downtimeminutes)} />
                    )}
                    {change.cgmp_rollbackinitiated != null && (
                      <ReadField label="Rollback Initiated" value={change.cgmp_rollbackinitiated} />
                    )}
                  </div>
                  {change.cgmp_lessonslearned && (
                    <p className="view-text" style={{ marginTop: 6 }}>
                      <strong style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
                        Lessons Learned
                      </strong>
                      <br />
                      {change.cgmp_lessonslearned}
                    </p>
                  )}
                  {change.cgmp_closureremarks && (
                    <p className="view-text">
                      <strong style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
                        Closure Remarks
                      </strong>
                      <br />
                      {change.cgmp_closureremarks}
                    </p>
                  )}
                </>
              )}

              {(() => {
                const s = change.cgmp_status as unknown as number;
                let publishedDate: string | undefined;
                let publishedBy: string | undefined;
                try {
                  const hist = JSON.parse(change.cgmp_versionhistory ?? '[]') as HistoryEntry[];
                  const pub = hist.find((e) => String(e.newValues?.status) === '100000001');
                  if (pub) {
                    publishedDate = pub.timestamp;
                    publishedBy = pub.user;
                  }
                } catch {
                  /* noop */
                }
                const steps = [
                  {
                    label: 'Draft',
                    done: s > 100000000,
                    date: change.createdon,
                    by: change.createdbyname ?? undefined,
                  },
                  { label: 'Published', done: s > 100000001, date: publishedDate, by: publishedBy },
                  {
                    label: 'Under Review',
                    done: s > 100000002,
                    date: (change as any).cgmp_reviewedat,
                    by: (change as any).cgmp_reviewedby,
                  },
                  {
                    label: 'Released',
                    done: s >= 100000003,
                    date: (change as any).cgmp_releasedat,
                    by: (change as any).cgmp_releasedby,
                  },
                ];
                const activeIdx = steps.reduce((acc, st, i) => (st.done ? i : acc), -1);
                return (
                  <>
                    <FormSection title="Approval Chain" />
                    <div className="approval-chain">
                      {steps.map((st, i) => (
                        <div
                          key={st.label}
                          className={`approval-step ${st.done ? 'approval-step--done' : i === activeIdx + 1 ? 'approval-step--active' : 'approval-step--pending'}`}
                        >
                          {i > 0 && (
                            <div
                              className={`approval-connector ${steps[i - 1].done ? 'approval-connector--done' : ''}`}
                            />
                          )}
                          <div className="approval-step__dot">
                            {st.done ? (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                              </svg>
                            ) : i === activeIdx + 1 ? (
                              <div className="approval-step__pulse" />
                            ) : null}
                          </div>
                          <div className="approval-step__info">
                            <span className="approval-step__label">{st.label}</span>
                            {st.date && (
                              <span className="approval-step__date">
                                {new Date(st.date).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                  timeZone: getDisplayTimezone(),
                                })}
                              </span>
                            )}
                            {st.by && <span className="approval-step__by">{st.by}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}

              <FormSection title="Audit Trail" />
              <div className="view-grid" style={{ marginBottom: 8 }}>
                <ReadField label="Created On" value={fmtDateTime(change.createdon)} />
                <ReadField label="Modified On" value={fmtDateTime(change.modifiedon)} />
                {change.cgmp_releasedat && (
                  <ReadField label="Released At" value={fmtDateTime(change.cgmp_releasedat)} />
                )}
                {change.cgmp_releasedby && <ReadField label="Released By" value={change.cgmp_releasedby} />}
                {change.cgmp_reviewedat && (
                  <ReadField label="Reviewed At" value={fmtDateTime(change.cgmp_reviewedat)} />
                )}
                {change.cgmp_reviewedby && <ReadField label="Reviewed By" value={change.cgmp_reviewedby} />}
              </div>

              <FormSection title="Version History" />
              <VersionHistory
                json={change.cgmp_versionhistory}
                currentValues={fromChange(change) as unknown as Record<string, unknown>}
              />

              <FormSection title="Comments" />
              <CommentsSection
                changeId={change.cgmp_changeid}
                historyJson={change.cgmp_versionhistory}
                currentUser={currentUserName}
                onCommentAdded={onSaved}
              />

              <FormSection title="Related KB Articles" />
              <RelatedKBArticles
                changeId={change.cgmp_changeid}
                categoryCode={change.cgmp_category as unknown as number | undefined}
              />

              <FormSection title="Attachments" />
              <AttachmentPanel objectId={change.cgmp_changeid} readOnly />
            </>
          ) : (
            /* ── Create / Edit mode ── */
            <>
              <div aria-live="assertive" aria-atomic="true" className="visually-hidden">
                {validationSummary}
              </div>
              {mode === 'edit' && change && (change.cgmp_status as unknown as number) >= STATUS.Released && (
                <div className="cf-rereview-banner">
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    style={{ flexShrink: 0, color: 'var(--orange)' }}
                  >
                    <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
                  </svg>
                  <span>
                    <strong>Approval will be revoked.</strong> This change has already been approved by IT Ops. Saving
                    changes will automatically return it to the review queue and require re-approval before it can be
                    released again.
                  </span>
                </div>
              )}
              <fieldset
                disabled={!!concurrentEditor && mode === 'edit'}
                style={{ border: 'none', padding: 0, margin: 0 }}
              >
                <FormSection title="Basic Information" />
                <Field label="Title" required error={errors.title} htmlFor="cf-title">
                  <Input
                    id="cf-title"
                    value={form.title}
                    onChange={(e) => set('title', e.target.value)}
                    error={!!errors.title}
                    placeholder="Brief description of the change"
                  />
                </Field>
                <FormRow>
                  <Field label="Change Number" required error={errors.changenumber} htmlFor="cf-chgnum">
                    <Input
                      id="cf-chgnum"
                      value={form.changenumber}
                      onChange={(e) => set('changenumber', e.target.value)}
                      error={!!errors.changenumber}
                      placeholder="e.g. CHG-20260620-0001"
                    />
                  </Field>
                  {mode === 'edit' &&
                    (() => {
                      const role = (userProfile?.cgmp_role as unknown as number) ?? 0;
                      const currentStatus = change ? (change.cgmp_status as unknown as number) : STATUS.Draft;
                      const allowedNextStatuses = getAllowedTransitions(currentStatus, role);
                      const statusOptions = [currentStatus, ...allowedNextStatuses]
                        .filter((v, i, a) => a.indexOf(v) === i)
                        .map((code) => ({ value: String(code), label: statusLabel(code) }));
                      return (
                        <Field label="Status" htmlFor="cf-status">
                          <Select
                            id="cf-status"
                            value={form.status}
                            onChange={(e) => set('status', e.target.value)}
                            options={statusOptions}
                          />
                        </Field>
                      );
                    })()}
                </FormRow>

                <Field label="Change Owner" htmlFor="cf-owner">
                  <UserPickerSelect
                    users={systemUsers}
                    loading={usersLoading}
                    value={form.owner}
                    onChange={(name) => {
                      setForm((prev) => ({ ...prev, owner: name }));
                      setIsDirty(true);
                    }}
                  />
                  <span className="ff-hint">Lookup from O365 directory</span>
                </Field>

                <Field label="Change POC" htmlFor="cf-changepoc">
                  <UserPickerSelect
                    users={systemUsers}
                    loading={usersLoading}
                    value={form.changepoc}
                    onChange={(name) => {
                      setForm((prev) => ({ ...prev, changepoc: name }));
                      setIsDirty(true);
                    }}
                  />
                  <span className="ff-hint">Point of contact for this change</span>
                </Field>

                <FormSection title="Classification" />
                <FormRow>
                  <Field label="Category" required error={errors.category} htmlFor="cf-cat">
                    <Select
                      id="cf-cat"
                      value={form.category}
                      onChange={(e) => set('category', e.target.value)}
                      options={CATEGORY_OPTIONS}
                      placeholder="Select category"
                      error={!!errors.category}
                    />
                  </Field>
                  <Field label="Change Type" required error={errors.changetype} htmlFor="cf-type">
                    <Select
                      id="cf-type"
                      value={form.changetype}
                      onChange={(e) => set('changetype', e.target.value)}
                      options={CHANGE_TYPE_OPTIONS}
                      placeholder="Select type"
                      error={!!errors.changetype}
                    />
                  </Field>
                </FormRow>
                <FormRow>
                  <Field label="Risk Level" required error={errors.risklevel} htmlFor="cf-risk">
                    <Select
                      id="cf-risk"
                      value={form.risklevel}
                      onChange={(e) => set('risklevel', e.target.value)}
                      options={RISK_OPTIONS}
                      placeholder="Select risk"
                      error={!!errors.risklevel}
                    />
                  </Field>
                  <Field label="Impact Level" required error={errors.impactlevel} htmlFor="cf-impact">
                    <Select
                      id="cf-impact"
                      value={form.impactlevel}
                      onChange={(e) => set('impactlevel', e.target.value)}
                      options={IMPACT_OPTIONS}
                      placeholder="Select impact"
                      error={!!errors.impactlevel}
                    />
                  </Field>
                </FormRow>

                <div className="ff-group">
                  <label className="ff-label" htmlFor="parent-change">
                    Parent Change (optional)
                  </label>
                  <input
                    id="parent-change"
                    className="ff-input"
                    type="text"
                    placeholder="CHG-xxxxx"
                    value={form.parentChangenumber ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, parentChangenumber: e.target.value }))}
                    aria-describedby="parent-change-hint"
                  />
                  <span id="parent-change-hint" className="ff-hint">
                    Link to a parent change to establish a hierarchy.
                  </span>
                </div>

                <FormSection title="Schedule" />
                <FormRow>
                  <Field label="Start Date / Time" required error={errors.starttime} htmlFor="cf-start">
                    <DateTimeInput
                      id="cf-start"
                      value={form.starttime}
                      onChange={(e) => set('starttime', e.target.value)}
                      error={!!errors.starttime}
                    />
                  </Field>
                  <Field label="End Date / Time" required error={errors.endtime} htmlFor="cf-end">
                    <DateTimeInput
                      id="cf-end"
                      value={form.endtime}
                      onChange={(e) => set('endtime', e.target.value)}
                      error={!!errors.endtime}
                    />
                  </Field>
                </FormRow>
                {blackoutWarning && (
                  <div
                    className="cf-conflict-banner"
                    role="alert"
                    style={{
                      borderColor: 'var(--warning, #d97706)',
                      background: 'var(--warning-light, #fffbeb)',
                      color: 'var(--warning-text, #92400e)',
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      style={{ color: 'var(--warning, #d97706)', flexShrink: 0 }}
                    >
                      <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
                    </svg>
                    <div>
                      <strong>Blackout Period Warning</strong> — This change overlaps a scheduled freeze period:
                      <div style={{ fontSize: 12, marginTop: 4 }}>
                        {blackoutWarning.cgmp_name || 'Blackout Period'}: {blackoutWarning.cgmp_startdate?.slice(0, 10)}{' '}
                        – {blackoutWarning.cgmp_enddate?.slice(0, 10)}
                        {blackoutWarning.cgmp_reason ? ` (${blackoutWarning.cgmp_reason})` : ''}
                      </div>
                    </div>
                  </div>
                )}
                {schedulingConflicts.length > 0 && (
                  <div className="cf-conflict-banner" role="alert">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
                    </svg>
                    <div>
                      <strong>Scheduling conflict</strong> — {schedulingConflicts.length} change
                      {schedulingConflicts.length > 1 ? 's' : ''} overlap at the same location during this window:
                      <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                        {schedulingConflicts.slice(0, 3).map((c) => (
                          <li key={c.cgmp_changeid} style={{ fontSize: 12 }}>
                            {c.cgmp_changenumber ?? '—'} — {c.cgmp_title ?? '—'} (
                            {statusLabel(c.cgmp_status as unknown as number)})
                          </li>
                        ))}
                        {schedulingConflicts.length > 3 && (
                          <li style={{ fontSize: 12 }}>…and {schedulingConflicts.length - 3} more</li>
                        )}
                      </ul>
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 24, marginTop: 4 }}>
                  <Toggle
                    checked={form.isemergency}
                    onChange={(v) => {
                      set('isemergency', v);
                      if (v) set('changetype', '100000001');
                      else set('changetype', '');
                    }}
                    label="Emergency Change"
                    id="cf-emergency"
                  />
                  <Toggle
                    checked={form.isweekend}
                    onChange={(v) => set('isweekend', v)}
                    label="Weekend Change"
                    id="cf-weekend"
                  />
                  <Toggle
                    checked={form.uatrequired}
                    onChange={(v) => set('uatrequired', v)}
                    label="UAT Required"
                    id="cf-uatrequired"
                  />
                </div>

                <FormSection title="Location" />
                <FormRow>
                  <Field label="Location" htmlFor="cf-loc">
                    {locationOptions.length > 0 ? (
                      <div
                        className="multi-loc-list"
                        style={{
                          maxHeight: 120,
                          overflowY: 'auto',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius)',
                          padding: '6px 8px',
                        }}
                      >
                        {locationOptions.map((opt) => (
                          <label
                            key={opt.value}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '2px 0',
                              cursor: 'pointer',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={form.location.split(',').filter(Boolean).includes(opt.value)}
                              onChange={(e) => {
                                const current = form.location.split(',').filter(Boolean);
                                const next = e.target.checked
                                  ? [...current, opt.value]
                                  : current.filter((l) => l !== opt.value);
                                setForm((f) => ({ ...f, location: next.join(',') }));
                                setIsDirty(true);
                              }}
                            />
                            <span style={{ fontSize: 13 }}>{opt.label}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <Input
                        id="cf-loc"
                        value={form.location}
                        onChange={(e) => set('location', e.target.value)}
                        placeholder="e.g. Chennai"
                      />
                    )}
                  </Field>
                  <Field label="Region" htmlFor="cf-region">
                    {regionOptions.length > 0 ? (
                      <div
                        className="multi-loc-list"
                        style={{
                          maxHeight: 120,
                          overflowY: 'auto',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius)',
                          padding: '6px 8px',
                        }}
                      >
                        {regionOptions.map((opt) => (
                          <label
                            key={opt.value}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '2px 0',
                              cursor: 'pointer',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={form.region.split(',').filter(Boolean).includes(opt.value)}
                              onChange={(e) => {
                                const current = form.region.split(',').filter(Boolean);
                                const next = e.target.checked
                                  ? [...current, opt.value]
                                  : current.filter((r) => r !== opt.value);
                                set('region', next.join(','));
                              }}
                            />
                            <span style={{ fontSize: 13 }}>{opt.label}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <Input
                        id="cf-region"
                        value={form.region}
                        onChange={(e) => set('region', e.target.value)}
                        placeholder="e.g. APAC"
                      />
                    )}
                  </Field>
                </FormRow>
                <FormRow>
                  <Field label="Country" htmlFor="cf-country">
                    {countryOptions.length > 0 ? (
                      <div
                        className="multi-loc-list"
                        style={{
                          maxHeight: 120,
                          overflowY: 'auto',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius)',
                          padding: '6px 8px',
                        }}
                      >
                        {countryOptions.map((opt) => (
                          <label
                            key={opt.value}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '2px 0',
                              cursor: 'pointer',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={form.country.split(',').filter(Boolean).includes(opt.value)}
                              onChange={(e) => {
                                const current = form.country.split(',').filter(Boolean);
                                const next = e.target.checked
                                  ? [...current, opt.value]
                                  : current.filter((c) => c !== opt.value);
                                set('country', next.join(','));
                              }}
                            />
                            <span style={{ fontSize: 13 }}>{opt.label}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <Input
                        id="cf-country"
                        value={form.country}
                        onChange={(e) => set('country', e.target.value)}
                        placeholder={form.region ? 'No countries found for this region' : 'Select regions first'}
                      />
                    )}
                  </Field>
                  <Field label="Facility" htmlFor="cf-facility">
                    {facilityOptions.length > 0 ? (
                      <div
                        className="multi-loc-list"
                        style={{
                          maxHeight: 120,
                          overflowY: 'auto',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius)',
                          padding: '6px 8px',
                        }}
                      >
                        {facilityOptions.map((opt) => (
                          <label
                            key={opt.value}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '2px 0',
                              cursor: 'pointer',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={form.facility.split(',').filter(Boolean).includes(opt.value)}
                              onChange={(e) => {
                                const current = form.facility.split(',').filter(Boolean);
                                const next = e.target.checked
                                  ? [...current, opt.value]
                                  : current.filter((f) => f !== opt.value);
                                set('facility', next.join(','));
                              }}
                            />
                            <span style={{ fontSize: 13 }}>{opt.label}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <Input
                        id="cf-facility"
                        value={form.facility}
                        onChange={(e) => set('facility', e.target.value)}
                        placeholder="e.g. Building 3"
                      />
                    )}
                  </Field>
                </FormRow>

                <FormSection title="Description" />
                <Textarea
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder="Detailed description of the change, impact, and rollback plan…"
                  rows={4}
                  maxLength={2000}
                />
                <div
                  className={`ff-char-count${form.description.length > 1900 ? ' ff-char-count--error' : form.description.length > 1600 ? ' ff-char-count--warn' : ''}`}
                  aria-live="polite"
                >
                  {form.description.length} / 2000
                </div>

                <FormSection title="Timeline" />
                <Textarea
                  value={form.timeline}
                  onChange={(e) => set('timeline', e.target.value)}
                  placeholder="High-level implementation timeline and key milestones…"
                  rows={3}
                  maxLength={1000}
                />
                <div
                  className={`ff-char-count${form.timeline.length > 950 ? ' ff-char-count--error' : form.timeline.length > 800 ? ' ff-char-count--warn' : ''}`}
                  aria-live="polite"
                >
                  {form.timeline.length} / 1000
                </div>

                <FormSection title="Impacted Projects" />
                <Field
                  label="Linked Projects"
                  hint={projects.length === 0 ? 'Loading project list…' : `${projects.length} projects available`}
                  htmlFor="cf-proj"
                  labelSuffix={
                    <HelpTip text="Select all projects impacted by this change. ISM teams for each project will be notified." />
                  }
                >
                  <ProjectMultiSelect
                    projects={projects}
                    value={form.projectids}
                    onChange={(v) => {
                      set('projectids', v);
                    }}
                    disabled={projects.length === 0}
                  />
                </Field>

                <FormSection title="Change Dependencies" />
                <Field
                  label="Parent Change"
                  htmlFor="cf-parentchange"
                  hint="Optionally link this change to a parent change it depends on"
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <input
                      id="cf-parentchange"
                      className="ff-input"
                      placeholder="Search by change number or title…"
                      value={
                        parentSearch ||
                        (form.parentchangeid && !parentSearch
                          ? (allChanges.find((c) => c.cgmp_changeid === form.parentchangeid)?.cgmp_changenumber ??
                            form.parentchangeid)
                          : '')
                      }
                      onChange={(e) => {
                        setParentSearch(e.target.value);
                        if (!e.target.value) set('parentchangeid', '');
                      }}
                    />
                    {parentSearch && (
                      <div
                        style={{
                          border: '1px solid var(--border)',
                          borderRadius: 4,
                          maxHeight: 180,
                          overflowY: 'auto',
                          background: 'var(--surface)',
                        }}
                      >
                        {parentOpts.length === 0 ? (
                          <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-tertiary)' }}>
                            No matches
                          </div>
                        ) : (
                          parentOpts.map((c) => (
                            <div
                              key={c.cgmp_changeid}
                              style={{
                                padding: '8px 12px',
                                fontSize: 12,
                                cursor: 'pointer',
                                borderBottom: '1px solid var(--border)',
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-alt)')}
                              onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                              onClick={() => {
                                set('parentchangeid', c.cgmp_changeid);
                                setParentSearch('');
                              }}
                            >
                              <span style={{ fontWeight: 600 }}>{c.cgmp_changenumber}</span>
                              <span style={{ color: 'var(--text-secondary)', marginLeft: 8 }}>{c.cgmp_title}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                    {form.parentchangeid && !parentSearch && (
                      <button
                        className="btn btn--xs btn--danger-outline"
                        style={{ alignSelf: 'flex-start' }}
                        onClick={() => set('parentchangeid', '')}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </Field>

                {mode === 'edit' && (
                  <>
                    <FormSection title="PIR Notes" />
                    <Field
                      label="PIR Notes"
                      htmlFor="cf-pirnotes"
                      labelSuffix={
                        <HelpTip text="Post-Implementation Review notes. Describe what went well, what failed, and key learnings." />
                      }
                    >
                      <Textarea
                        id="cf-pirnotes"
                        value={form.pirnotes}
                        onChange={(e) => set('pirnotes', e.target.value)}
                        rows={3}
                        placeholder="Post-implementation review notes…"
                        maxLength={5000}
                      />
                      <div
                        className={`ff-char-count${form.pirnotes.length > 4750 ? ' ff-char-count--error' : form.pirnotes.length > 4000 ? ' ff-char-count--warn' : ''}`}
                        aria-live="polite"
                      >
                        {form.pirnotes.length} / 5000
                      </div>
                    </Field>
                  </>
                )}

                {mode === 'edit' && (
                  <>
                    <FormSection title="Closure Remarks" />
                    <Field label="Closure Remarks" htmlFor="cf-closureremarks">
                      <Textarea
                        id="cf-closureremarks"
                        value={form.closureremarks}
                        onChange={(e) => set('closureremarks', e.target.value)}
                        rows={3}
                        placeholder="Closure remarks and post-implementation summary…"
                        maxLength={2000}
                      />
                      <div
                        className={`ff-char-count${form.closureremarks.length > 1900 ? ' ff-char-count--error' : form.closureremarks.length > 1600 ? ' ff-char-count--warn' : ''}`}
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        {form.closureremarks.length} / 2000
                      </div>
                    </Field>
                  </>
                )}

                {mode === 'edit' && change && (
                  <>
                    <FormSection title="Attachments" />
                    <AttachmentPanel objectId={change.cgmp_changeid} />
                  </>
                )}

                {Object.keys(errors).length > 0 && (
                  <div className="form-error-summary">Please fix the errors above before saving.</div>
                )}
              </fieldset>
            </>
          )}
        </div>
      </SlidePanel>
      <ConfirmDialog
        open={discardConfirm}
        title="Discard Changes"
        message="You have unsaved changes. Are you sure you want to discard them?"
        confirmLabel="Discard"
        variant="destructive"
        onConfirm={() => {
          setDiscardConfirm(false);
          setIsDirty(false);
          onClose();
        }}
        onClose={() => setDiscardConfirm(false)}
      />
      <ConfirmDialog
        open={navGuardOpen}
        title="Unsaved Changes"
        message="You have unsaved changes. Are you sure you want to leave without saving?"
        confirmLabel="Leave without saving"
        cancelLabel="Keep editing"
        variant="destructive"
        onConfirm={() => {
          setNavGuardOpen(false);
          setIsDirty(false);
          onClose();
        }}
        onClose={() => setNavGuardOpen(false)}
      />
      <ConfirmDialog
        open={blackoutConfirmOpen}
        title="Blackout Period Conflict"
        message={`This change overlaps "${blackoutWarning?.cgmp_name ?? 'a blackout period'}" (${blackoutWarning?.cgmp_startdate?.slice(0, 10) ?? ''} – ${blackoutWarning?.cgmp_enddate?.slice(0, 10) ?? ''}). Non-emergency changes should not be scheduled during freeze periods.`}
        confirmLabel="Proceed Anyway"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={() => {
          setBlackoutConfirmOpen(false);
          blackoutConfirmResolveRef.current?.(true);
        }}
        onClose={() => {
          setBlackoutConfirmOpen(false);
          blackoutConfirmResolveRef.current?.(false);
        }}
      />
    </>
  );
}

/* Helper for PMOWorkspace to build label strings */
export function categoryLabel(code: number): string {
  return CATEGORY_OPTIONS.find((o) => o.value === String(code))?.label ?? String(code);
}

export function changeTypeLabel(code: number): string {
  return CHANGE_TYPE_OPTIONS.find((o) => o.value === String(code))?.label ?? String(code);
}
