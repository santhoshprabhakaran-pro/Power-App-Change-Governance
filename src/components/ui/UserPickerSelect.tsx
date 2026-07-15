import { useState, useMemo, useEffect, useRef } from 'react';
import type { Systemusers } from '../../generated/models/SystemusersModel';

interface Props {
  users: Systemusers[];
  loading: boolean;
  value: string;
  onChange: (name: string) => void;
}

export function UserPickerSelect({ users, loading, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => !search
      ? users
      : users.filter(u =>
          u.fullname?.toLowerCase().includes(search.toLowerCase()) ||
          u.internalemailaddress?.toLowerCase().includes(search.toLowerCase())
        ),
    [users, search],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const select = (name: string) => { onChange(name); setOpen(false); setSearch(''); };
  const clear = () => { onChange(''); setSearch(''); };

  return (
    <div className="user-picker" ref={dropRef}>
      <button
        type="button"
        className="user-picker__trigger ff-input"
        onClick={() => !loading && setOpen(o => !o)}
        disabled={loading}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {loading ? (
          <span className="user-picker__placeholder">Loading users…</span>
        ) : value ? (
          <span className="user-picker__value">
            <span className="user-picker__avatar">{value.charAt(0).toUpperCase()}</span>
            {value}
          </span>
        ) : (
          <span className="user-picker__placeholder">Search and select a user…</span>
        )}
        <span className="user-picker__actions">
          {value && (
            <span
              className="user-picker__clear"
              role="button"
              tabIndex={0}
              title="Clear selection"
              onClick={e => { e.stopPropagation(); clear(); }}
              onKeyDown={e => e.key === 'Enter' && (e.stopPropagation(), clear())}
            >×</span>
          )}
          <svg className={`proj-ms__chevron ${open ? 'proj-ms__chevron--open' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M7 10l5 5 5-5z" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="user-picker__dropdown" role="listbox">
          <div className="user-picker__search-wrap">
            <input
              type="text"
              className="user-picker__search"
              placeholder="Search by name or email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="user-picker__count">{filtered.length} user{filtered.length !== 1 ? 's' : ''}</div>
          <div className="user-picker__list">
            {filtered.length === 0 ? (
              <div className="user-picker__empty">No users match "{search}"</div>
            ) : (
              filtered.map(u => (
                <button
                  key={u.systemuserid ?? u.domainname}
                  type="button"
                  className={`user-picker__item ${value === u.fullname ? 'user-picker__item--selected' : ''}`}
                  onClick={() => select(u.fullname ?? '')}
                  role="option"
                  aria-selected={value === u.fullname}
                >
                  <span className="user-picker__item-avatar">{(u.fullname ?? '?').charAt(0).toUpperCase()}</span>
                  <span className="user-picker__item-info">
                    <span className="user-picker__item-name">{u.fullname}</span>
                    {u.internalemailaddress && (
                      <span className="user-picker__item-email">{u.internalemailaddress}</span>
                    )}
                  </span>
                  {value === u.fullname && (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--primary)', flexShrink: 0 }}>
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
