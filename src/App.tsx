import { useState, useEffect, lazy, Suspense, useMemo, type LazyExoticComponent, type FC } from 'react';
import './App.css';
import { AppProvider, useApp } from './context/AppContext';
import { UserProfilesProvider } from './context/UserProfilesContext';
import { ChangesProvider } from './context/ChangesContext';
import { FeatureFlagsProvider } from './context/FeatureFlagsContext';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import SessionExpiredBanner from './components/ui/SessionExpiredBanner';
import { OfflineBanner } from './components/ui/OfflineBanner';
// Shell components — always needed, kept eager
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import RightPanel from './components/RightPanel';
import NotificationPanel from './components/NotificationPanel';
import ToastContainer from './components/ui/Toast';
import { useNotifications } from './hooks/useDataverse';
import { ROLE_LABEL, EXTENDED_ROLE_LABEL, ROLES, EXTENDED_ROLES } from './utils/roles';
import { initAppInsights, trackPageView, setUser } from './utils/appInsights';
import { DeptAdminWorkspace } from './components/admin/DeptAdminWorkspace';

// Prefetch map — calling these on Sidebar hover pre-warms the chunk before navigation
const PREFETCH_MAP: Partial<Record<string, () => Promise<unknown>>> = {
  dashboard: () => import('./components/Dashboard'),
  pmo: () => import('./components/pmo/PMOWorkspace'),
  itops: () => import('./components/itops/ITOpsWorkspace'),
  ism: () => import('./components/ism/ISMWorkspace'),
  giicc: () => import('./components/giicc/GIICCCommandCenter'),
  project: () => import('./components/modules/ProjectRepository'),
  'notification-center': () => import('./components/modules/NotificationCenter'),
  audit: () => import('./components/modules/AuditCenter'),
  knowledge: () => import('./components/modules/KnowledgeBase'),
  archive: () => import('./components/modules/ArchiveCenter'),
  reports: () => import('./components/modules/Reports'),
  settings: () => import('./components/settings/Settings'),
  security: () => import('./components/settings/SecurityRoles'),
  'notif-prefs': () => import('./components/settings/NotificationPreferences'),
  leaderboard: () => import('./components/modules/Leaderboard'),
  heatmap: () => import('./components/modules/HeatMap'),
  attachment: () => import('./components/modules/AttachmentRepository'),
  powerbi: () => import('./components/modules/PowerBIAnalytics'),
  'change-templates': () => import('./components/admin/ChangeTemplates'),
  'blackout-calendar': () => import('./components/admin/BlackoutCalendar'),
  'notification-rules': () => import('./components/admin/NotificationRules'),
  scheduling: () => import('./components/modules/SchedulingCalendar'),
  'capacity-planning': () => import('./components/modules/CapacityPlanning'),
  'admin-dashboard': () => import('./components/admin/AdminDashboard'),
  tasks: () => import('./components/modules/TaskManager'),
};

// Workspace components — lazy-loaded on first navigation to reduce initial bundle size
const Dashboard = lazy(() => import('./components/Dashboard'));
const PMOWorkspace = lazy(() => import('./components/pmo/PMOWorkspace'));
const ITOpsWorkspace = lazy(() => import('./components/itops/ITOpsWorkspace'));
const ISMWorkspace = lazy(() => import('./components/ism/ISMWorkspace'));
const GIICCCommandCenter = lazy(() => import('./components/giicc/GIICCCommandCenter'));
const ProjectRepository = lazy(() => import('./components/modules/ProjectRepository'));
const NotificationCenter = lazy(() => import('./components/modules/NotificationCenter'));
const AuditCenter = lazy(() => import('./components/modules/AuditCenter'));
const KnowledgeBase = lazy(() => import('./components/modules/KnowledgeBase'));
const ArchiveCenter = lazy(() => import('./components/modules/ArchiveCenter'));
const Reports = lazy(() => import('./components/modules/Reports'));
const Settings = lazy(() => import('./components/settings/Settings'));
const SecurityRoles = lazy(() => import('./components/settings/SecurityRoles'));
const NotificationPreferences = lazy(() => import('./components/settings/NotificationPreferences'));
const Leaderboard = lazy(() => import('./components/modules/Leaderboard'));
const HeatMap = lazy(() => import('./components/modules/HeatMap'));
const AttachmentRepository = lazy(() => import('./components/modules/AttachmentRepository'));
const PowerBIAnalytics = lazy(() => import('./components/modules/PowerBIAnalytics'));
const BlackoutCalendar = lazy(() => import('./components/admin/BlackoutCalendar'));
const ChangeTemplates = lazy(() => import('./components/admin/ChangeTemplates'));
const NotificationRules = lazy(() => import('./components/admin/NotificationRules'));
const SchedulingCalendar = lazy(() => import('./components/modules/SchedulingCalendar'));
const CapacityPlanning = lazy(() => import('./components/modules/CapacityPlanning'));
const AdminDashboard = lazy(() => import('./components/admin/AdminDashboard'));
const TaskManager = lazy(() => import('./components/modules/TaskManager'));

