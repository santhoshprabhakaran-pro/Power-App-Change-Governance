import React, { useState, useMemo, useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export interface Column<T> {
  key: string;
  label: string;
  width?: number | string;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  render?: (value: unknown, row: T) => React.ReactNode;
}

interface DataTableProps<T extends { [key: string]: unknown }> {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  error?: string;
  selectable?: boolean;
  selectedIds?: Set<string>;
  idKey?: string;
  onSelectionChange?: (ids: Set<string>) => void;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  emptyMessage?: string;
  emptyIcon?: React.ReactNode;
  actions?: (row: T) => React.ReactNode;
  ariaLabel?: string;
  /** Enable windowed rendering for large datasets (500+ rows). When true, only ~25
   *  rows are in the DOM at a time. Pagination controls are hidden; all rows are
   *  accessible via scroll. Defaults to false for full backward compatibility. */
  virtualise?: boolean;
  /** Optional per-row CSS class name. Return an empty string to apply no extra class. */
  rowClassName?: (row: T) => string;
}

const PAGE_SIZES = [25, 50, 100];

export default function DataTable<T extends { [key: string]: unknown }>({
  columns,
  rows,
  loading = false,
  error,
  selectable = false,
  selectedIds = new Set(),
  idKey = 'id',
  onSelectionChange,
  onRowClick,
  pageSize: defaultPageSize = 25,
  emptyMessage = 'No records found',
  emptyIcon,
  actions,
  ariaLabel = 'Data table',
  virtualise = false,
  rowClassName,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [selectAll, setSelectAll] = useState(false); // "select all records across all pages"

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sortKey],
        bv = b[sortKey];
      const cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / pageSize);
  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(0);
  };

  /* Toggle current page selection only; preserve other pages */
  const togglePageAll = useCallback(() => {
    if (!onSelectionChange) return;
    const pageIds = new Set(paged.map((r) => String(r[idKey])));
    const allPageSelected = paged.every((r) => selectedIds.has(String(r[idKey])));
    const next = new Set(selectedIds);
    if (allPageSelected) {
      pageIds.forEach((id) => next.delete(id));
    } else {
      pageIds.forEach((id) => next.add(id));
    }
    setSelectAll(false);
    onSelectionChange(next);
  }, [onSelectionChange, paged, idKey, selectedIds]);

  /* Select ALL records across all pages */
  const handleSelectAll = useCallback(() => {
    if (!onSelectionChange) return;
    onSelectionChange(new Set(sorted.map((r) => String(r[idKey]))));
    setSelectAll(true);
  }, [onSelectionChange, sorted, idKey]);

  /* Clear all */
  const handleClearAll = useCallback(() => {
    if (!onSelectionChange) return;
    onSelectionChange(new Set());
    setSelectAll(false);
  }, [onSelectionChange]);

  const toggleRow = useCallback(
    (id: string) => {
      if (!onSelectionChange) return;
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelectAll(false);
      onSelectionChange(next);
    },
    [onSelectionChange, selectedIds]
  );

  const allPageChecked = paged.length > 0 && paged.every((r) => selectedIds.has(String(r[idKey])));
  const somePageChecked = paged.some((r) => selectedIds.has(String(r[idKey])));
  const indeterminate = somePageChecked && !allPageChecked;

  const skeletonRows = Array.from({ length: Math.min(pageSize, 10) });

  const ariaSort = (key: string): React.AriaAttributes['aria-sort'] => {
    if (sortKey !== key) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  };

  /* Virtualisation — always call the hook (Rules of Hooks), but pass count=0
     when virtualise is false so it is effectively a no-op. */
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: virtualise ? sorted.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 10,
  });

  /* Render a single data row — shared between virtualised and paged paths */
  const renderRow = (row: T, ri: number, extraStyle?: React.CSSProperties) => {
    const rawId = row[idKey];
    const id = rawId != null ? String(rawId) : `__row_${ri}`;
    const selected = selectedIds.has(id);
    const extraClass = rowClassName ? rowClassName(row) : '';
    return (
      <tr
        key={id}
        role="row"
        className={`dt__row ${selected ? 'dt__row--selected' : ''} ${onRowClick ? 'dt__row--clickable' : ''} ${extraClass}`.trimEnd()}
        onClick={onRowClick ? () => onRowClick(row) : undefined}
        aria-selected={selectable ? selected : undefined}
        tabIndex={selectable || !!onRowClick ? 0 : undefined}
        style={extraStyle}
        onKeyDown={
          selectable || onRowClick
            ? (e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  if (onRowClick) onRowClick(row);
                  else if (selectable) toggleRow(id);
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  (e.currentTarget.nextElementSibling as HTMLElement)?.focus();
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  (e.currentTarget.previousElementSibling as HTMLElement)?.focus();
                }
              }
            : undefined
        }
      >
        {selectable && (
          <td
            className="dt__td dt__td--check"
            role="gridcell"
            onClick={(e) => {
              e.stopPropagation();
              toggleRow(id);
            }}
          >
            <input
              type="checkbox"
              checked={selected}
              onChange={() => toggleRow(id)}
              aria-label={`Select row ${ri + 1}`}
            />
          </td>
        )}
        {columns.map((col) => (
          <td key={col.key} className="dt__td" role="gridcell" style={{ textAlign: col.align ?? 'left' }}>
            {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? '—')}
          </td>
        ))}
        {actions && (
          <td className="dt__td dt__td--actions" role="gridcell" onClick={(e) => e.stopPropagation()}>
            {actions(row)}
          </td>
        )}
      </tr>
    );
  };

  if (error) {
    return (
      <div className="dt-error" role="alert">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--danger)" aria-hidden="true">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
        </svg>
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="dt-wrap">
      {/* Cross-page select-all banner */}
      {selectable && selectedIds.size > 0 && (
        <div className="dt-select-banner" role="status">
          <span>
            {selectedIds.size} of {sorted.length} selected
          </span>
          {!selectAll && selectedIds.size < sorted.length && (
            <button className="btn btn--xs btn--outline" onClick={handleSelectAll} style={{ marginLeft: 8 }}>
              Select all {sorted.length} records
            </button>
          )}
          <button className="btn btn--xs btn--outline" onClick={handleClearAll} style={{ marginLeft: 4 }}>
            Clear selection
          </button>
        </div>
      )}

      {/* Screen-reader live region — announces selection count changes (F-034) */}
      {selectable && (
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {selectedIds.size > 0 ? `${selectedIds.size} row${selectedIds.size !== 1 ? 's' : ''} selected` : ''}
        </div>
      )}

      <div
        ref={virtualise ? parentRef : undefined}
        className="dt-scroll"
        role="region"
        aria-label={ariaLabel}
        style={virtualise ? { height: '600px', overflowY: 'auto' } : undefined}
      >
        <table
          className="dt"
          role="grid"
          aria-busy={loading}
          style={virtualise ? { height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' } : undefined}
        >
          <thead>
            <tr>
              {selectable && (
                <th className="dt__th dt__th--check" scope="col" role="columnheader">
                  <input
                    type="checkbox"
                    checked={allPageChecked}
                    ref={(el) => {
                      if (el) {
                        el.indeterminate = indeterminate;
                        el.setAttribute('aria-checked', indeterminate ? 'mixed' : allPageChecked ? 'true' : 'false');
                      }
                    }}
                    onChange={togglePageAll}
                    aria-label={`Select all on page ${page + 1}`}
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  role="columnheader"
                  className={`dt__th ${col.sortable ? 'dt__th--sortable' : ''}`}
                  style={{ width: col.width, textAlign: col.align ?? 'left' }}
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  aria-sort={col.sortable ? ariaSort(col.key) : undefined}
                  tabIndex={col.sortable ? 0 : undefined}
                  onKeyDown={
                    col.sortable
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleSort(col.key);
                          }
                        }
                      : undefined
                  }
                >
                  {col.label}
                  {col.sortable && (
                    <span className="dt__sort-icon" aria-hidden="true">
                      {sortKey === col.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                    </span>
                  )}
                </th>
              ))}
              {actions && (
                <th className="dt__th dt__th--actions" scope="col" role="columnheader">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              skeletonRows.map((_, i) => (
                <tr key={i} role="row" aria-busy="true">
                  {selectable && (
                    <td className="dt__td" role="gridcell">
                      <div className="skeleton" style={{ width: 14, height: 14 }} />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key} className="dt__td" role="gridcell">
                      <div className="skeleton" style={{ height: 13, width: '80%' }} />
                    </td>
                  ))}
                  {actions && (
                    <td className="dt__td" role="gridcell">
                      <div className="skeleton" style={{ height: 13, width: 60 }} />
                    </td>
                  )}
                </tr>
              ))
            ) : virtualise ? (
              sorted.length === 0 ? (
                <tr role="row">
                  <td
                    colSpan={columns.length + (selectable ? 1 : 0) + (actions ? 1 : 0)}
                    className="dt__empty"
                    role="gridcell"
                  >
                    {emptyIcon && (
                      <div className="dt__empty-icon" aria-hidden="true">
                        {emptyIcon}
                      </div>
                    )}
                    <div className="dt__empty-text">{emptyMessage}</div>
                  </td>
                </tr>
              ) : (
                rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const row = sorted[virtualRow.index];
                  const vExtraClass = rowClassName ? rowClassName(row) : '';
                  return (
                    <tr
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      role="row"
                      className={`dt__row ${selectedIds.has(row[idKey] != null ? String(row[idKey]) : `__row_${virtualRow.index}`) ? 'dt__row--selected' : ''} ${onRowClick ? 'dt__row--clickable' : ''} ${vExtraClass}`.trimEnd()}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      aria-selected={
                        selectable
                          ? selectedIds.has(row[idKey] != null ? String(row[idKey]) : `__row_${virtualRow.index}`)
                          : undefined
                      }
                      tabIndex={selectable || !!onRowClick ? 0 : undefined}
                      onKeyDown={
                        selectable || onRowClick
                          ? (e) => {
                              const id = row[idKey] != null ? String(row[idKey]) : `__row_${virtualRow.index}`;
                              if (e.key === ' ' || e.key === 'Enter') {
                                e.preventDefault();
                                if (onRowClick) onRowClick(row);
                                else if (selectable) toggleRow(id);
                              }
                              if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                (e.currentTarget.nextElementSibling as HTMLElement)?.focus();
                              }
                              if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                (e.currentTarget.previousElementSibling as HTMLElement)?.focus();
                              }
                            }
                          : undefined
                      }
                    >
                      {selectable &&
                        (() => {
                          const id = row[idKey] != null ? String(row[idKey]) : `__row_${virtualRow.index}`;
                          return (
                            <td
                              className="dt__td dt__td--check"
                              role="gridcell"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleRow(id);
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={selectedIds.has(id)}
                                onChange={() => toggleRow(id)}
                                aria-label={`Select row ${virtualRow.index + 1}`}
                              />
                            </td>
                          );
                        })()}
                      {columns.map((col) => (
                        <td key={col.key} className="dt__td" role="gridcell" style={{ textAlign: col.align ?? 'left' }}>
                          {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? '—')}
                        </td>
                      ))}
                      {actions && (
                        <td className="dt__td dt__td--actions" role="gridcell" onClick={(e) => e.stopPropagation()}>
                          {actions(row)}
                        </td>
                      )}
                    </tr>
                  );
                })
              )
            ) : paged.length === 0 ? (
              <tr role="row">
                <td
                  colSpan={columns.length + (selectable ? 1 : 0) + (actions ? 1 : 0)}
                  className="dt__empty"
                  role="gridcell"
                >
                  {emptyIcon && (
                    <div className="dt__empty-icon" aria-hidden="true">
                      {emptyIcon}
                    </div>
                  )}
                  <div className="dt__empty-text">{emptyMessage}</div>
                </td>
              </tr>
            ) : (
              paged.map((row, ri) => renderRow(row, ri))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination — hidden when virtualise is active; only show when there are filtered results */}
      {!virtualise && !loading && sorted.length > 0 && (
        <div className="dt-pagination">
          <div className="dt-pagination__info">
            <span>
              {sorted.length === 0
                ? 'No records'
                : `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, sorted.length)} of ${sorted.length}`}
            </span>
          </div>
          <div className="dt-pagination__controls">
            <label className="sr-only" htmlFor="dt-page-size">
              Rows per page
            </label>
            <select
              id="dt-page-size"
              className="dt-page-size"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} / page
                </option>
              ))}
            </select>
            <button className="dt-page-btn" disabled={page === 0} onClick={() => setPage(0)} aria-label="First page">
              «
            </button>
            <button
              className="dt-page-btn"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              aria-label="Previous page"
            >
              ‹
            </button>
            <span className="dt-pagination__page" aria-live="polite">
              {page + 1} / {Math.max(totalPages, 1)}
            </span>
            <button
              className="dt-page-btn"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              aria-label="Next page"
            >
              ›
            </button>
            <button
              className="dt-page-btn"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(totalPages - 1)}
              aria-label="Last page"
            >
              »
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
