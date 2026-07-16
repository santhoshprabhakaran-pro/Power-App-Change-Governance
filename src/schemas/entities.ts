import { z } from 'zod';

export const ChangeSchema = z
  .object({
    cgmp_changeid: z.string().uuid(),
    cgmp_changenumber: z.string().optional(),
    cgmp_title: z.string().optional(),
    cgmp_status: z.number().optional(),
    cgmp_risklevel: z.number().optional(),
    cgmp_category: z.number().optional(),
    cgmp_starttime: z.string().optional(),
    cgmp_endtime: z.string().optional(),
  })
  .passthrough();

export const BridgeSchema = z
  .object({
    cgmp_bridgeid: z.string().uuid(),
    cgmp_name: z.string().optional(),
    cgmp_status: z.number().optional(),
  })
  .passthrough();

export const NotificationSchema = z
  .object({
    cgmp_notificationid: z.string().uuid(),
    cgmp_title: z.string().optional(),
    cgmp_isread: z.boolean().optional(),
  })
  .passthrough();

export const UserProfileSchema = z
  .object({
    cgmp_userprofileid: z.string().uuid(),
    cgmp_name: z.string().optional(),
    cgmp_role: z.number().optional(),
  })
  .passthrough();
