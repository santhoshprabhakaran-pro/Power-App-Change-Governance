import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { getAllFeatureFlags, setFeatureFlag as setFlag, BUSINESS_LOGIC_FLAG_GATES } from '../utils/featureFlags';
import { useApp } from './AppContext';

interface FeatureFlagsContextValue {
  isEnabled: (key: string) => boolean;
  setFlag: (key: string, enabled: boolean) => void;
}

// Fallback context for use outside the provider — no role gating applied
const FeatureFlagsContext = createContext<FeatureFlagsContextValue>({
  isEnabled: (key: string) => getAllFeatureFlags()[key] ?? false,
  setFlag: setFlag,
});

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const { userProfile } = useApp();
  const [, setVersion] = useState(0);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === 'cgmp-feature-flags') setVersion(v => v + 1);
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const handleSetFlag = useCallback((key: string, enabled: boolean) => {
    setFlag(key, enabled);
    setVersion(v => v + 1);
  }, []);

  // Gate business-logic flags to authorised roles only
  const gatedIsEnabled = useCallback((key: string): boolean => {
    const rawFlags = getAllFeatureFlags();
    const enabled = rawFlags[key] ?? false;
    if (!enabled) return false;
    const requiredRoles = BUSINESS_LOGIC_FLAG_GATES[key];
    if (!requiredRoles) return enabled; // UI-preference flag — no gate
    const userRoleCode = Number(userProfile?.cgmp_role);
    const allowed = requiredRoles.includes(userRoleCode);
    if (!allowed && import.meta.env.DEV) {
      console.warn(`[CGMP] Feature flag "${key}" is enabled in localStorage but requires role ${requiredRoles.join(' or ')} — suppressed for role ${userRoleCode}`);
    }
    return allowed ? enabled : false;
  }, [userProfile]);

  return (
    <FeatureFlagsContext.Provider value={{ isEnabled: gatedIsEnabled, setFlag: handleSetFlag }}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFeatureFlags() {
  return useContext(FeatureFlagsContext);
}
