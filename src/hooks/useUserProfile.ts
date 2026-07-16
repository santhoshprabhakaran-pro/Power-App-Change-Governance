import { useState, useEffect, useCallback, useRef } from 'react';
import { SystemusersService } from '../generated';
import type { Systemusers } from '../generated/models/SystemusersModel';
import { useUserProfiles } from '../context/UserProfilesContext';

/** Returns a ref that flips to false when the component unmounts. */
function useMounted() {
  const ref = useRef(true);
  useEffect(
    () => () => {
      ref.current = false;
    },
    []
  );
  return ref;
}

/** Fetch active O365/AAD system users for Tech POC picker */
export function useSystemUsers() {
  const [users, setUsers] = useState<Systemusers[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useMounted();

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const r = await SystemusersService.getAll({
        filter: 'isdisabled eq false',
        orderBy: ['fullname asc'],
        // Covers typical deployment sizes; expand if user picker shows incomplete results
        top: 200,
        select: ['systemuserid', 'fullname', 'internalemailaddress', 'isdisabled'],
      });
      if (!mounted.current) return;
      setUsers((r.data ?? []).filter((u) => u.fullname));
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load users');
      setUsers([]);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [mounted]);

  useEffect(() => {
    fetch();
  }, [fetch]);
  return { users, loading, error };
}

export function useAllUserProfiles() {
  // Delegates to shared context — prevents N independent 500-record fetches.
  const { userProfiles: profiles, loading } = useUserProfiles();
  return { profiles, loading };
}