function WorkspaceLoadingFallback() {
  return (
    <div style={{ padding: 24, width: '100%' }} role="status" aria-label="Loading workspace…">
      <div className="skeleton" style={{ height: 48, borderRadius: 8, marginBottom: 16 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[0,1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 88, borderRadius: 8 }} />)}
      </div>
      <div className="skeleton" style={{ height: 320, borderRadius: 8 }} />
    </div>
  );
}

function WorkspacePage({ title, sub, variant }: { title: string; sub?: string; variant?: 'denied' | 'construction' | 'not-found' }) {
  const { navigate, userProfile } = useApp();
  const roleCode = Number(userProfile?.cgmp_role ?? -1);
  const roleLabel = ROLE_LABEL[roleCode] ?? EXTENDED_ROLE_LABEL[roleCode] ?? 'Unknown';

  if (variant === 'denied') {
    return (
      <div className="workspace-placeholder workspace-placeholder--denied" role="alert">
        <span aria-hidden="true" style={{ fontSize: 48 }}>🔒</span>
        <h2>Access Denied</h2>
        <p>Your role does not have permission to access this workspace.</p>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Current role: <strong>{roleLabel}</strong> — contact your administrator to request access.
        </p>
      </div>
    );
  }
  if (variant === 'construction') {
    return (
      <div className="workspace-placeholder workspace-placeholder--construction">
        <span aria-hidden="true" style={{ fontSize: 48 }}>🚧</span>
        <h2>Coming Soon</h2>
        <p>This workspace is under development and will be available in a future update.</p>
      </div>
    );
  }
  if (variant === 'not-found') {
    return (
      <div className="workspace-placeholder workspace-placeholder--not-found">
        <span aria-hidden="true" style={{ fontSize: 48 }}>🔍</span>
        <h2>Page Not Found</h2>
        <p>The page you're looking for doesn't exist or has been moved.</p>
        <button className="btn btn--outline" onClick={() => navigate('dashboard')}>
          Return to Dashboard
        </button>
      </div>
    );
  }
  // Default fallback — no variant
  return (
    <div className="workspace-placeholder">
      <span aria-hidden="true" style={{ fontSize: 48 }}>🔧</span>
      <div className="workspace-placeholder__title">{title}</div>
      {sub != null && <div className="workspace-placeholder__sub">{sub}</div>}
    </div>
  );
}

const ROUTES: Record<string, LazyExoticComponent<FC>> = {
  dashboard: Dashboard,
  pmo: PMOWorkspace,
  itops: ITOpsWorkspace,
  ism: ISMWorkspace,
  giicc: GIICCCommandCenter,
  project: ProjectRepository,
  'notification-center': NotificationCenter,
  audit: AuditCenter,
  knowledge: KnowledgeBase,
  archive: ArchiveCenter,
  reports: Reports,
  settings: Settings,
  security: SecurityRoles,
  'notif-prefs': NotificationPreferences,
  leaderboard: Leaderboard,
  heatmap: HeatMap,
  attachment: AttachmentRepository,
  powerbi: PowerBIAnalytics,
  'change-templates': ChangeTemplates,
  'blackout-calendar': BlackoutCalendar,
  'notification-rules': NotificationRules,
  scheduling: SchedulingCalendar,
  'capacity-planning': CapacityPlanning,
  'admin-dashboard': AdminDashboard,
  tasks: TaskManager,
};

const WORKSPACE_NAMES = {
  dashboard: 'Dashboard',
  pmo: 'PMO Workspace',
  itops: 'IT Ops',
  ism: 'ISM Workspace',
  giicc: 'GIICC Command Center',
  project: 'Project Repository',
  'notification-center': 'Notification Center',
  audit: 'Audit Center',
  knowledge: 'Knowledge Base',
  archive: 'Archive Center',
  reports: 'Reports',
  settings: 'Settings',
  security: 'Security & Roles',
  'notif-prefs': 'Notification Preferences',
  leaderboard: 'Leaderboards',
  heatmap: 'Heat Maps',
  attachment: 'Attachment Repository',
  powerbi: 'Power BI Analytics',
  'change-templates': 'Change Templates',
  'blackout-calendar': 'Blackout Calendar',
  'notification-rules': 'Notification Rules',
  scheduling: 'Scheduling Calendar',
  'capacity-planning': 'Capacity Planning',
  'admin-dashboard': 'Admin Dashboard',
  tasks: 'Task Manager',
} as const;
type WorkspaceName = keyof typeof WORKSPACE_NAMES;

