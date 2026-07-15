import React, { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { EXTENDED_ROLES } from '../utils/roles';

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  section?: string;
}

const Icon = ({ path, size = 16 }: { path: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
    <path d={path} />
  </svg>
);

const ICONS: Record<string, string> = {
  dashboard: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  pmo: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM9 13h6v2H9zm0-3h6v2H9zm0 6h4v2H9z',
  itops: 'M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z',
  ism: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
  giicc: 'M13 10V3L4 14h7v7l9-11h-7z',
  project: 'M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z',
  attachment: 'M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z',
  knowledge: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  reports: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z',
  powerbi: 'M11 2v20c-5.07-.5-9-4.79-9-10s3.93-9.5 9-10zm2.03 0v8.99H22c-.47-4.74-4.24-8.52-8.97-8.99zm0 11.01V22c4.74-.47 8.5-4.25 8.97-8.99h-8.97z',
  heatmap: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
  leaderboard: 'M7.5 21H2V9h5.5v12zm7.25-18h-5.5v18h5.5V3zM22 11h-5.5v10H22V11z',
  audit: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z',
  archive: 'M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM6.24 5h11.52l.83 1H5.42l.82-1zM5 19V8h14v11H5z',
  notification: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
  settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  security: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z',
  bell_prefs: 'M4.5 6.375a4.125 4.125 0 1 1 8.25 0 4.125 4.125 0 0 1-8.25 0ZM14.25 8.625a3.375 3.375 0 1 1 6.75 0 3.375 3.375 0 0 1-6.75 0ZM1.5 19.125a7.125 7.125 0 0 1 14.25 0v.003l-.001.119a.75.75 0 0 1-.363.63 13.067 13.067 0 0 1-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 0 1-.364-.63l-.001-.122ZM17.25 19.128l-.001.144a2.25 2.25 0 0 1-.233.96 10.088 10.088 0 0 0 5.06-1.01.75.75 0 0 0 .42-.643 4.875 4.875 0 0 0-6.957-4.611 8.586 8.586 0 0 1 1.71 5.157v.003Z',
  templates: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
  blackout: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
  rules: 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
  scheduling: 'M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z',
  capacity: 'M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z',
  'admin-dash': 'M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm3 18H5V8h14v11z',
  tasks: 'M22 9V7h-2V5c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2v-2h-2V9h2zm-4 10H4V5h14v14zM6 13h5v4H6zm6-6h4v3h-4zM6 7h5v5H6zm6 4h4v6h-4z',
};

interface NavItemDef extends NavItem {
  roles?: number[]; // if undefined = visible to all roles
}

const ALL_NAV_ITEMS: NavItemDef[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <Icon path={ICONS.dashboard} /> },
  { id: 'pmo', label: 'PMO Workspace', icon: <Icon path={ICONS.pmo} />, section: 'WORKSPACES', roles: [100000000, 100000001] },
  { id: 'itops', label: 'IT Ops Workspace', icon: <Icon path={ICONS.itops} />, roles: [100000000, 100000002] },
  { id: 'ism', label: 'ISM Workspace', icon: <Icon path={ICONS.ism} />, roles: [100000000, 100000003] },
  { id: 'giicc', label: 'GIICC Command Center', icon: <Icon path={ICONS.giicc} />, roles: [100000000, 100000004] },
  { id: 'project', label: 'Project Repository', icon: <Icon path={ICONS.project} />, section: 'REPOSITORIES' },
  { id: 'attachment', label: 'Attachment Repository', icon: <Icon path={ICONS.attachment} /> },
  { id: 'knowledge', label: 'Knowledge Base', icon: <Icon path={ICONS.knowledge} /> },
  { id: 'reports', label: 'Reports', icon: <Icon path={ICONS.reports} />, section: 'ANALYTICS & REPORTS', roles: [100000000, 100000001, 100000003] },
  { id: 'powerbi', label: 'Power BI Analytics', icon: <Icon path={ICONS.powerbi} />, roles: [100000000, 100000001, 100000003] },
  { id: 'heatmap', label: 'Heat Maps', icon: <Icon path={ICONS.heatmap} /> },
  { id: 'leaderboard', label: 'Leaderboards', icon: <Icon path={ICONS.leaderboard} />, roles: [100000000, 100000003] },
  { id: 'audit', label: 'Audit Center', icon: <Icon path={ICONS.audit} />, section: 'GOVERNANCE', roles: [100000000] },
  { id: 'archive', label: 'Archive Center', icon: <Icon path={ICONS.archive} /> },
  { id: 'notification-center', label: 'Notification Center', icon: <Icon path={ICONS.notification} /> },
  { id: 'settings', label: 'Settings', icon: <Icon path={ICONS.settings} />, section: 'SETTINGS' },
  { id: 'security', label: 'Security & Roles', icon: <Icon path={ICONS.security} />, roles: [100000000] },
  { id: 'notif-prefs', label: 'Notification Preferences', icon: <Icon path={ICONS.bell_prefs} /> },
  { id: 'notification-rules', label: 'Notification Rules', icon: <Icon path={ICONS.rules} /> },
  { id: 'change-templates', label: 'Change Templates', icon: <Icon path={ICONS.templates} />, section: 'ADMIN', roles: [100000000] },
  { id: 'blackout-calendar', label: 'Blackout Calendar', icon: <Icon path={ICONS.blackout} />, roles: [100000000] },
  { id: 'admin-dashboard', label: 'Admin Dashboard', icon: <Icon path={ICONS['admin-dash']} />, roles: [100000000] },
  { id: 'tasks', label: 'Task Manager', icon: <Icon path={ICONS.tasks} />, section: 'TOOLS' },
  { id: 'scheduling', label: 'Scheduling Calendar', icon: <Icon path={ICONS.scheduling} /> },
  { id: 'capacity-planning', label: 'Capacity Planning', icon: <Icon path={ICONS.capacity} />, roles: [100000000, 100000001, 100000003] },
];

