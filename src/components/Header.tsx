import { useState, useEffect, useRef, useMemo, useCallback, useId } from 'react';
import { useApp } from '../context/AppContext';
import { useChangeList, useProjects } from '../hooks/useDataverse';
import { statusLabel, statusColor } from '../utils/roles';
import type { Cgmp_changes } from '../generated/models/Cgmp_changesModel';
import type { Cgmp_projects } from '../generated/models/Cgmp_projectsModel';

/* ── Recent pages helpers ── */
const RECENT_PAGES_KEY = 'cgmp-recent-pages';
interface RecentPage { page: string; label: string; time: number; }

const PAGE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard', pmo: 'PMO Workspace', itops: 'IT Ops Workspace',
  ism: 'ISM Workspace', giicc: 'GIICC Command Center', knowledge: 'Knowledge Base',
  reports: 'Reports', 'scheduling-calendar': 'Scheduling Calendar', tasks: 'Task Manager',
  settings: 'Settings', admin: 'Admin Dashboard', project: 'Project Repository',
  attachment: 'Attachment Repository', powerbi: 'Power BI Analytics', heatmap: 'Heat Maps',
  leaderboard: 'Leaderboards', audit: 'Audit Center', archive: 'Archive Center',
  'notification-center': 'Notification Center', security: 'Security & Roles',
  'notif-prefs': 'Notification Preferences', 'notification-rules': 'Notification Rules',
  'change-templates': 'Change Templates', 'blackout-calendar': 'Blackout Calendar',
};

function loadRecentPages(): RecentPage[] {
  try {
    const raw = localStorage.getItem(RECENT_PAGES_KEY);
    if (raw) return JSON.parse(raw) as RecentPage[];
  } catch { /* ignore */ }
  return [];
}

function saveRecentPage(page: string): void {
  try {
    const label = PAGE_LABELS[page] ?? page;
    const existing = loadRecentPages().filter(p => p.page !== page);
    const updated: RecentPage[] = [{ page, label, time: Date.now() }, ...existing].slice(0, 5);
    localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(updated));
  } catch { /* ignore */ }
}

interface HeaderProps {
  unreadCount: number;
  highPriorityUnread?: number;
  theme: 'light' | 'dark';
  onThemeToggle: () => void;
  onOpenNotificationPanel: () => void;
  onToggleSidebar: () => void;
  sidebarExpanded: boolean;
  userName: string;
  userRole: string;
}

/* ── Search overlay (loaded lazily when user types) ── */
const PMO_FILTER_KEY = 'pmo-changelist-filters';
const PMO_FILTER_DEFAULTS = { search: '', status: '', risk: '', category: '', dateRange: 'all', customFrom: '', customTo: '' };

type NavResult = { page: string; sub: string; label: string };

const NAVIGATE_COMMANDS = [
  { page: 'dashboard', label: 'Dashboard', shortcut: '' },
  { page: 'pmo', label: 'PMO Workspace', shortcut: '' },
  { page: 'itops', label: 'IT Ops Workspace', shortcut: '' },
  { page: 'ism', label: 'ISM Workspace', shortcut: '' },
  { page: 'giicc', label: 'GIICC Command Center', shortcut: '' },
  { page: 'knowledge', label: 'Knowledge Base', shortcut: '' },
  { page: 'reports', label: 'Reports', shortcut: '' },
  { page: 'scheduling-calendar', label: 'Scheduling Calendar', shortcut: '' },
  { page: 'tasks', label: 'Task Manager', shortcut: '' },
  { page: 'settings', label: 'Settings', shortcut: '' },
  { page: 'security', label: 'Security & Roles', shortcut: '' },
];

const CREATE_COMMANDS = [
  { page: 'pmo', label: 'New Change Request', hint: 'Then use the + button' },
  { page: 'tasks', label: 'New Task', hint: '' },
  { page: 'knowledge', label: 'New Knowledge Base Article', hint: '' },
];

const OBSERVER_ROLE = 100000005;

