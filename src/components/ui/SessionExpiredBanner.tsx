import { useState, useEffect } from 'react';

const SESSION_EXPIRED_KEY = 'cgmp-session-expired';
const SESSION_EXPIRED_VALUE = '1';

export default function SessionExpiredBanner() {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const handler = () => setExpired(true);
    window.addEventListener(SESSION_EXPIRED_KEY, handler);
    // Also check sessionStorage on mount in case the event fired before this component mounted
    if (sessionStorage.getItem(SESSION_EXPIRED_KEY) === SESSION_EXPIRED_VALUE) setExpired(true);
    return () => window.removeEventListener(SESSION_EXPIRED_KEY, handler);
  }, []);

  if (!expired) return null;
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: 'var(--danger)', color: '#fff',
      padding: '12px 24px', textAlign: 'center', fontWeight: 600,
    }}>
      Your session has expired.
      <button
        onClick={() => { sessionStorage.removeItem(SESSION_EXPIRED_KEY); window.location.reload(); }}
        style={{ marginLeft: 16, padding: '4px 12px', background: '#fff', color: 'var(--danger)', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}
      >
        Sign In Again
      </button>
    </div>
  );
}