interface SidebarProps {
  activePage: string;
  onNavigate: (page: string) => void;
  collapsed: boolean;
  onToggle: () => void;
  unreadCount: number;
}

export default function Sidebar({ activePage, onNavigate, collapsed, onToggle, unreadCount }: SidebarProps) {
  const { userProfile, userLoading, isITOps, isObserver, assignedLocations } = useApp();
  const userRole = userProfile ? (userProfile.cgmp_role as unknown as number) : null;

  const navItems = useMemo(() => {
    if (userLoading || userRole === null) return ALL_NAV_ITEMS.filter(item => !item.roles);
    // Observer sees all items (read-only enforced at component level)
    if (userRole === EXTENDED_ROLES.Observer) return ALL_NAV_ITEMS;
    // ISMDeputy gets same access as ISM
    if (userRole === EXTENDED_ROLES.ISMDeputy) {
      return ALL_NAV_ITEMS.filter(item => !item.roles || item.roles.includes(100000003) || item.roles.includes(100000000));
    }
    // DeptAdmin gets same access as Admin
    if (userRole === EXTENDED_ROLES.DeptAdmin) return ALL_NAV_ITEMS;
    return ALL_NAV_ITEMS.filter(item => !item.roles || item.roles.includes(userRole));
  }, [userRole, userLoading]);

  return (
    <aside id="sidebar-nav" className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <div className="sidebar__logo">
        <div className="sidebar__logo-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
          </svg>
        </div>
        {!collapsed && (
          <span className="sidebar__logo-text">Global Change<br />Governance</span>
        )}
      </div>

      {!collapsed && (isITOps || isObserver) && (
        <div style={{ padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {isObserver && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: 'rgba(255,165,0,0.18)', color: '#ffad00', border: '1px solid rgba(255,165,0,0.3)', textAlign: 'center', letterSpacing: '0.04em' }}>
              READ-ONLY
            </span>
          )}
          {isITOps && assignedLocations.length > 0 && (() => {
            const lbl = assignedLocations.join('; ');
            const truncated = lbl.length > 30 ? lbl.slice(0, 27) + '…' : lbl;
            return (
              <span
                style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 12, background: 'rgba(0,120,212,0.12)', color: 'var(--primary)', border: '1px solid rgba(0,120,212,0.2)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={lbl}
              >
                Location: {truncated}
              </span>
            );
          })()}
        </div>
      )}

      <nav className="sidebar__nav" aria-label="Main navigation">
        {navItems.map(item => (
          <React.Fragment key={item.id}>
            {item.section && !collapsed && (
              <div className="sidebar__section-label">{item.section}</div>
            )}
            {item.section && collapsed && <div className="sidebar__section-divider" />}
            <button
              className={`sidebar__item ${activePage === item.id ? 'sidebar__item--active' : ''}`}
              onClick={() => onNavigate(item.id)}
              aria-current={activePage === item.id ? 'page' : undefined}
            >
              <span className="sidebar__item-icon">{item.icon}</span>
              {!collapsed && <span className="sidebar__item-label">{item.label}</span>}
              <span className="sidebar__tooltip">{item.label}</span>
              {item.id === 'notification-center' && unreadCount > 0 && (
                <span className="sidebar__badge" aria-label={`${unreadCount > 99 ? '99+' : unreadCount} unread notifications`}>{unreadCount > 99 ? '99+' : unreadCount}</span>
              )}
            </button>
          </React.Fragment>
        ))}
      </nav>

      <button className="sidebar__collapse-btn" onClick={onToggle} title={collapsed ? 'Expand' : 'Collapse'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          {collapsed
            ? <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
            : <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z" />}
        </svg>
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}
