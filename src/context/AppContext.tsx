import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getContext } from '@microsoft/power-apps/app';
import type { IContext } from '@microsoft/power-apps/app';
import { app as teamsApp } from '@microsoft/teams-js';
import { Cgmp_userprofilesService } from '../generated';
import type { Cgmp_userprofiles } from '../generated/models/Cgmp_userprofilesModel';
import { getBrowserInfo } from '../utils/format';
import { ROLES, EXTENDED_ROLES } from '../utils/roles';
import { escapeODataString } from '../utils/odata';

/* ── Toast ── */
export type ToastType = 'success' | 'error' | 'info' | 'warning';
export interface ToastItem { id: string; type: ToastType; message: string; }

/* ── App Context Shape ── */
interface AppContextValue {
  userProfile: Cgmp_userprofiles | null;
  userLoading: boolean;
  currentUserName: string;
  currentUserUpn: string;
  isAdmin: boolean;
  isPMO: boolean;
  isITOps: boolean;
  isISM: boolean;
  isGIICC: boolean;
  isObserver: boolean;
  assignedLocations: string[];
  canEdit: boolean;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  toasts: ToastItem[];
  showToast: (type: ToastType, message: string) => void;
  dismissToast: (id: string) => void;
  notificationPanelOpen: boolean;
  openNotificationPanel: () => void;
  closeNotificationPanel: () => void;
  activePage: string;
  navigate: (page: string) => void;
  setNavigationGuard: (guard: (() => boolean) | null) => void;
  logout: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);
const THEME_KEY = 'cgmp-theme';

/* ── Hash-based routing ── */
const KNOWN_PAGES = new Set([
  'dashboard', 'pmo', 'itops', 'ism', 'giicc',
  'project', 'attachment', 'knowledge',
  'reports', 'powerbi', 'heatmap', 'leaderboard',
  'audit', 'archive', 'notification-center',
  'settings', 'security', 'notif-prefs', 'notification-rules',
  'change-templates', 'blackout-calendar', 'admin-dashboard',
  'tasks', 'scheduling', 'capacity-planning',
]);