function CommandPalette({ onNavigate, onClose, listboxId, onOpenNotificationPanel }: {
  onNavigate: (page: string, searchTerm?: string) => void;
  onClose: () => void;
  listboxId: string;
  onOpenNotificationPanel: () => void;
}) {
  const { userProfile } = useApp();
  const userRole = Number(userProfile?.cgmp_role ?? -1);
  const isObserver = userRole === OBSERVER_ROLE;

  const ACTIONS = [
    ...(!isObserver ? [{ label: 'New Emergency Change', icon: '🚨', action: () => { onNavigate('pmo'); onClose(); } }] : []),
    { label: 'Mark All Notifications Read', icon: '✓', action: () => { onOpenNotificationPanel(); onClose(); } },
    { label: 'Export Change List', icon: '⬇', action: () => { onNavigate('pmo'); onClose(); } },
  ];

  const [recentPages, setRecentPages] = useState<RecentPage[]>([]);
  useEffect(() => { setRecentPages(loadRecentPages()); }, []);

  return (
    <div id={listboxId} className="search-overlay" role="listbox" aria-label="Command palette" style={{ maxHeight: 420, overflowY: 'auto' }}>
      {recentPages.length > 0 && (
        <>
          <div style={{ padding: '6px 12px 4px', fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.08em' }}>RECENT</div>
          {recentPages.map((r, i) => (
            <div key={i} role="option" tabIndex={-1} aria-selected={false} className="search-result" onClick={() => { onNavigate(r.page); onClose(); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate(r.page); onClose(); } }}>
              <span className="search-result__type">Recent</span>
              <span className="search-result__label">{r.label}</span>
            </div>
          ))}
        </>
      )}
      <div style={{ padding: '6px 12px 4px', fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.08em' }}>NAVIGATE</div>
      {NAVIGATE_COMMANDS.map((cmd, i) => (
        <div key={i} role="option" tabIndex={-1} aria-selected={false} className="search-result" onClick={() => { onNavigate(cmd.page); onClose(); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate(cmd.page); onClose(); } }}>
          <span className="search-result__type">Page</span>
          <span className="search-result__label">{cmd.label}</span>
          {cmd.shortcut && <span className="search-result__sub">{cmd.shortcut}</span>}
        </div>
      ))}
      <div style={{ padding: '6px 12px 4px', fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.08em' }}>CREATE</div>
      {CREATE_COMMANDS.map((cmd, i) => (
        <div key={i} role="option" tabIndex={-1} aria-selected={false} className="search-result" onClick={() => { onNavigate(cmd.page); onClose(); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate(cmd.page); onClose(); } }}>
          <span className="search-result__type">Action</span>
          <span className="search-result__label">{cmd.label}</span>
          {cmd.hint && <span className="search-result__sub">{cmd.hint}</span>}
        </div>
      ))}
      <div style={{ padding: '6px 12px 4px', fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.08em' }}>ACTIONS</div>
      {ACTIONS.map((a, i) => (
        <div key={i} role="option" tabIndex={-1} aria-selected={false} className="search-result" onClick={a.action} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); a.action(); } }}>
          <span className="search-result__type" aria-hidden="true">{a.icon}</span>
          <span className="search-result__label">{a.label}</span>
        </div>
      ))}
      <div className="search-footer">
        <kbd>Ctrl+K</kbd> command palette · <kbd>Ctrl+?</kbd> shortcuts · <kbd>Esc</kbd> close
      </div>
    </div>
  );
}

function KeyboardShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const shortcuts = [
    { keys: 'Ctrl+K', desc: 'Open command palette' },
    { keys: 'Ctrl+?', desc: 'Show keyboard shortcuts' },
    { keys: 'Escape', desc: 'Close overlay / menu' },
    { keys: '↑ / ↓', desc: 'Navigate search results' },
    { keys: 'Enter', desc: 'Select focused result' },
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg, 12px)', padding: 24, minWidth: 340, boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Keyboard Shortcuts</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {shortcuts.map(s => (
              <tr key={s.keys} style={{ borderBottom: '1px solid var(--border-light)' }}>
                <td style={{ padding: '8px 12px 8px 0' }}>
                  <kbd style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', fontSize: 12, fontFamily: 'monospace' }}>{s.keys}</kbd>
                </td>
                <td style={{ padding: '8px 0', fontSize: 14, color: 'var(--text-primary)' }}>{s.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button className="btn btn--sm btn--outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function SearchOverlay({ query, onNavigate, onClose, onFirstResult, listboxId, changes, projects, focusedIdx, onResultsUpdate }: { query: string; onNavigate: (page: string, searchTerm?: string) => void; onClose: () => void; onFirstResult?: (result: { type: string; page: string } | null) => void; listboxId: string; changes: Cgmp_changes[]; projects: Cgmp_projects[]; focusedIdx: number; onResultsUpdate: (results: NavResult[]) => void }) {
  const results = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (q.length < 2) return [];

    const changeHits = changes
      .filter(c => c.cgmp_title?.toLowerCase().includes(q) || c.cgmp_changenumber?.toLowerCase().includes(q))
      .slice(0, 5)
      .map((c: Cgmp_changes) => ({ type: 'change' as const, displayType: 'Change', label: c.cgmp_title ?? c.cgmp_changenumber ?? '', sub: c.cgmp_changenumber ?? '', status: statusLabel(c.cgmp_status as unknown as number), statusClass: statusColor(c.cgmp_status as unknown as number), page: 'pmo' as string }));

    const projHits = projects
      .filter(p => p.cgmp_name?.toLowerCase().includes(q) || p.cgmp_customer?.toLowerCase().includes(q))
      .slice(0, 3)
      .map((p: Cgmp_projects) => ({ type: 'project', displayType: 'Project', label: p.cgmp_name ?? '', sub: p.cgmp_region ?? p.cgmp_customer ?? '', page: 'project' as string }));

    return [...changeHits, ...projHits];
  }, [changes, projects, query]);

  useEffect(() => {
    onFirstResult?.(results.length > 0 ? { type: results[0].type, page: results[0].page } : null);
    onResultsUpdate(results);
  }, [results, onFirstResult, onResultsUpdate]);

  if (results.length === 0 && query.length >= 2) {
    return (
      <div id={listboxId} className="search-overlay" role="listbox" aria-label="Search results">
        <div className="search-empty">No results for "{query}"</div>
      </div>
    );
  }

  if (results.length === 0) return null;

  return (
    <div id={listboxId} className="search-overlay" role="listbox" aria-label="Search results">
      {results.map((r, i) => (
        <div key={i} id={`${listboxId}-option-${i}`} role="option" tabIndex={-1} aria-selected={i === focusedIdx} className={`search-result${i === focusedIdx ? ' header__search-result--focused' : ''}`} onClick={() => { onNavigate(r.page, r.sub || r.label); onClose(); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate(r.page, r.sub || r.label); onClose(); } }}>
          <span className="search-result__type">{r.displayType}</span>
          <span className="search-result__label">{r.label}</span>
          {r.type === 'change' ? (
            <div className="search-result-item__header">
              <span className="search-result-item__number">{r.sub}</span>
              {'status' in r && (r as unknown as { status: string; statusClass: string }).status && (
                <span className={`badge badge--status ${(r as unknown as { status: string; statusClass: string }).statusClass}`}>
                  {(r as unknown as { status: string; statusClass: string }).status}
                </span>
              )}
            </div>
          ) : (
            r.sub && <span className="search-result__sub">{r.sub}</span>
          )}
        </div>
      ))}
      <div className="search-footer">
        Press <kbd>Enter</kbd> to search all · <kbd>Esc</kbd> to close
      </div>
    </div>
  );
}

