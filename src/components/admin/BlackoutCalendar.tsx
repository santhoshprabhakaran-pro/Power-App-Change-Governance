import { useState, useCallback, useEffect, useRef } from 'react';
import { Cgmp_blackoutperiodsService } from '../../generated';
import type { Cgmp_blackoutperiods } from '../../generated/models/Cgmp_blackoutperiodsModel';
import { useApp } from '../../context/AppContext';
import { Dialog } from '../ui/Modal';
import ConfirmDialog from '../ui/ConfirmDialog';
import { fmtDate } from '../../utils/format';
import { DateTimeInput } from '../ui/FormFields';

const EMPTY_FORM = { name: '', startdate: '', enddate: '', reason: '', affectedlocations: '' };

export default function BlackoutCalendar() {
  const { showToast, isAdmin, currentUserUpn } = useApp();
  const [periods, setPeriods] = useState<Cgmp_blackoutperiods[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
      const r = await Cgmp_blackoutperiodsService.getAll({ orderBy: ['cgmp_startdate asc'], top: 200 });
      setPeriods(r.data ?? []);
      setLoaded(true);
    } catch {
      setPeriods([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditId(null);
    setFormOpen(true);
  };
  const openEdit = (p: Cgmp_blackoutperiods) => {
    setForm({
      name: p.cgmp_name ?? '',
      startdate: p.cgmp_startdate ? p.cgmp_startdate.slice(0, 10) : '',
      enddate: p.cgmp_enddate ? p.cgmp_enddate.slice(0, 10) : '',
      reason: p.cgmp_reason ?? '',
      affectedlocations: p.cgmp_affectedlocations ?? '',
    });
    setEditId(p.cgmp_blackoutperiodid);
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.startdate || !form.enddate) {
      showToast('error', 'Start and End dates are required');
      return;
    }
    if (form.enddate < form.startdate) {
      showToast('error', 'End date must be after start date');
      return;
    }
    const overlapping = periods.some((p) => {
      if (p.cgmp_blackoutperiodid === editId) return false;
      const pStart = (p.cgmp_startdate ?? '').slice(0, 10);
      const pEnd = (p.cgmp_enddate ?? '').slice(0, 10);
      return pStart <= form.enddate && pEnd >= form.startdate;
    });
    if (overlapping) {
      showToast('warning', 'This period overlaps an existing blackout period. Please review before saving.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        cgmp_name: form.name || `Blackout ${form.startdate} – ${form.enddate}`,
        cgmp_startdate: form.startdate + 'T00:00:00',
        cgmp_enddate: form.enddate + 'T23:59:59',
        cgmp_reason: form.reason || undefined,
        cgmp_affectedlocations: form.affectedlocations || undefined,
        cgmp_createdbyupn: currentUserUpn,
      } as any;
      if (editId) {
        const r = await Cgmp_blackoutperiodsService.update(editId, payload);
        if (!r.success) throw r.error ?? new Error('Update failed');
        showToast('success', 'Blackout period updated');
      } else {
        const r = await Cgmp_blackoutperiodsService.create(payload);
        if (!r.success) throw r.error ?? new Error('Create failed');
        showToast('success', 'Blackout period created');
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
    const snapshot = periods.find((p) => p.cgmp_blackoutperiodid === id);
    setDeleting(id);
    try {
      await Cgmp_blackoutperiodsService.delete(id);
      showToast('success', 'Deleted');
      load();
      if (snapshot) showUndo('Blackout period deleted', snapshot);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(null);
      setConfirmDeleteId(null);
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const active = periods.filter((p) => p.cgmp_enddate && p.cgmp_enddate.slice(0, 10) >= today);
  const past = periods.filter((p) => p.cgmp_enddate && p.cgmp_enddate.slice(0, 10) < today);

  return (
    <div className="module-workspace">
      <div className="module-header">
        <div>
          <h1 className="module-title">Blackout Calendar</h1>
          <p className="module-subtitle">Define change freeze periods where new changes cannot be scheduled</p>
        </div>
        {isAdmin && (
          <button className="btn btn--primary btn--sm" onClick={openCreate}>
            + Add Blackout Period
          </button>
        )}
      </div>

      {loading && <div className="module-loading">Loading blackout periods…</div>}

      {!loading && (
        <div style={{ overflowY: 'auto', maxHeight: 'min(400px, 80vh)' }}>
          <div style={{ padding: '12px 24px 0' }}>
            <div className="settings-card__title" style={{ fontSize: 13, marginBottom: 8 }}>
              Active & Upcoming ({active.length})
            </div>
            {active.length === 0 ? (
              <div className="module-empty" style={{ padding: '16px 0' }}>
                No active blackout periods.
              </div>
            ) : (
              <table className="ism-table">
                <thead>
                  <tr>
                    <th>Name / Reason</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Affected Locations</th>
                    {isAdmin && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {active.map((p) => (
                    <tr key={p.cgmp_blackoutperiodid}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{p.cgmp_name || '—'}</div>
                        {p.cgmp_reason && (
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{p.cgmp_reason}</div>
                        )}
                      </td>
                      <td style={{ fontSize: 12 }}>{fmtDate(p.cgmp_startdate)}</td>
                      <td style={{ fontSize: 12 }}>{fmtDate(p.cgmp_enddate)}</td>
                      <td style={{ fontSize: 12 }}>{p.cgmp_affectedlocations || 'All'}</td>
                      {isAdmin && (
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn--xs btn--outline" onClick={() => openEdit(p)}>
                              Edit
                            </button>
                            <button
                              className="btn btn--xs btn--danger-outline"
                              onClick={() => setConfirmDeleteId(p.cgmp_blackoutperiodid)}
                              disabled={!!deleting}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {past.length > 0 && (
            <div style={{ padding: '12px 24px 0' }}>
              <div
                className="settings-card__title"
                style={{ fontSize: 13, marginBottom: 8, color: 'var(--text-secondary)' }}
              >
                Past Periods ({past.length})
              </div>
              <table className="ism-table">
                <thead>
                  <tr>
                    <th>Name / Reason</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Affected Locations</th>
                    {isAdmin && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {past.map((p) => (
                    <tr key={p.cgmp_blackoutperiodid} style={{ opacity: 0.6 }}>
                      <td>
                        <div style={{ fontSize: 13 }}>{p.cgmp_name || '—'}</div>
                        {p.cgmp_reason && (
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{p.cgmp_reason}</div>
                        )}
                      </td>
                      <td style={{ fontSize: 12 }}>{fmtDate(p.cgmp_startdate)}</td>
                      <td style={{ fontSize: 12 }}>{fmtDate(p.cgmp_enddate)}</td>
                      <td style={{ fontSize: 12 }}>{p.cgmp_affectedlocations || 'All'}</td>
                      {isAdmin && (
                        <td>
                          <button
                            className="btn btn--xs btn--danger-outline"
                            onClick={() => setConfirmDeleteId(p.cgmp_blackoutperiodid)}
                            disabled={!!deleting}
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
        title="Delete Blackout Period"
        message="This will permanently remove the blackout period. Changes scheduled during this window will no longer be flagged."
        confirmLabel="Delete"
        variant="destructive"
        loading={!!deleting}
      />

      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editId ? 'Edit Blackout Period' : 'New Blackout Period'}
        maxWidth={480}
        footer={
          <>
            <button className="btn btn--outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="ff-label">Name (optional)</label>
            <input
              className="ff-input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Q4 Freeze"
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label className="ff-label" htmlFor="blackout-start">
                Start Date *
              </label>
              <DateTimeInput
                type="date"
                id="blackout-start"
                value={form.startdate}
                onChange={(e) => setForm((f) => ({ ...f, startdate: e.target.value }))}
              />
            </div>
            <div>
              <label className="ff-label" htmlFor="blackout-end">
                End Date *
              </label>
              <DateTimeInput
                type="date"
                id="blackout-end"
                value={form.enddate}
                onChange={(e) => setForm((f) => ({ ...f, enddate: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="ff-label">Reason</label>
            <input
              className="ff-input"
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="e.g. Quarter-end system freeze"
            />
          </div>
          <div>
            <label className="ff-label">Affected Locations (comma-separated, or leave blank for all)</label>
            <input
              className="ff-input"
              value={form.affectedlocations}
              onChange={(e) => setForm((f) => ({ ...f, affectedlocations: e.target.value }))}
              placeholder="e.g. Chennai, Mumbai, Singapore"
            />
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
              const snapshot = undoState.snapshot as Cgmp_blackoutperiods;
              setUndoState(null);
              if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
              try {
                await Cgmp_blackoutperiodsService.create(snapshot as any);
                load();
                showToast('success', 'Blackout period restored');
              } catch {
                showToast('error', 'Failed to restore blackout period');
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
