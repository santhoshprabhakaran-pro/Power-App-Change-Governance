import { useState, useEffect } from 'react';
import { SlidePanel } from '../ui/Modal';
import { useApp } from '../../context/AppContext';
import { Cgmp_projectsService } from '../../generated';
import type { Cgmp_projects } from '../../generated/models/Cgmp_projectsModel';

interface UATUser {
  name: string;
  email: string;
  phone?: string;
}

function parseUATUsers(json: string | undefined): UATUser[] {
  if (!json?.trim()) return [];
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed as UATUser[];
  } catch { /* fall through */ }
  return json.split(',').filter(s => s.trim()).map(s => ({ name: s.trim(), email: '' }));
}

interface Props {
  open: boolean;
  onClose: () => void;
  project: Cgmp_projects | null;
  onSaved: () => void;
}

export default function UATManagement({ open, onClose, project, onSaved }: Props) {
  const { showToast } = useApp();
  const [users, setUsers] = useState<UATUser[]>([]);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [addError, setAddError] = useState('');

  useEffect(() => {
    if (open && project) setUsers(parseUATUsers(project.cgmp_uatusers));
    if (!open) { setNewName(''); setNewEmail(''); setNewPhone(''); setAddError(''); }
  }, [open, project]);

  const handleAdd = () => {
    if (!newName.trim()) { setAddError('Name is required'); return; }
    if (!newEmail.trim() || !newEmail.includes('@')) { setAddError('Valid email is required'); return; }
    setUsers(prev => [...prev, { name: newName.trim(), email: newEmail.trim(), phone: newPhone.trim() || undefined }]);
    setNewName(''); setNewEmail(''); setNewPhone(''); setAddError('');
  };

  const handleRemove = (idx: number) => setUsers(prev => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (!project) return;
    setSaving(true);
    try {
      const r = await Cgmp_projectsService.update(project.cgmp_projectid, { cgmp_uatusers: JSON.stringify(users) });
      if (!r.success) throw r.error ?? new Error('Failed to save UAT users');
      showToast('success', `UAT users updated for ${project.cgmp_name}`);
      onSaved();
      onClose();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save UAT users');
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
      <button className="btn btn--outline" onClick={onClose} disabled={saving}>Cancel</button>
      <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  );

  if (!project) return null;

  return (
    <SlidePanel open={open} onClose={onClose} title="Manage UAT Users" subtitle={project.cgmp_name} width={520} footer={footer}>
      <div className="uat-panel">
        <div className="uat-section">
          <div className="uat-section__title">
            UAT Contacts
            <span className="uat-count-badge">{users.length}</span>
          </div>
          {users.length === 0 ? (
            <div className="uat-empty">No UAT contacts configured for this project.</div>
          ) : (
            <div className="uat-list">
              {users.map((u, i) => (
                <div key={i} className="uat-user-row">
                  <div className="uat-user-info">
                    <span className="uat-user-avatar">{u.name.charAt(0).toUpperCase()}</span>
                    <div className="uat-user-details">
                      <span className="uat-user-name">{u.name}</span>
                      <span className="uat-user-email">{u.email}</span>
                      {u.phone && <span className="uat-user-phone">{u.phone}</span>}
                    </div>
                  </div>
                  <button className="btn-icon btn-icon--danger" onClick={() => handleRemove(i)} title="Remove">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="uat-section">
          <div className="uat-section__title">Add Contact</div>
          <div className="uat-add-form">
            <div className="ff-group">
              <label className="ff-label">Full Name <span className="ff-required">*</span></label>
              <input
                className={`ff-input ${addError && !newName.trim() ? 'ff-input--error' : ''}`}
                value={newName}
                onChange={e => { setNewName(e.target.value); setAddError(''); }}
                placeholder="Enter full name"
              />
            </div>
            <div className="ff-group">
              <label className="ff-label">Email <span className="ff-required">*</span></label>
              <input
                className={`ff-input ${addError && !newEmail.includes('@') ? 'ff-input--error' : ''}`}
                type="email"
                value={newEmail}
                onChange={e => { setNewEmail(e.target.value); setAddError(''); }}
                placeholder="Enter email address"
              />
            </div>
            <div className="ff-group">
              <label className="ff-label">Phone</label>
              <input
                className="ff-input"
                value={newPhone}
                onChange={e => setNewPhone(e.target.value)}
                placeholder="Enter phone number (optional)"
              />
            </div>
            {addError && <span className="ff-error">{addError}</span>}
            <button className="btn btn--secondary" onClick={handleAdd} style={{ alignSelf: 'flex-start' }}>
              + Add Contact
            </button>
          </div>
        </div>
      </div>
    </SlidePanel>
  );
}
