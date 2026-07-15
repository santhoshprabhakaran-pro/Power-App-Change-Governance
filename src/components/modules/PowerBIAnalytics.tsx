import { useMemo, useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { ROLES } from '../../utils/roles';
import { isValidPowerBIUrl } from '../../utils/powerbi';

export default function PowerBIAnalytics() {
  const { navigate, userProfile, isAdmin } = useApp();
  const isPMO = Number(userProfile?.cgmp_role) === ROLES.PMO;
  const isISM = Number(userProfile?.cgmp_role) === ROLES.ISM;
  const url = useMemo(() => (userProfile as any)?.cgmp_powerbiurl || localStorage.getItem('cgmp-powerbi-url') || '', [userProfile]);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  useEffect(() => {
    setIframeLoaded(false);
  }, [url]);

  if (!isAdmin && !isPMO && !isISM) return (
    <div className="workspace-placeholder workspace-placeholder--denied" role="alert">
      <span aria-hidden="true" style={{ fontSize: 48 }}>🔒</span>
      <h2>Access Denied</h2>
      <p>Power BI Analytics is restricted to Admin, PMO, and ISM roles.</p>
    </div>
  );

  const urlIsValid = url !== '' && isValidPowerBIUrl(url);

  if (!url || !urlIsValid) {
    return (
      <div className="module-workspace">
        <div className="module-header">
          <div>
            <h1 className="module-title">Power BI Analytics</h1>
            <p className="module-subtitle">Embedded Power BI dashboards and trend analysis</p>
          </div>
        </div>
        <div className="powerbi-placeholder">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="var(--primary)" style={{ opacity: 0.3 }}>
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
          </svg>
          <div className="powerbi-placeholder__title">Power BI Not Configured</div>
          <p className="powerbi-placeholder__msg">
            {url && !urlIsValid
              ? 'The stored URL is not a valid Power BI HTTPS embed URL. Please update it in Settings.'
              : 'Configure a Power BI embed URL in Settings to display your dashboards here.'}
          </p>
          <button className="btn btn--primary btn--sm" onClick={() => navigate('settings')}>
            Go to Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="module-workspace" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="module-header">
        <div>
          <h1 className="module-title">Power BI Analytics</h1>
          <p className="module-subtitle">Embedded Power BI dashboards and trend analysis</p>
        </div>
        <button className="btn btn--outline btn--sm" onClick={() => navigate('settings')}>Change URL</button>
      </div>
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {!iframeLoaded && (
          <div className="skeleton" style={{ width: '100%', height: 500, borderRadius: 8 }} aria-label="Loading Power BI report" />
        )}
        <iframe
          key={url}
          src={url}
          title="Power BI Analytics Report"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
          referrerPolicy="no-referrer-when-downgrade"
          style={{ flex: 1, border: 'none', borderRadius: 8, minHeight: 600, display: iframeLoaded ? undefined : 'none' }}
          allowFullScreen
          onLoad={() => setIframeLoaded(true)}
        />
      </div>
    </div>
  );
}
