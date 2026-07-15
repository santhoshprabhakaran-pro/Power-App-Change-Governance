/** Canonical role codes and status transition rules */

export const ROLES = {
  Admin:  100000000,
  PMO:    100000001,
  ITOps:  100000002,
  ISM:    100000003,
  GIICC:  100000004,
} as const;

export type RoleCode = typeof ROLES[keyof typeof ROLES];

/** Human-readable role labels */
export const ROLE_LABEL: Record<number, string> = {
  [ROLES.Admin]:  'Administrator',
  [ROLES.PMO]:    'PMO Manager',
  [ROLES.ITOps]:  'IT Operations',
  [ROLES.ISM]:    'ISM',
  [ROLES.GIICC]:  'GIICC',
};

// Advanced RBAC roles — require Dataverse option set extension to persist
// Observer: read-only access to all workspaces
// ISMDeputy: full ISM permissions as a deputy
// DeptAdmin: admin for a specific department/location
export const EXTENDED_ROLES = {
  Observer:   100000005,
  ISMDeputy:  100000006,
  DeptAdmin:  100000007,
} as const;

export type ExtendedRoleCode = typeof EXTENDED_ROLES[keyof typeof EXTENDED_ROLES];

export const EXTENDED_ROLE_LABEL: Record<number, string> = {
  [EXTENDED_ROLES.Observer]:  'Read-Only Observer',
  [EXTENDED_ROLES.ISMDeputy]: 'ISM Deputy',
  [EXTENDED_ROLES.DeptAdmin]: 'Department Administrator',
};

/** True if this role code has ISM-level permissions (ISM or ISMDeputy) */
export function hasISMPermissions(role: number): boolean {
  return role === ROLES.ISM || role === EXTENDED_ROLES.ISMDeputy;
}

/** True if this role has admin-level permissions */
export function hasAdminPermissions(role: number): boolean {
  return role === ROLES.Admin || role === EXTENDED_ROLES.DeptAdmin;
}

/** True if role is read-only observer */
export function isObserver(role: number): boolean {
  return role === EXTENDED_ROLES.Observer;
}

/** Status codes — single canonical source; matches Dataverse option set values */
export const STATUS = {
  Draft:       100000000,
  Published:   100000001,
  UnderReview: 100000002,
  Released:    100000003,
  UATUpdates:  100000004,
  Locked:      100000005,
  InProgress:  100000006,
  Completed:   100000007,
  Failed:      100000008,
  Closed:      100000009,
  Cancelled:   100000010,
} as const;

/**
 * Allowed status transitions per role.
 * Key = fromStatus, Value = array of allowed toStatus values for that role.
 */
export const ALLOWED_TRANSITIONS: Record<number, Partial<Record<RoleCode, number[]>>> = {
  [STATUS.Draft]: {
    [ROLES.Admin]: [STATUS.Published, STATUS.Cancelled],
    [ROLES.PMO]:   [STATUS.Published, STATUS.Cancelled],
  },
  [STATUS.Published]: {
    [ROLES.Admin]:  [STATUS.UnderReview, STATUS.Draft, STATUS.Cancelled],
    [ROLES.ITOps]:  [STATUS.UnderReview],
  },
  [STATUS.UnderReview]: {
    [ROLES.Admin]:  [STATUS.Released, STATUS.Draft, STATUS.Cancelled],
    [ROLES.ITOps]:  [STATUS.Released, STATUS.Draft],
  },
  [STATUS.Released]: {
    [ROLES.Admin]:  [STATUS.InProgress, STATUS.Cancelled],
    [ROLES.GIICC]:  [STATUS.InProgress],
    [ROLES.ITOps]:  [STATUS.InProgress],
  },
  [STATUS.InProgress]: {
    [ROLES.Admin]:  [STATUS.Completed, STATUS.Failed],
    [ROLES.GIICC]:  [STATUS.Completed, STATUS.Failed],
  },
  [STATUS.UATUpdates]: {
    [ROLES.Admin]: [STATUS.Released, STATUS.Cancelled],
    [ROLES.PMO]:   [STATUS.Released, STATUS.Cancelled],
    [ROLES.ISM]:   [STATUS.Released, STATUS.Cancelled],
  },
  [STATUS.Locked]: {
    [ROLES.Admin]: [STATUS.InProgress, STATUS.Cancelled],
    [ROLES.GIICC]: [STATUS.InProgress],
  },
  [STATUS.Completed]: {
    [ROLES.Admin]: [STATUS.Closed],
  },
  [STATUS.Failed]: {
    [ROLES.Admin]: [STATUS.Closed, STATUS.Draft],
  },
};

