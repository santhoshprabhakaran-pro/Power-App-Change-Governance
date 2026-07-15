export const STATUS_OPTIONS = [
  { value: '100000000', label: 'Draft' },
  { value: '100000001', label: 'Published' },
  { value: '100000002', label: 'Under Review' },
  { value: '100000003', label: 'Released' },
  { value: '100000004', label: 'Awaiting UAT' },
  { value: '100000005', label: 'Locked' },
  { value: '100000006', label: 'In Progress' },
  { value: '100000007', label: 'Completed' },
  { value: '100000008', label: 'Failed' },
  { value: '100000009', label: 'Closed' },
  { value: '100000010', label: 'Cancelled' },
];

export const CATEGORY_OPTIONS = [
  { value: '100000000', label: 'Network' },
  { value: '100000001', label: 'Citrix' },
  { value: '100000002', label: 'VMware' },
  { value: '100000003', label: 'Firewall' },
  { value: '100000004', label: 'Patch' },
  { value: '100000005', label: 'Application' },
  { value: '100000006', label: 'Database' },
  { value: '100000007', label: 'Security' },
  { value: '100000008', label: 'Infrastructure' },
  { value: '100000009', label: 'Other' },
];

export const CHANGE_TYPE_OPTIONS = [
  { value: '100000000', label: 'Standard' },
  { value: '100000001', label: 'Emergency' },
  { value: '100000002', label: 'Normal' },
  { value: '100000003', label: 'Expedited' },
];

export const RISK_OPTIONS = [
  { value: '100000000', label: 'Low' },
  { value: '100000001', label: 'Medium' },
  { value: '100000002', label: 'High' },
  { value: '100000003', label: 'Critical' },
];

export const IMPACT_OPTIONS = [
  { value: '100000000', label: 'Low' },
  { value: '100000001', label: 'Medium' },
  { value: '100000002', label: 'High' },
  { value: '100000003', label: 'Critical' },
];

/* CSV import helpers — map human-readable label to enum code */
export const CSV_CATEGORY_MAP: Record<string, number> = {
  network: 100000000, citrix: 100000001, vmware: 100000002, firewall: 100000003,
  patch: 100000004, application: 100000005, database: 100000006,
  security: 100000007, infrastructure: 100000008, other: 100000009,
};

export const CSV_RISK_MAP: Record<string, number> = {
  low: 100000000, medium: 100000001, high: 100000002, critical: 100000003,
};

export const CSV_IMPACT_MAP: Record<string, number> = {
  low: 100000000, medium: 100000001, high: 100000002, critical: 100000003,
};

export const CSV_TYPE_MAP: Record<string, number> = {
  standard: 100000000, emergency: 100000001, normal: 100000002, expedited: 100000003,
};

/** Validates that a URL is a legitimate Microsoft Teams URL */
export function isValidTeamsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'teams.microsoft.com';
  } catch {
    return false;
  }
}
