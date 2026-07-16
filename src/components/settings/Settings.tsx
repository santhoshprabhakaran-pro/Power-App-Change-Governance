import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Cgmp_userprofilesService } from '../../generated';
import type { Cgmp_userprofilescgmp_notificationpreference } from '../../generated/models/Cgmp_userprofilesModel';
import { getDisplayTimezone, setDisplayTimezone, formatInTz } from '../../utils/format';
import { ROLE_LABEL } from '../../utils/roles';
import { isValidPowerBIUrl } from '../../utils/powerbi';
import { isFeatureEnabled, setFeatureFlag } from '../../utils/featureFlags';

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
];

const NOTIF_OPTS = [
  { value: '100000000', label: 'Email' },
  { value: '100000001', label: 'Teams' },
  { value: '100000002', label: 'Both (Email + Teams)' },
];

// G2-26: Structured feature flag type — TODO: replace with Cgmp_featureflagsService when table is created
interface FeatureFlag {
  key: string;
  enabled: boolean;
  label: string;
  description: string;
  enabledFor: string; // comma-separated UPNs, empty = all
}

const FEATURE_FLAG_DEFINITIONS: Omit<FeatureFlag, 'enabled'>[] = [
  {
    key: 'emergency-fast-track',
    label: 'Emergency Change Fast-Track',
    description: '240-minute SLA and immediate Admin notification for emergency changes',
    enabledFor: '',
  },
  {
    key: 'ism-signoff-gate',
    label: 'ISM Sign-Off Gate',
    description: 'Require ISM sign-off before IT Ops can proceed with handover',
    enabledFor: '',
  },
  {
    key: 'advanced-rbac',
    label: 'Advanced RBAC',
    description: 'Enable Observer, ISM Deputy, and Department Admin roles',
    enabledFor: '',
  },
  {
    key: 'sharepoint-integration',
    label: 'SharePoint Document Library',
    description: 'Store attachments in SharePoint instead of Dataverse annotations',
    enabledFor: '',
  },
  {
    key: 'teams-integration',
    label: 'Teams Tab Integration',
    description: 'Enable Microsoft Teams adaptive card approvals',
    enabledFor: '',
  },
  {
    key: 'capacity-planning',
    label: 'Capacity Planning Module',
    description: 'Show capacity planning heatmap in navigation',
    enabledFor: '',
  },
  {
    key: 'scheduling-calendar',
    label: 'Scheduling Calendar',
    description: 'Show monthly scheduling calendar in navigation',
    enabledFor: '',
  },
];

