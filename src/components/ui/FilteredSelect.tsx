import { useState, useRef, useEffect, useCallback } from 'react';

interface Option { value: string; label: string; }

interface FilteredSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
}

export default function FilteredSelect({ options, value, onChange, placeholder = 'Select…', className = '', disabled = false, id }: FilteredSelectProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const selectedLabel = options.find(o => o.value === value)?.label ?? '';

  const filtered = filter.trim()
    ? options.filter(o => o.label.toLowerCase().includes(filter.toLowerCase()))
    : options;

  const select = useCallback((v: string) => {
    onChange(v);
    setOpen(false);
    setFilter('');
  }, [onChange]);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => filterRef.current?.focus(), 50);
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false); setFilter('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={containerRef} className={`fsel ${className}`} style={{ position: 'relative' }}>
      <button
        id={id}
        type="button"
        className="ff-input fsel__trigger"
        style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedLabel || <span style={{ color: 'var(--text-tertiary)' }}>{placeholder}</span>}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>
      {open && (
        <div className="fsel__dropdown" role="listbox">
          <div className="fsel__filter-wrap">
            <input
              ref={filterRef}
              className="fsel__filter"
              placeholder="Type to filter…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              onClick={e => e.stopPropagation()}
            />
          </div>
          <div className="fsel__list">
            {placeholder && (
              <button type="button" className={`fsel__option ${value === '' ? 'fsel__option--selected' : ''}`} onClick={() => select('')}>
                {placeholder}
              </button>
            )}
            {filtered.length === 0 ? (
              <div className="fsel__empty">No matches</div>
            ) : (
              filtered.map(o => (
                <button key={o.value} type="button" role="option" aria-selected={o.value === value}
                  className={`fsel__option ${o.value === value ? 'fsel__option--selected' : ''}`}
                  onClick={() => select(o.value)}>
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