/* ── Lazy search data loader — only mounts after first search focus ── */
function SearchDataProvider({ onData }: { onData: (changes: Cgmp_changes[], projects: Cgmp_projects[]) => void }) {
  const { changes } = useChangeList();
  const { projects } = useProjects();
  useEffect(() => { onData(changes, projects); }, [changes, projects, onData]);
  return null;
}

export default function Header({ unreadCount, highPriorityUnread = 0, theme, onThemeToggle, onOpenNotificationPanel, onToggleSidebar, sidebarExpanded, userName, userRole }: HeaderProps) {
  const { navigate, logout } = useApp();
  const [searchActivated, setSearchActivated] = useState(false);
  const [searchData, setSearchData] = useState<{ changes: Cgmp_changes[]; projects: Cgmp_projects[] }>({ changes: [], projects: [] });
  const handleSearchData = useCallback((changes: Cgmp_changes[], projects: Cgmp_projects[]) => {
    setSearchData({ changes, projects });
  }, []);
  const [searchValue, setSearchValue] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Keep a ref in sync so the global keydown handler (with [] deps) can read it without stale closure
  useEffect(() => { userMenuOpenRef.current = userMenuOpen; }, [userMenuOpen]);
  const searchRef = useRef<HTMLInputElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userMenuBtnRef = useRef<HTMLButtonElement>(null);
  const firstMenuItemRef = useRef<HTMLButtonElement>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstSearchResultRef = useRef<{ type: string; page: string } | null>(null);
  const userMenuOpenRef = useRef(false);
  const searchId = useId();
  const searchListboxId = `${searchId}-listbox`;
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const searchResultsRef = useRef<NavResult[]>([]);
  const handleResultsUpdate = useCallback((results: NavResult[]) => {
    searchResultsRef.current = results;
  }, []);

  /* Cleanup blur timer on unmount */
  useEffect(() => () => { if (blurTimerRef.current) clearTimeout(blurTimerRef.current); }, []);

  const handleFirstResult = useCallback((result: { type: string; page: string } | null) => {
    firstSearchResultRef.current = result;
  }, []);

  /* Ctrl+K / Ctrl+? shortcuts */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '?') {
        e.preventDefault();
        setShowShortcuts(s => !s);
      }
      if (e.key === 'Escape') {
        setSearchValue('');
        setSearchFocused(false);
        setShowShortcuts(false);
        if (userMenuOpenRef.current) {
          setUserMenuOpen(false);
          userMenuBtnRef.current?.focus();
        }
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  /* Close user menu on outside click or touch */
  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    if (userMenuOpen) {
      document.addEventListener('mousedown', handler);
      document.addEventListener('touchstart', handler as EventListener);
    }
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler as EventListener);
    };
  }, [userMenuOpen]);

  /* Focus first menu item when user menu opens */
  useEffect(() => {
    if (userMenuOpen) firstMenuItemRef.current?.focus();
  }, [userMenuOpen]);

  const showSearchOverlay = searchFocused && searchValue.length >= 2;
  const showCommandPalette = searchFocused && searchValue.length === 0;

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIdx(i => Math.min(i + 1, searchResultsRef.current.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIdx(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      if (focusedIdx >= 0) {
        const result = searchResultsRef.current[focusedIdx];
        if (result) {
          handleSearchNavigate(result.page, result.sub || result.label);
          setSearchValue('');
          setSearchFocused(false);
          setFocusedIdx(-1);
        }
        return;
      }
      if (searchValue.trim()) {
        const first = firstSearchResultRef.current;
        if (!first) return;
        if (first.type === 'project') {
          navigate('project');
        } else {
          try { localStorage.setItem(PMO_FILTER_KEY, JSON.stringify({ ...PMO_FILTER_DEFAULTS, search: searchValue.trim() })); } catch {}
          navigate('pmo');
        }
        setSearchValue('');
        setSearchFocused(false);
      }
    }
  };

  const handleSearchNavigate = useCallback((page: string, searchTerm?: string) => {
    if (page === 'pmo' && searchTerm) {
      try { localStorage.setItem(PMO_FILTER_KEY, JSON.stringify({ ...PMO_FILTER_DEFAULTS, search: searchTerm })); } catch {}
    }
    saveRecentPage(page);
    navigate(page);
  }, [navigate]);

  return (
    <header className="header">
      <button className="header__hamburger" onClick={onToggleSidebar} aria-label="Toggle navigation" aria-expanded={sidebarExpanded} aria-controls="sidebar-nav">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
        </svg>
      </button>
      <div className="header__brand">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
          <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
        </svg>
        <div className="header__brand-text">
          <span className="header__brand-title">Global Change Governance &</span>
          <span className="header__brand-subtitle">Impact Management Platform</span>
        </div>
      </div>

      {/* Search */}
      <div className="header__search-wrap">
        <div className="header__search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#9E9E9E" aria-hidden="true">
            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
          <input
            ref={searchRef}
            id={searchId}
            className="header__search-input"
            type="search"
            role="combobox"
            aria-label="Search changes, projects, and users"
            aria-autocomplete="list"
            aria-expanded={showSearchOverlay || showCommandPalette}
            aria-controls={searchListboxId}
            aria-owns={searchListboxId}
            aria-activedescendant={showSearchOverlay && focusedIdx >= 0 ? `${searchListboxId}-option-${focusedIdx}` : undefined}
            placeholder="Search changes, projects, users… (Ctrl+K)"
            value={searchValue}
            onChange={e => { setSearchValue(e.target.value); setFocusedIdx(-1); }}
            onFocus={() => { setSearchFocused(true); setSearchActivated(true); }}
            onBlur={() => {
              if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
              blurTimerRef.current = setTimeout(() => setSearchFocused(false), 200);
            }}
            onKeyDown={handleSearchKeyDown}
          />
          {searchValue && (
            <button className="header__search-clear" onClick={() => { setSearchValue(''); searchRef.current?.focus(); }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          )}
          {!searchValue && <span className="header__search-kbd">Ctrl+K</span>}
        </div>
        {showSearchOverlay && (
          <SearchOverlay
            query={searchValue}
            onNavigate={handleSearchNavigate}
            onClose={() => { setSearchValue(''); setSearchFocused(false); setFocusedIdx(-1); }}
            onFirstResult={handleFirstResult}
            listboxId={searchListboxId}
            changes={searchData.changes}
            projects={searchData.projects}
            focusedIdx={focusedIdx}
            onResultsUpdate={handleResultsUpdate}
          />
        )}
        {showCommandPalette && (
          <CommandPalette
            onNavigate={handleSearchNavigate}
            onClose={() => { setSearchFocused(false); setFocusedIdx(-1); }}
            listboxId={searchListboxId}
            onOpenNotificationPanel={onOpenNotificationPanel}
          />
        )}
      </div>

      <div className="header__actions">
        <button
          className={`header__notif-btn${highPriorityUnread > 0 ? ' header__notif-btn--urgent' : ''}`}
          aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread${highPriorityUnread > 0 ? `, ${highPriorityUnread} high priority` : ''}` : ''}`}
          onClick={onOpenNotificationPanel}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
          </svg>
          {unreadCount > 0 && (
            <span
              className={`header__notif-badge${highPriorityUnread > 0 ? ' header__notif-badge--high' : ''}`}
              aria-hidden="true"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
          <span className="header__action-label">Notifications</span>
        </button>

        <button className="header__theme-btn" onClick={onThemeToggle} title="Toggle Theme">
          {theme === 'light'
            ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z" /></svg>
            : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z" /></svg>
          }
          <span className="header__action-label">Theme</span>
        </button>

        <div className="header__user-wrap" ref={userMenuRef}>
          <button
            ref={userMenuBtnRef}
            className="header__user"
            aria-haspopup="true"
            aria-expanded={userMenuOpen}
            onClick={() => setUserMenuOpen(o => !o)}
          >
            <div className="header__user-avatar" aria-hidden="true">
              {userName ? userName.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase() : '?'}
            </div>
            <div className="header__user-info">
              <span className="header__user-name">{userName}</span>
              <span className="header__user-role">{userRole}</span>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 10l5 5 5-5z" />
            </svg>
          </button>
          {userMenuOpen && (
            <div className="header__user-menu" role="menu" aria-label="User menu">
              <button ref={firstMenuItemRef} className="header__user-menu-item" role="menuitem" onClick={() => { navigate('settings'); setUserMenuOpen(false); userMenuBtnRef.current?.focus(); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5zm7.43-2c.04-.32.07-.64.07-.98s-.03-.67-.07-1l2.14-1.67c.19-.15.24-.42.12-.64l-2.02-3.5c-.12-.22-.39-.3-.61-.22l-2.52 1.01c-.52-.4-1.08-.73-1.69-.98l-.38-2.68C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.68c-.61.25-1.17.59-1.69.98L4.96 5.07c-.22-.08-.49 0-.61.22L2.33 8.79c-.12.22-.07.49.12.64l2.14 1.67c-.04.32-.07.65-.07 1s.03.66.07.98l-2.14 1.67c-.19.15-.24.42-.12.64l2.02 3.5c.12.22.39.3.61.22l2.52-1.01c.52.4 1.08.73 1.69.98l.38 2.68c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.68c.61-.25 1.17-.58 1.69-.98l2.52 1.01c.22.08.49 0 .61-.22l2.02-3.5c.12-.22.07-.49-.12-.64l-2.14-1.67z"/></svg>
                Settings
              </button>
              <button className="header__user-menu-item" role="menuitem" onClick={() => { navigate('security'); setUserMenuOpen(false); userMenuBtnRef.current?.focus(); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
                Security & Roles
              </button>
              <div className="header__user-menu-divider" />
              <button className="header__user-menu-item header__user-menu-item--danger" role="menuitem" onClick={() => { setUserMenuOpen(false); logout(); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5c-1.11 0-2 .9-2 2v4h2V5h14v14H5v-4H3v4c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/></svg>
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
      <KeyboardShortcutsModal open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      {searchActivated && <SearchDataProvider onData={handleSearchData} />}
    </header>
  );
}