const PAGE_LABELS: Record<string, { title: string; section: string }> = {
  dashboard: { section: 'Home', title: 'Dashboard' },
  pmo: { section: 'Workspaces', title: 'PMO Workspace' },
  itops: { section: 'Workspaces', title: 'IT Ops Workspace' },
  ism: { section: 'Workspaces', title: 'ISM Workspace' },
  giicc: { section: 'Workspaces', title: 'GIICC Command Center' },
  project: { section: 'Modules', title: 'Project Repository' },
  attachment: { section: 'Modules', title: 'Attachment Repository' },
  knowledge: { section: 'Modules', title: 'Knowledge Base' },
  reports: { section: 'Modules', title: 'Reports' },
  powerbi: { section: 'Modules', title: 'Power BI Analytics' },
  heatmap: { section: 'Modules', title: 'Heat Maps' },
  leaderboard: { section: 'Modules', title: 'Leaderboards' },
  audit: { section: 'Modules', title: 'Audit Center' },
  archive: { section: 'Modules', title: 'Archive Center' },
  'notification-center': { section: 'Modules', title: 'Notification Center' },
  settings: { section: 'Settings', title: 'Settings' },
  security: { section: 'Settings', title: 'Security & Roles' },
  'notif-prefs': { section: 'Settings', title: 'Notification Preferences' },
  'change-templates': { section: 'Admin', title: 'Change Templates' },
  'blackout-calendar': { section: 'Admin', title: 'Blackout Calendar' },
  'notification-rules': { section: 'Settings', title: 'Notification Rules' },
  'scheduling': { section: 'Modules', title: 'Scheduling Calendar' },
  'capacity-planning': { section: 'Modules', title: 'Capacity Planning' },
  'admin-dashboard': { section: 'Admin', title: 'Admin Dashboard' },
  'tasks': { section: 'Modules', title: 'Task Manager' },
};

const SECTION_ROUTES: Record<string, string> = {
  Home: 'dashboard',
  Workspaces: 'pmo',
  Repositories: 'project',
  Modules: 'project',
  'Analytics & Reports': 'reports',
  Governance: 'audit',
  Settings: 'settings',
  Admin: 'admin-dashboard',
};

function Breadcrumb({ activePage }: { activePage: string }) {
  const { navigate } = useApp();
  const info = PAGE_LABELS[activePage];
  if (!info || activePage === 'dashboard') return null;
  const sectionRoute = SECTION_ROUTES[info.section] ?? 'dashboard';
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <button
        className="breadcrumb__item breadcrumb__item--link"
        onClick={() => navigate(sectionRoute)}
        aria-label={`Go to ${info.section}`}
      >
        {info.section}
      </button>
      <svg className="breadcrumb__sep" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
      </svg>
      <button
        className="breadcrumb__item breadcrumb__item--link breadcrumb__item--current"
        aria-current="page"
        onClick={() => navigate(activePage)}
        title="Click to refresh this page"
      >
        {info.title}
      </button>
    </nav>
  );
}


const VALID_ROLES = new Set<number>([...Object.values(ROLES), ...Object.values(EXTENDED_ROLES)]);

function NoRolePage() {
  return (
    <div className="no-role-page">
      <div className="no-role-card">
        <div className="no-role-icon" aria-hidden="true">🔒</div>
        <h1 className="no-role-title">Access Restricted</h1>
        <p className="no-role-lead">
          You currently do not have permission to access this application.
        </p>
        <p className="no-role-body">
          Your account has been successfully authenticated; however, no security role has been
          assigned to grant access to this application.
        </p>

        <div className="no-role-steps">
          <div className="no-role-steps__title">What can you do next?</div>
          <ul className="no-role-steps__list">
            <li><span className="no-role-steps__icon">📧</span> Contact your <strong>Supervisor or Cluster Lead</strong>.</li>
            <li><span className="no-role-steps__icon">📝</span> Request the appropriate <strong>application access and security role assignment</strong>.</li>
            <li><span className="no-role-steps__icon">⏱️</span> Once access is granted, please <strong>sign out and sign back in</strong> to continue.</li>
          </ul>
        </div>

        <div className="no-role-assist">
          <div className="no-role-assist__title">Need Assistance?</div>
          <p className="no-role-assist__body">
            If you believe this is an error or you require urgent access, please reach out to your
            designated <strong>support team</strong> or <strong>application administrator</strong>.
          </p>
        </div>

        <div className="no-role-ref">
          Error Reference: <code>NO_ROLE_ASSIGNED</code>
        </div>
      </div>
    </div>
  );
}