export default function Settings() {
  const { userProfile, showToast, theme, toggleTheme, isAdmin } = useApp();
  const [upn, setUpn] = useState('');
  const [notifPref, setNotifPref] = useState('100000000');
  const [saving, setSaving] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'preferences' | 'feature-flags'>('preferences');
  const [flagValues, setFlagValues] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(FEATURE_FLAG_DEFINITIONS.map((f) => [f.key, isFeatureEnabled(f.key)]))
  );
  const [powerBIUrl, setPowerBIUrl] = useState('');
  const [powerBIUrlError, setPowerBIUrlError] = useState('');
  const [powerBISaving, setPowerBISaving] = useState(false);
  const [displayTz, setDisplayTz] = useState(getDisplayTimezone);
  const [tzSaved, setTzSaved] = useState(false);

  useEffect(() => {
    if (userProfile) {
      setUpn(userProfile.cgmp_userprincipalname ?? '');
      setNotifPref(String((userProfile.cgmp_notificationpreference as unknown as number) ?? 100000000));
      /* Load Power BI URL from Dataverse user profile */
      const dvUrl = (userProfile as any).cgmp_powerbiurl;
      if (dvUrl) {
        setPowerBIUrl(dvUrl);
      }
    }
  }, [userProfile]);

  // G2-26: Load feature flags — tries Dataverse first, falls back to localStorage
  useEffect(() => {
    const loadFlags = async () => {
      try {
        // TODO: replace with Cgmp_featureflagsService when table is created
        // const flags = await Cgmp_featureflagsService.getAll();
        // setFlagValues(Object.fromEntries(flags.map(f => [f.key, f.enabled])));
      } catch {
        const saved = localStorage.getItem('cgmp-feature-flags');
        if (saved) setFlagValues(JSON.parse(saved) as Record<string, boolean>);
      }
    };
    void loadFlags();
  }, []);

  const handleSave = async () => {
    if (!userProfile) return;
    setSaving(true);
    try {
      const r = await Cgmp_userprofilesService.update(userProfile.cgmp_userprofileid, {
        cgmp_notificationpreference: parseInt(notifPref) as unknown as Cgmp_userprofilescgmp_notificationpreference,
      });
      if (!r.success) throw r.error ?? new Error('Failed to save settings');
      showToast('success', 'Settings saved');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const savePowerBIUrl = async () => {
    if (powerBIUrl.trim() && !isValidPowerBIUrl(powerBIUrl.trim())) {
      setPowerBIUrlError('URL must be a valid Power BI HTTPS embed URL');
      return;
    }
    setPowerBIUrlError('');
    if (!userProfile) {
      showToast('error', 'Sign in to save your Power BI URL to your profile');
      return;
    }
    setPowerBISaving(true);
    try {
      const r = await Cgmp_userprofilesService.update(userProfile.cgmp_userprofileid, {
        cgmp_powerbiurl: powerBIUrl.trim() || null,
      } as any);
      if (!r.success) throw r.error ?? new Error('Failed to save');
      showToast('success', 'Power BI URL saved');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save Power BI URL');
    } finally {
      setPowerBISaving(false);
    }
  };

  const handleFlagToggle = (key: string, enabled: boolean) => {
    // G2-26: TODO: attempt Dataverse save first when Cgmp_featureflagsService is created:
    // (async () => {
    //   try {
    //     await Cgmp_featureflagsService.update(key, { enabled });
    //   } catch {
    //     setFeatureFlag(key, enabled); // localStorage fallback
    //   }
    // })();
    setFeatureFlag(key, enabled);
    setFlagValues((prev) => ({ ...prev, [key]: enabled }));
    showToast('success', 'Feature flag updated.');
  };

  const roleCode = userProfile ? (userProfile.cgmp_role as unknown as number) : -1;

  return (
    <div className="module-workspace">
      <div className="module-header">
        <div>
          <h1 className="module-title">Settings</h1>
          <p className="module-subtitle">Platform configuration and user preferences</p>
        </div>
      </div>

      {isAdmin && (
        <div
          className="ism-tabs"
          role="tablist"
          aria-label="Settings sections"
          style={{ padding: '0 24px', marginBottom: 0 }}
        >
          <button
            role="tab"
            aria-selected={settingsTab === 'preferences'}
            className={`ism-tab${settingsTab === 'preferences' ? ' ism-tab--active' : ''}`}
            onClick={() => setSettingsTab('preferences')}
          >
            Preferences
          </button>
          <button
            role="tab"
            aria-selected={settingsTab === 'feature-flags'}
            className={`ism-tab${settingsTab === 'feature-flags' ? ' ism-tab--active' : ''}`}
            onClick={() => setSettingsTab('feature-flags')}
          >
            Feature Flags
          </button>
        </div>
      )}

      {settingsTab === 'feature-flags' && isAdmin ? (
        <div className="settings-body">
          <div className="settings-card">
            <div className="settings-card__title">Feature Flags</div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
              Toggle experimental and optional platform features. Changes take effect immediately and are stored
              per-browser.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {FEATURE_FLAG_DEFINITIONS.map((flag) => (
                <div
                  key={flag.key}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 16,
                    padding: '12px 0',
                    borderBottom: '1px solid var(--border-light)',
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flex: 1 }}>
                    <input
                      type="checkbox"
                      checked={flagValues[flag.key] ?? false}
                      onChange={(e) => handleFlagToggle(flag.key, e.target.checked)}
                      style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--primary)', flexShrink: 0 }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{flag.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {flag.description}
                      </div>
                    </div>
                  </label>
                  <span
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 'var(--radius)',
                      background: (flagValues[flag.key] ?? false) ? 'var(--primary)' : 'var(--bg-tertiary)',
                      color: (flagValues[flag.key] ?? false) ? '#fff' : 'var(--text-tertiary)',
                      fontWeight: 600,
                      flexShrink: 0,
                      alignSelf: 'center',
                    }}
                  >
                    {(flagValues[flag.key] ?? false) ? 'ON' : 'OFF'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="settings-body">
            {/* Profile section */}
            <div className="settings-card">
              <div className="settings-card__title">User Profile</div>
              <div className="settings-fields">
                <div className="settings-field">
                  <span className="settings-field__label">User Principal Name</span>
                  <span className="settings-field__value">{userProfile?.cgmp_userprincipalname ?? '—'}</span>
                </div>
                <div className="settings-field">
                  <span className="settings-field__label">Role</span>
                  <span className="settings-field__value">
                    <span className="badge badge--status status-released">{ROLE_LABEL[roleCode] ?? 'Unknown'}</span>
                  </span>
                </div>
                <div className="settings-field">
                  <span className="settings-field__label">UPN (read-only)</span>
                  <input
                    className="ff-input"
                    value={upn}
                    disabled
                    autoComplete="off"
                    style={{ opacity: 0.6, cursor: 'not-allowed' }}
                  />
                </div>
              </div>
            </div>

            {/* Theme */}
            <div className="settings-card">
              <div className="settings-card__title">Appearance</div>
              <div className="settings-field">
                <span className="settings-field__label">Theme</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className={`settings-theme-btn ${theme === 'light' ? 'settings-theme-btn--active' : ''}`}
                    onClick={() => theme === 'dark' && toggleTheme()}
                  >
                    ☀ Light
                  </button>
                  <button
                    className={`settings-theme-btn ${theme === 'dark' ? 'settings-theme-btn--active' : ''}`}
                    onClick={() => theme === 'light' && toggleTheme()}
                  >
                    ☾ Dark
                  </button>
                </div>
              </div>
            </div>

            {/* Notification preference */}
            <div className="settings-card">
              <div className="settings-card__title">Notification Delivery</div>
              <div className="settings-fields">
                <div className="settings-field settings-field--col">
                  <span className="settings-field__label">Preferred Channel</span>
                  <div className="settings-radio-group">
                    {NOTIF_OPTS.map((o) => (
                      <label key={o.value} className="settings-radio">
                        <input
                          type="radio"
                          name="notif-pref"
                          value={o.value}
                          checked={notifPref === o.value}
                          onChange={() => setNotifPref(o.value)}
                        />
                        <span>{o.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="btn btn--primary" onClick={handleSave} disabled={saving || !userProfile}>
                  {saving ? 'Saving…' : 'Save Settings'}
                </button>
              </div>
            </div>

            {/* Timezone */}
            <div className="settings-card">
              <div className="settings-card__title">Date &amp; Time</div>
              <div className="settings-fields">
                <div className="settings-field settings-field--col">
                  <span className="settings-field__label">Display Timezone</span>
                  <select
                    className="ff-input ff-select"
                    value={displayTz}
                    onChange={(e) => {
                      setDisplayTz(e.target.value);
                      setTzSaved(false);
                    }}
                    style={{ maxWidth: 320 }}
                  >
                    {COMMON_TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    Preview:{' '}
                    {formatInTz(new Date().toISOString(), { timeZone: displayTz } as Intl.DateTimeFormatOptions)}
                  </span>
                </div>
              </div>
              <div
                style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 16 }}
              >
                {tzSaved && (
                  <span style={{ fontSize: 12, color: 'var(--success)' }}>Saved — page will use this timezone</span>
                )}
                <button
                  className="btn btn--primary btn--sm"
                  onClick={() => {
                    setDisplayTimezone(displayTz);
                    setTzSaved(true);
                  }}
                >
                  Apply Timezone
                </button>
              </div>
            </div>

            {/* Analytics & Power BI */}
            <div className="settings-card">
              <div className="settings-card__title">Analytics &amp; Power BI</div>
              <div className="settings-fields">
                <div className="settings-field settings-field--col">
                  <span className="settings-field__label">Power BI Embed URL</span>
                  <input
                    className={`ff-input${powerBIUrlError ? ' ff-input--error' : ''}`}
                    value={powerBIUrl}
                    onChange={(e) => {
                      setPowerBIUrl(e.target.value);
                      if (powerBIUrlError) setPowerBIUrlError('');
                    }}
                    placeholder="https://app.powerbi.com/reportEmbed?reportId=..."
                  />
                  {powerBIUrlError && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{powerBIUrlError}</span>}
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    Paste your Power BI embed URL to enable the Power BI Analytics page
                  </span>
                  <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                    URL is saved to your user profile and synced across sessions.
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="btn btn--primary btn--sm" onClick={savePowerBIUrl} disabled={powerBISaving}>
                  {powerBISaving ? 'Saving…' : 'Save URL'}
                </button>
              </div>
            </div>
          </div>
          <div
            style={{
              marginTop: 24,
              padding: '12px 0',
              borderTop: '1px solid var(--border-light)',
              color: 'var(--text-tertiary)',
              fontSize: 11,
              textAlign: 'right',
            }}
          >
            Change Governance Platform v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '—'}
          </div>
        </>
      )}
    </div>
  );
}
