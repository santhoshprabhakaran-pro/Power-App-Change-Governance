import { useApp } from '../context/AppContext';

// Role codes — canonical source of truth for permission checks
const ROLES = {
  Admin: 100000000,
  PMO: 100000001,
  ITOpsPOC: 100000002,
  ISM: 100000003,
  GIICC: 100000004,
  Observer: 100000005,
  ISMDeputy: 100000006,
  DeptAdmin: 100000007,
} as const;

type PermissionAction =
  | 'change.create'
  | 'change.publish'
  | 'change.delete'
  | 'change.review' // IT Ops review
  | 'change.handover' // GIICC handover
  | 'change.signoff' // ISM sign-off
  | 'change.close' // IT Ops close
  | 'change.export'
  | 'user.manage' // Admin manage roles
  | 'template.manage'
  | 'blackout.manage'
  | 'bridge.execute'
  | 'pir.submit'
  | 'concern.raise'
  | 'report.view'
  | 'audit.view'
  | 'settings.admin';

export function usePermissions() {
  const { userProfile } = useApp();
  const role = userProfile?.cgmp_role as number | undefined;

  const isAdmin = role === ROLES.Admin;
  const isPMO = role === ROLES.PMO;
  const isITOps = role === ROLES.ITOpsPOC;
  const isISM = role === ROLES.ISM || role === ROLES.ISMDeputy;
  const isGIICC = role === ROLES.GIICC;
  const isObserver = role === ROLES.Observer;
  const isDeptAdmin = role === ROLES.DeptAdmin;

  const can = (action: PermissionAction): boolean => {
    if (!role) return false;
    switch (action) {
      case 'change.create':
        return isAdmin || isPMO;
      case 'change.publish':
        return isAdmin || isPMO;
      case 'change.delete':
        return isAdmin;
      case 'change.review':
        return isAdmin || isITOps;
      case 'change.handover':
        return isAdmin || isGIICC;
      case 'change.signoff':
        return isAdmin || isISM;
      case 'change.close':
        return isAdmin || isITOps;
      case 'change.export':
        return !isObserver;
      case 'user.manage':
        return isAdmin;
      case 'template.manage':
        return isAdmin || isPMO;
      case 'blackout.manage':
        return isAdmin;
      case 'bridge.execute':
        return isAdmin || isGIICC;
      case 'pir.submit':
        return isAdmin || isGIICC;
      case 'concern.raise':
        return isAdmin || isISM;
      case 'report.view':
        return !isObserver;
      case 'audit.view':
        return isAdmin || isPMO || isISM;
      case 'settings.admin':
        return isAdmin;
    }
  };

  return { can, isAdmin, isPMO, isITOps, isISM, isGIICC, isObserver, isDeptAdmin, role, ROLES };
}
