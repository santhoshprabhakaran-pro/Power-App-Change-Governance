export interface NotificationPayload {
  cgmp_title: string;
  cgmp_body: string;
  cgmp_category: number;
  cgmp_priority: number;
  cgmp_recipientid?: string;
  cgmp_actionurl?: string;
  cgmp_snoozeduntil?: string;
  cgmp_deliveryviachannel?: number;
}