/** Return allowed next statuses for the current role and current status */
export function getAllowedTransitions(currentStatus: number, role: number): number[] {
  const effectiveRole = (role === EXTENDED_ROLES.ISMDeputy) ? ROLES.ISM
    : (role === EXTENDED_ROLES.DeptAdmin) ? ROLES.Admin
    : role;
  const forStatus = ALLOWED_TRANSITIONS[currentStatus];
  if (!forStatus) return [];
  return forStatus[effectiveRole as RoleCode] ?? [];
}

/** True if the role is allowed to change from currentStatus to nextStatus */
export function canTransition(currentStatus: number, nextStatus: number, role: number): boolean {
  return getAllowedTransitions(currentStatus, role).includes(nextStatus);
}

/* ── Additional option-set code groups ─────────────────────────────── */

export const RISK = {
  Low:      100000000,
  Medium:   100000001,
  High:     100000002,
  Critical: 100000003,
} as const;

export const TASK_PRIORITY = {
  High:   100000000,
  Medium: 100000001,
  Low:    100000002,
} as const;

export const BRIDGE_STATUS = {
  InProgress: 100000000,
  Completed:  100000001,
  Failed:     100000002,
  Cancelled:  100000003,
  Scheduled:  100000004,
} as const;

/* ── Label / color maps ─────────────────────────────────────────────── */

export const STATUS_LABEL_MAP: Record<number, string> = {
  100000000: 'Draft',        100000001: 'Published',    100000002: 'Under Review',
  100000003: 'Released',     100000004: 'Awaiting UAT', 100000005: 'Locked',
  100000006: 'In Progress',  100000007: 'Completed',    100000008: 'Failed',
  100000009: 'Closed',       100000010: 'Cancelled',
};

export const RISK_LABEL_MAP: Record<number, string> = {
  100000000: 'Low', 100000001: 'Medium', 100000002: 'High', 100000003: 'Critical',
};

export const STATUS_COLOR_MAP: Record<number, string> = {
  100000000: 'status-draft',      100000001: 'status-published',   100000002: 'status-review',
  100000003: 'status-released',   100000004: 'status-uat',         100000005: 'status-locked',
  100000006: 'status-inprogress', 100000007: 'status-completed',   100000008: 'status-failed',
  100000009: 'status-closed',     100000010: 'status-cancelled',
};

export const RISK_COLOR_MAP: Record<number, string> = {
  100000000: 'risk-low', 100000001: 'risk-medium', 100000002: 'risk-high', 100000003: 'risk-critical',
};

export const RISK_ICON_MAP: Record<number, string> = {
  100000000: '◆', 100000001: '■', 100000002: '▲', 100000003: '⬛',
};

export const PRIORITY_LABEL_MAP: Record<number, string> = {
  100000000: 'High', 100000001: 'Medium', 100000002: 'Low',
};

export const PRIORITY_COLOR_MAP: Record<number, string> = {
  100000000: 'priority-high', 100000001: 'priority-medium', 100000002: 'priority-low',
};

export const BRIDGE_STATUS_LABEL_MAP: Record<number, string> = {
  100000000: 'Active',    100000001: 'Completed', 100000002: 'Failed',
  100000003: 'Cancelled', 100000004: 'Scheduled',
};

export const TASK_TYPE_LABEL_MAP: Record<number, string> = {
  100000000: 'Update UAT Users',    100000001: 'Review Change',      100000002: 'Add PIR Notes',
  100000003: 'Close Change Window', 100000004: 'Approve Release',    100000005: 'Escalate',
  100000006: 'Other',
};

/* ── Label / color accessor functions ─────────────────────────────── */

export function statusLabel(code: number): string  { return STATUS_LABEL_MAP[code]        ?? 'Unknown'; }
export function statusColor(code: number): string  { return STATUS_COLOR_MAP[code]         ?? 'status-draft'; }
export function riskLabel(code: number): string    { return RISK_LABEL_MAP[code]           ?? 'Unknown'; }
export function riskColor(code: number): string    { return RISK_COLOR_MAP[code]            ?? 'risk-low'; }
/** Colorblind-safe prefix shape for risk level */
export function riskIcon(code: number): string     { return RISK_ICON_MAP[code]             ?? ''; }
export function priorityLabel(code: number): string { return PRIORITY_LABEL_MAP[code]      ?? 'Unknown'; }
export function priorityColor(code: number): string { return PRIORITY_COLOR_MAP[code]      ?? 'priority-low'; }
export function bridgeStatusLabel(code: number): string { return BRIDGE_STATUS_LABEL_MAP[code] ?? 'Unknown'; }
export function taskTypeLabel(code: number): string { return TASK_TYPE_LABEL_MAP[code]     ?? 'Task'; }
