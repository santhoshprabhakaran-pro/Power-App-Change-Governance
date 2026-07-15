import { useState, useEffect } from 'react';
import { ROLES } from './roles';

const LS_KEY = 'cgmp-feature-flags';

// Flags listed here are only applied when the current user's role satisfies the requirement.
// Flags NOT listed here are UI-preference flags and are applied unconditionally.
export const BUSINESS_LOGIC_FLAG_GATES: Record<string, number[]> = {
  'emergency-fast-track': [ROLES.Admin],
  'peer-review-gate':     [ROLES.Admin],
  'real-time-updates':    [ROLES.Admin, ROLES.GIICC],
};

export function getAllFeatureFlags(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Record<string, boolean>;
  } catch { return {}; }
}

export function isFeatureEnabled(key: string): boolean {
  return getAllFeatureFlags()[key] ?? false;
}

export function setFeatureFlag(key: string, enabled: boolean): void {
  try {
    const flags = getAllFeatureFlags();
    flags[key] = enabled;
    const serialized = JSON.stringify(flags);
    localStorage.setItem(LS_KEY, serialized);
    // Dispatch storage event for same-tab listeners (storage event only fires in OTHER tabs normally)
    window.dispatchEvent(new StorageEvent('storage', {
      key: LS_KEY,
      newValue: serialized,
      storageArea: localStorage,
    }));
  } catch { /* ignore */ }
}

export function useFeatureFlag(key: string): boolean {
  const [value, setValue] = useState(() => isFeatureEnabled(key));

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === LS_KEY) setValue(isFeatureEnabled(key));
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [key]);

  return value;
}
