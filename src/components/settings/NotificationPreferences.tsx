import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Cgmp_userprofilesService } from '../../generated';
import type { Cgmp_userprofilescgmp_notificationpreference } from '../../generated/models/Cgmp_userprofilesModel';

const CATEGORIES = [
  { key: 'reviewRequest', label: 'Review Requests', desc: 'When a change is submitted for your review' },
  { key: 'uatReminder', label: 'UAT Reminders', desc: 'Reminders to update UAT users for your projects' },
  { key: 'escalation', label: 'Escalations', desc: 'High-priority escalation alerts' },
  { key: 'giiccHandover', label: 'GIICC Handover', desc: 'Bridge handover and assignment notifications' },
  { key: 'closure', label: 'Closure Alerts', desc: 'When changes are closed or completed' },
  { key: 'emergency', label: 'Emergency Alerts', desc: 'Emergency change notifications (always on)' },
  { key: 'systemAlerts', label: 'System Alerts', desc: 'Platform updates and system messages' },
];

const DEFAULT_CATEGORIES: Record<string, boolean> = {
  reviewRequest: true, uatReminder: true, escalation: true,
  giiccHandover: true, closure: true, emergency: true, systemAlerts: true,
};

const PREF_KEY = 'cgmp-notif-categories';

const CHANNEL_OPTS = [
  { value: '100000000', label: 'Email', icon: '✉' },
  { value: '100000001', label: 'Teams', icon: '💬' },
  { value: '100000002', label: 'Both (Email + Teams)', icon: '⚡' },
];

const HOUR_OPTS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: i === 0 ? '12:00 AM' : i < 12 ? `${i}:00 AM` : i === 12 ? '12:00 PM' : `${i - 12}:00 PM`,
}));

export default function NotificationPreferences() {
  const { userProfile, showToast } = useApp();
  const [channel, setChannel] = useState('100000002');
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(PREF_KEY);
      if (saved) return { ...DEFAULT_CATEGORIES, ...JSON.parse(saved) };
    } catch { /* use defaults */ }
    return { ...DEFAULT_CATEGORIES };
  });
  const [quietStart, setQuietStart] = useState<string>('');
  const [quietEnd, setQuietEnd] = useState<string>('');
  const [quietEnabled, setQuietEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userProfile) return;
    setChannel(String(userProfile.cgmp_notificationpreference as unknown as number ?? 100000002));
    /* Load category prefs from Dataverse if available */
    const dvCats = (userProfile as any).cgmp_notificationcategories;
    if (dvCats) {
      try {
        const parsed = JSON.parse(dvCats);
        setEnabled({ ...DEFAULT_CATEGORIES, ...parsed });
      } catch { /* fall back to localStorage */ }
    }
    /* Load quiet hours */
    const qs = (userProfile as any).cgmp_quiethoursstart;
    const qe = (userProfile as any).cgmp_quiethoursend;
    if (qs != null && qe != null) {
      setQuietStart(String(qs));
      setQuietEnd(String(qe));
      setQuietEnabled(true);
    }
  }, [userProfile]);

  const toggleCategory = (key: string) => {
    if (key === 'emergency') return;
    setEnabled(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    if (!userProfile) return;
    if (quietEnabled && (quietStart === '' || quietEnd === '')) {
      showToast('error', 'Please select both a start and end hour for quiet hours, or toggle quiet hours off.');
      return;
    }
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        cgmp_notificationpreference: parseInt(channel) as unknown as Cgmp_userprofilescgmp_notificationpreference,
        cgmp_notificationcategories: JSON.stringify({ ...enabled, emergency: true }), // emergency always on
      };
      if (quietEnabled && quietStart !== '' && quietEnd !== '') {
        updates.cgmp_quiethoursstart = parseInt(quietStart);
        updates.cgmp_quiethoursend = parseInt(quietEnd);
      } else if (!quietEnabled) {
        updates.cgmp_quiethoursstart = null;
        updates.cgmp_quiethoursend = null;
      }
      const r = await Cgmp_userprofilesService.update(userProfile.cgmp_userprofileid, updates as any);
      if (!r.success) throw r.error ?? new Error('Failed to save preferences');
      /* Mirror to localStorage so legacy code still works */
      try { localStorage.setItem(PREF_KEY, JSON.stringify(enabled)); } catch { /* noop */ }
      const activeCategories = CATEGORIES.filter(c => enabled[c.key]).map(c => c.label).join(', ');
      showToast('success', `Notification preferences saved. Active: ${activeCategories || 'none'}`);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save preferences');
    } finally { setSaving(false); }
  };

  return (
    <div className="module-workspace">
      <div className="module-header">
        <div>
          <h1 className="module-title">Notification Preferences</h1>
          <p className="module-subtitle">Configure how and when you receive notifications</p>
        </div>
      </div>

      <div className="settings-body">
        {/* Channel selection */}
        <div className="settings-card">
          <div className="settings-card__title">Delivery Channel</div>
          <div className="notif-pref-channels">
            {CHANNEL_OPTS.map(opt => (
              <label key={opt.value} className={`notif-channel-card ${channel === opt.value ? 'notif-channel-card--active' : ''}`}>
                <input type="radio" name="channel" value={opt.value} checked={channel === opt.value} onChange={() => setChannel(opt.value)} style={{ display: 'none' }} />
                <span className="notif-channel-icon">{opt.icon}</span>
                <span className="notif-channel-label">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Category toggles */}
        <div className="settings-card">
          <div className="settings-card__title">Notification Categories</div>
          <div className="notif-cat-list">
            {CATEGORIES.map(cat => (
              <div key={cat.key} className="notif-cat-row">
                <div className="notif-cat-info">
                  <span className="notif-cat-label">{cat.label}</span>
                  <span className="notif-cat-desc">{cat.desc}</span>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={enabled[cat.key] ?? true}
                    onChange={() => toggleCategory(cat.key)}
                    disabled={cat.key === 'emergency'}
                  />
                  <span className="toggle-switch__track" />
                </label>
              </div>
            ))}
          </div>
        </div>

        {/* Quiet Hours */}
        <div className="settings-card">
          <div className="settings-card__title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Quiet Hours / Do Not Disturb</span>
            <label className="toggle-switch">
              <input type="checkbox" checked={quietEnabled} onChange={() => setQuietEnabled(v => !v)} />
              <span className="toggle-switch__track" />
            </label>
          </div>
          {quietEnabled && (
            <div style={{ marginTop: 12, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>From</label>
                <select className="ff-input ff-select" value={quietStart} onChange={e => setQuietStart(e.target.value)} style={{ minWidth: 120 }}>
                  <option value="">Select hour…</option>
                  {HOUR_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Until</label>
                <select className="ff-input ff-select" value={quietEnd} onChange={e => setQuietEnd(e.target.value)} style={{ minWidth: 120 }}>
                  <option value="">Select hour…</option>
                  {HOUR_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>
                Notifications during these hours will be queued and delivered when the quiet window ends.
                {quietStart !== '' && quietEnd !== '' && parseInt(quietStart) >= parseInt(quietEnd) && (
                  <span style={{ display: 'block', marginTop: 4, color: 'var(--primary)' }}>
                    This window crosses midnight ({quietStart}:00 → next day {quietEnd}:00).
                  </span>
                )}
              </p>
            </div>
          )}
        </div>

        <div style={{ padding: '0 24px', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn--primary" onClick={handleSave} disabled={saving || !userProfile}>
            {saving ? 'Saving…' : 'Save Preferences'}
          </button>
        </div>
      </div>
    </div>
  );
}