function pageFromHash(): string {
  const hash = window.location.hash.slice(1); // remove leading '#'
  return hash && KNOWN_PAGES.has(hash) ? hash : 'dashboard';
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [userProfile, setUserProfile] = useState<Cgmp_userprofiles | null>(null);
  const [sdkUser, setSdkUser] = useState<IContext['user'] | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
  });
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [activePage, setActivePage] = useState<string>(pageFromHash);
  const toastId = useRef(0);
  const toastTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastToastRef = useRef<{ type: ToastType; message: string; time: number } | null>(null);
  const upnRef = useRef<string | undefined>(undefined);
  const currentUserNameRef = useRef<string>('Unknown User');

  /* Clear all pending toast timers on unmount */
  useEffect(() => () => { toastTimers.current.forEach(t => clearTimeout(t)); }, []);

  /* Sync hash → state when the user navigates with Back/Forward */
  useEffect(() => {
    function onHashChange() {
      setActivePage(pageFromHash());
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  /* Keep DOM data-theme attribute in sync with state */
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  /* Sync app theme with Microsoft Teams host theme when running as a Teams tab */
  useEffect(() => {
    let active = true;
    async function syncTeamsTheme() {
      try {
        await teamsApp.initialize();
        if (!active) return;
        const ctx = await teamsApp.getContext();
        if (!active) return;
        const teamsTheme = ctx.app?.theme ?? 'default';
        setTheme(teamsTheme === 'dark' || teamsTheme === 'contrast' ? 'dark' : 'light');
        teamsApp.registerOnThemeChangeHandler((newTheme) => {
          setTheme(newTheme === 'dark' || newTheme === 'contrast' ? 'dark' : 'light');
        });
      } catch {
        // Not running inside Teams — existing localStorage-based theme is used
      }
    }
    syncTeamsTheme();
    return () => { active = false; };
  }, []);

  /* Load Power Apps context for real user identity, then load profile */
  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      try {
        // Step 1: Get real user identity from Power Apps host
        const ctx = await getContext();
        if (cancelled) return;

        if (ctx?.user) {
          setSdkUser(ctx.user);
        }

        const upn = ctx?.user?.userPrincipalName;
        upnRef.current = upn;

        // Step 2: Load Dataverse profile — only if we have a real UPN to filter by
        if (!upn) return; // no identity → no profile, stays null (safe default)
        const profileResult = await Cgmp_userprofilesService.getAll({
          filter: `cgmp_userprincipalname eq '${escapeODataString(upn)}'`,
          top: 1,
        });

        if (cancelled) return;
        const profiles = profileResult.data ?? [];
        if (profiles.length > 0) {
          setUserProfile(profiles[0]);
          // Fire-and-forget — record when this user last accessed the app
          Cgmp_userprofilesService.update(profiles[0].cgmp_userprofileid, {
            cgmp_lastseenat: new Date().toISOString(),
          } as never).catch(() => {});
        }
      } catch {
        // SDK context not available (e.g. local dev) — silently continue with whatever we have
      } finally {
        if (!cancelled) setUserLoading(false);
      }
    }

    loadUser();
    return () => { cancelled = true; };
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(t => {
      const next = t === 'light' ? 'dark' : 'light';
      localStorage.setItem(THEME_KEY, next);
      return next;
    });
  }, []);

  /* Keep currentUserNameRef in sync for use in beforeunload */
  const currentUserName = useMemo(() =>
    sdkUser?.fullName ??
    userProfile?.owneridname ??
    sdkUser?.userPrincipalName?.split('@')[0] ??
    'Unknown User'
  , [sdkUser, userProfile]);
  useEffect(() => { currentUserNameRef.current = currentUserName; }, [currentUserName]);

  /* Best-effort logout audit on page unload.
   *
   * fetch / XHR calls in beforeunload are cancelled by the browser before they
   * can complete, so Cgmp_auditlogsService.create() was silently failing.
   * navigator.sendBeacon() sends a fire-and-forget POST that the browser
   * guarantees to deliver even as the page closes (F-031 / F-073).
   *
   * Limitations of sendBeacon:
   *   - Maximum payload: 64 KB (well within our needs)
   *   - No custom headers — relies on the ambient Dataverse session cookie
   *   - Returns boolean (not a Promise) — do NOT await it
   */
  useEffect(() => {
    const handler = () => {
      const upn = upnRef.current;
      if (!upn) return;
      // Synchronous localStorage cleanup is safe inside beforeunload.
      // Item 20 — purge all app-owned keys on page close, matching the same
      // key prefixes cleared by logout() to avoid stale data on next login.
      const unloadKeysToRemove = Object.keys(localStorage).filter(k =>
        k.startsWith('cgmp-') ||
        k.startsWith('pmo-changelist-') ||
        k.startsWith('cgmp-fb-') ||
        k.startsWith('cgmp-draft-') ||
        k === 'rp-collapsed'
      );
      unloadKeysToRemove.forEach(k => localStorage.removeItem(k));
      const orgUrl = (import.meta.env.VITE_ORG_URL as string | undefined) ?? '';
      if (!orgUrl) {
        // VITE_ORG_URL not configured — skip audit log rather than fire an
        // unreliable fetch that the browser will cancel before it completes.
        return;
      }
      const payload = JSON.stringify({
        cgmp_auditlogname: `User Logout — ${currentUserNameRef.current}`,
        cgmp_eventtype: 100000001, // Logout
        cgmp_entitytype: 100000003, // User
        cgmp_entityid: upn,
        cgmp_entityname: currentUserNameRef.current,
        cgmp_username: currentUserNameRef.current,
        cgmp_useremail: upn,
        cgmp_ipaddress: getBrowserInfo(),
      });
      navigator.sendBeacon(
        `${orgUrl}/api/data/v9.2/cgmp_auditlogs`,
        new Blob([payload], { type: 'application/json' }),
      );
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const PROFILE_REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes (was 5 minutes — unnecessary quota use)

  /* Periodic profile refresh — starts only after initial profile loads, pauses on hidden tabs */
  useEffect(() => {
    if (!upnRef.current) return;
    const upn = upnRef.current; // capture at effect start — safe, UPN does not change mid-session
    const doRefresh = async () => {
      try {
        const r = await Cgmp_userprofilesService.getAll({ filter: `cgmp_userprincipalname eq '${escapeODataString(upn)}'`, top: 1 });
        const profiles = r.data ?? [];
        if (profiles.length > 0) setUserProfile(profiles[0]);
      } catch { /* silent */ }
    };
    let intervalId = setInterval(doRefresh, PROFILE_REFRESH_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') clearInterval(intervalId);
      else { doRefresh(); intervalId = setInterval(doRefresh, PROFILE_REFRESH_INTERVAL_MS); }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { clearInterval(intervalId); document.removeEventListener('visibilitychange', onVisibility); };
  }, [userLoading]);

  const showToast = useCallback((type: ToastType, message: string) => {
    const now = Date.now();
    const last = lastToastRef.current;
    if (last && last.type === type && last.message === message && now - last.time < 2000) return;
    lastToastRef.current = { type, message, time: now };
    const id = String(++toastId.current);
    setToasts(prev => [...prev, { id, type, message }]);
    const timer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      toastTimers.current.delete(id);
    }, 4000);
    toastTimers.current.set(id, timer);
  }, []);

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimers.current.get(id);
    if (timer) { clearTimeout(timer); toastTimers.current.delete(id); }
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const openNotificationPanel = useCallback(() => setNotificationPanelOpen(true), []);
  const closeNotificationPanel = useCallback(() => setNotificationPanelOpen(false), []);
  const logout = useCallback(() => {
    // Clear app storage — Item 20: explicit key prefixes so only known
    // app-owned entries are removed and nothing else is accidentally wiped.
    try {
      const keysToRemove = Object.keys(localStorage).filter(k =>
        k.startsWith('cgmp-') ||
        k.startsWith('pmo-changelist-') ||
        k.startsWith('cgmp-fb-') ||
        k.startsWith('cgmp-draft-') ||
        k === 'rp-collapsed'
      );
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch { /* ignore */ }

    // Redirect to AAD logout
    const tenantId = import.meta.env.VITE_TENANT_ID ?? '';
    if (!tenantId && import.meta.env.DEV) {
      console.warn('[CGMP] VITE_TENANT_ID is not set — logout redirect will be broken');
    }
    const postLogoutUri = encodeURIComponent(window.location.origin);
    window.location.href = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/logout?post_logout_redirect_uri=${postLogoutUri}`;
  }, []);
  const navigationGuardRef = useRef<(() => boolean) | null>(null);
  const setNavigationGuard = useCallback((guard: (() => boolean) | null) => {
    navigationGuardRef.current = guard;
  }, []);
  // Item 18 — Role validation on navigation:
  // navigate() itself performs NO role check. Role-restricted pages render an
  // Access Denied state inside their component (WorkspacePage variant="denied").
  // Those components call useApp() at render time, so userProfile?.cgmp_role is
  // always read fresh from React context on every render — never from a stale
  // closure. If an admin updates a user's role in SecurityRoles and that user
  // then navigates, the next render will pick up the updated userProfile from the
  // periodic refresh (see PROFILE_REFRESH_INTERVAL_MS above) and grant or
  // restrict access immediately without requiring a page reload.
  const navigate = useCallback((page: string) => {
    if (navigationGuardRef.current && !navigationGuardRef.current()) return;
    setActivePage(page);
    // Push to browser history so Back/Forward work; the resulting hashchange
    // event calls setActivePage again with the same value — a React no-op.
    if (window.location.hash !== `#${page}`) {
      window.location.hash = page;
    }
  }, []);

  const currentUserUpn = useMemo(() =>
    userProfile?.cgmp_userprincipalname ?? sdkUser?.userPrincipalName ?? ''
  , [userProfile, sdkUser]);

  // Use Number() cast to safely handle option sets returned as strings by OData
  const roleCode = useMemo(() => Number(userProfile?.cgmp_role ?? -1), [userProfile]);
  const isAdmin = useMemo(() => roleCode === ROLES.Admin, [roleCode]);
  const isPMO = useMemo(() => roleCode === ROLES.PMO, [roleCode]);
  const isITOps = useMemo(() => roleCode === ROLES.ITOps, [roleCode]);
  const isISM = useMemo(() => roleCode === ROLES.ISM || roleCode === EXTENDED_ROLES.ISMDeputy, [roleCode]);
  const isGIICC = useMemo(() => roleCode === ROLES.GIICC, [roleCode]);
  const isObserver = useMemo(() => roleCode === EXTENDED_ROLES.Observer, [roleCode]);
  const assignedLocations = useMemo(() => {
    const locs = userProfile?.cgmp_assignedlocations ?? '';
    return locs ? locs.split(';').map(l => l.trim()).filter(Boolean) : [];
  }, [userProfile]);
  const canEdit = useMemo(() => roleCode !== EXTENDED_ROLES.Observer, [roleCode]);

  const contextValue = useMemo(() => ({
    userProfile, userLoading, currentUserName, currentUserUpn,
    isAdmin, isPMO, isITOps, isISM, isGIICC, isObserver, assignedLocations, canEdit,
    theme, toggleTheme,
    toasts, showToast, dismissToast,
    notificationPanelOpen, openNotificationPanel, closeNotificationPanel,
    activePage, navigate, setNavigationGuard, logout,
  }), [
    userProfile, userLoading, currentUserName, currentUserUpn,
    isAdmin, isPMO, isITOps, isISM, isGIICC, isObserver, assignedLocations, canEdit,
    theme, toggleTheme,
    toasts, showToast, dismissToast,
    notificationPanelOpen, openNotificationPanel, closeNotificationPanel,
    activePage, navigate, setNavigationGuard, logout,
  ]);

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

export function useToast() {
  const { showToast } = useApp();
  return showToast;
}
