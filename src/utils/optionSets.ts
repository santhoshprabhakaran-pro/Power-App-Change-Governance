// Type-safe helpers for casting numeric option-set codes to generated model types.
// These replace scattered `as unknown as SomeType` casts throughout the codebase.
// The casts are necessary because pac modelbuilder generates enum types as
// `keyof typeof EnumObject` (string keys) rather than number.
import type {
  Cgmp_changescgmp_status,
  Cgmp_changescgmp_risklevel,
  Cgmp_changescgmp_category,
  Cgmp_changescgmp_pirstatus,
} from '@generated/models/Cgmp_changesModel';
import type {
  Cgmp_auditlogscgmp_eventtype,
  Cgmp_auditlogscgmp_entitytype,
} from '@generated/models/Cgmp_auditlogsModel';
import type {
  Cgmp_notificationscgmp_category,
  Cgmp_notificationscgmp_priority,
} from '@generated/models/Cgmp_notificationsModel';

export const asStatus      = (n: number): Cgmp_changescgmp_status           => n as unknown as Cgmp_changescgmp_status;
export const asRisk        = (n: number): Cgmp_changescgmp_risklevel         => n as unknown as Cgmp_changescgmp_risklevel;
export const asCategory    = (n: number): Cgmp_changescgmp_category          => n as unknown as Cgmp_changescgmp_category;
export const asPirStatus   = (n: number): Cgmp_changescgmp_pirstatus         => n as unknown as Cgmp_changescgmp_pirstatus;
export const asAuditEventType  = (n: number): Cgmp_auditlogscgmp_eventtype   => n as unknown as Cgmp_auditlogscgmp_eventtype;
export const asAuditEntityType = (n: number): Cgmp_auditlogscgmp_entitytype  => n as unknown as Cgmp_auditlogscgmp_entitytype;
export const asNotifCategory   = (n: number): Cgmp_notificationscgmp_category => n as unknown as Cgmp_notificationscgmp_category;
export const asNotifPriority   = (n: number): Cgmp_notificationscgmp_priority => n as unknown as Cgmp_notificationscgmp_priority;
