/** Shared badge components — single source for status, risk, priority, and role badges */

import { memo } from 'react';
import { STATUS, ROLES, ROLE_LABEL } from '../../utils/roles';

/* ── Status ── */
const STATUS_META: Record<number, { label: string; cls: string }> = {
  [STATUS.Draft]:       { label: 'Draft',        cls: 'status-draft' },
  [STATUS.Published]:   { label: 'Published',    cls: 'status-published' },
  [STATUS.UnderReview]: { label: 'Under Review', cls: 'status-review' },
  [STATUS.Released]:    { label: 'Released',     cls: 'status-released' },
  [STATUS.InProgress]:  { label: 'In Progress',  cls: 'status-inprogress' },
  [STATUS.Completed]:   { label: 'Completed',    cls: 'status-completed' },
  [STATUS.Failed]:      { label: 'Failed',       cls: 'status-failed' },
  [STATUS.Cancelled]:   { label: 'Cancelled',    cls: 'status-cancelled' },
  [STATUS.Closed]:      { label: 'Closed',       cls: 'status-closed' },
};

export const StatusBadge = memo(function StatusBadge({ status }: { status: number | undefined | null }) {
  const s = status as number;
  const meta = STATUS_META[s] ?? { label: `Status ${s}`, cls: 'status-draft' };
  return <span className={`badge badge--status ${meta.cls}`}>{meta.label}</span>;
});

/* ── Risk ── */
const RISK_META: Record<number, { label: string; cls: string }> = {
  100000000: { label: 'Low',      cls: 'risk-low' },
  100000001: { label: 'Medium',   cls: 'risk-medium' },
  100000002: { label: 'High',     cls: 'risk-high' },
  100000003: { label: 'Critical', cls: 'risk-critical' },
};

export const RiskBadge = memo(function RiskBadge({ risk }: { risk: number | undefined | null }) {
  const r = risk as number;
  const meta = RISK_META[r] ?? { label: `Risk ${r}`, cls: 'risk-low' };
  return <span className={`badge badge--risk ${meta.cls}`}>{meta.label}</span>;
});

/* ── Priority ── */
const PRIORITY_META: Record<number, { label: string; cls: string }> = {
  100000000: { label: 'Low',      cls: 'priority-low' },
  100000001: { label: 'Medium',   cls: 'priority-medium' },
  100000002: { label: 'High',     cls: 'priority-high' },
  100000003: { label: 'Critical', cls: 'priority-critical' },
};

export const PriorityBadge = memo(function PriorityBadge({ priority }: { priority: number | undefined | null }) {
  const p = priority as number;
  const meta = PRIORITY_META[p] ?? { label: `P${p}`, cls: 'priority-low' };
  return <span className={`badge badge--priority ${meta.cls}`}>{meta.label}</span>;
});

/* ── Role ── */
export const RoleBadge = memo(function RoleBadge({ role }: { role: number | undefined | null }) {
  const r = role as number;
  const isAdmin = r === ROLES.Admin;
  return (
    <span className={`badge ${isAdmin ? 'badge--admin' : 'badge--role'}`}>
      {ROLE_LABEL[r] ?? 'Unknown Role'}
    </span>
  );
});

/* ── Category ── */
const CATEGORY_META: Record<number, { label: string }> = {
  100000000: { label: 'Network' },
  100000001: { label: 'Citrix' },
  100000002: { label: 'VMware' },
  100000003: { label: 'Security' },
  100000004: { label: 'Storage' },
  100000005: { label: 'Database' },
  100000006: { label: 'Application' },
  100000007: { label: 'OS Patch' },
  100000008: { label: 'Hardware' },
  100000009: { label: 'Other' },
};

export const CategoryBadge = memo(function CategoryBadge({ category }: { category: number | undefined | null }) {
  const c = category as number;
  const label = CATEGORY_META[c]?.label ?? `Cat ${c}`;
  return <span className="badge badge--category">{label}</span>;
});

export { ROLES, ROLE_LABEL, STATUS };
