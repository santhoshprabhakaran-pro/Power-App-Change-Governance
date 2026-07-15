import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Cgmp_userprofilesService } from '../generated';
import type { Cgmp_userprofiles } from '../generated/models/Cgmp_userprofilesModel';

interface UserProfilesContextValue {
  userProfiles: Cgmp_userprofiles[];
  loading: boolean;
  refresh: () => void;
}

const UserProfilesContext = createContext<UserProfilesContextValue | null>(null);

export function UserProfilesProvider({ children }: { children: React.ReactNode }) {
  const [userProfiles, setUserProfiles] = useState<Cgmp_userprofiles[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const result = await Cgmp_userprofilesService.getAll({
        filter: 'cgmp_isactive eq true',
        orderBy: ['owneridname asc'],
        top: 500,
      });
      setUserProfiles(result.data ?? []);
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <UserProfilesContext.Provider value={{ userProfiles, loading, refresh: load }}>
      {children}
    </UserProfilesContext.Provider>
  );
}

export function useUserProfiles(): UserProfilesContextValue {
  const ctx = useContext(UserProfilesContext);
  if (!ctx) throw new Error('useUserProfiles must be used inside UserProfilesProvider');
  return ctx;
}