function AppContent() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 768);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(() => {
    try { return localStorage.getItem('rp-collapsed') === '1'; } catch { return false; }
  });
  const { theme, toggleTheme, notificationPanelOpen, openNotificationPanel, closeNotificationPanel, activePage, navigate, userProfile, userLoading, currentUserName, currentUserUpn } = useApp();

  /* Initialise App Insights once and track page views + user identity */
  useEffect(() => { initAppInsights(); }, []);
  useEffect(() => { if (currentUserUpn) setUser(currentUserUpn); }, [currentUserUpn]);
  useEffect(() => { trackPageView(activePage); }, [activePage]);
  const { notifications, loading: notifLoading, unreadCount, refresh: refreshNotifs } = useNotifications(userProfile?.cgmp_userprofileid);
  const highPriorityUnread = useMemo(() =>
    notifications.filter(n => !n.cgmp_isread && (n.cgmp_priority as unknown as number) === 100000000).length,
    [notifications]
  );

  /* Update sidebar collapsed state on window resize */
  useEffect(() => {
    const handler = () => setSidebarCollapsed(window.innerWidth <= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const userRole = useMemo(() => {
    const r = Number(userProfile?.cgmp_role);
    return ROLE_LABEL[r] ?? 'User';
  }, [userProfile]);

  /* Block access for authenticated users with no assigned role */
  const hasNoRole = !userLoading && !VALID_ROLES.has(Number(userProfile?.cgmp_role));
  if (hasNoRole) return <NoRolePage />;

  function renderContent() {
    // DeptAdmin (100000007) has department-scoped visibility — route them to their
    // own workspace when they navigate to the admin dashboard, since the global
    // AdminDashboard restricts access to the full Admin role only.
    if (Number(userProfile?.cgmp_role) === EXTENDED_ROLES.DeptAdmin && activePage === 'admin-dashboard') {
      return <ErrorBoundary workspaceName="Department Admin Workspace"><DeptAdminWorkspace /></ErrorBoundary>;
    }
    const Component = ROUTES[activePage];
    if (!Component) return <WorkspacePage title="Page Not Found" sub="This section is not yet available" variant="not-found" />;
    const name: string = activePage in WORKSPACE_NAMES
      ? WORKSPACE_NAMES[activePage as WorkspaceName]
      : activePage;
    return <ErrorBoundary workspaceName={name}><Component /></ErrorBoundary>;
  }

  return (
    <div className="app">
      <OfflineBanner />
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <a href="#right-panel" className="skip-link">Skip to right panel</a>
      <Header
        unreadCount={unreadCount}
        highPriorityUnread={highPriorityUnread}
        theme={theme}
        onThemeToggle={toggleTheme}
        onOpenNotificationPanel={openNotificationPanel}
        onToggleSidebar={() => setSidebarCollapsed(c => !c)}
        sidebarExpanded={!sidebarCollapsed}
        userName={currentUserName}
        userRole={userRole}
      />
      <div className="app-body">
        {!sidebarCollapsed && (
          <div className="sidebar-overlay sidebar-overlay--visible" role="button" tabIndex={0} aria-label="Close sidebar" onClick={() => setSidebarCollapsed(true)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSidebarCollapsed(true); } }} />
        )}
        <Sidebar
          activePage={activePage}
          onNavigate={(page) => {
            navigate(page);
            if (window.innerWidth <= 768) setSidebarCollapsed(true);
          }}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(c => !c)}
          unreadCount={unreadCount}
          onPrefetch={(page) => { void PREFETCH_MAP[page]?.(); }}
        />
        <main id="main-content" className="main-content">
          <Breadcrumb activePage={activePage} />
          <Suspense fallback={<WorkspaceLoadingFallback />}>
            {renderContent()}
          </Suspense>
        </main>
        <RightPanel
          collapsed={rightPanelCollapsed}
          onToggleCollapse={() => {
            setRightPanelCollapsed(c => {
              const next = !c;
              try { localStorage.setItem('rp-collapsed', next ? '1' : '0'); } catch {}
              return next;
            });
          }}
        />
      </div>
      <NotificationPanel
        open={notificationPanelOpen}
        onClose={closeNotificationPanel}
        notifications={notifications}
        loading={notifLoading}
        unreadCount={unreadCount}
        onRefresh={refreshNotifs}
      />
      <ToastContainer />
      <SessionExpiredBanner />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <FeatureFlagsProvider>
        <UserProfilesProvider>
          <ChangesProvider>
            <AppContent />
          </ChangesProvider>
        </UserProfilesProvider>
      </FeatureFlagsProvider>
    </AppProvider>
  );
}
