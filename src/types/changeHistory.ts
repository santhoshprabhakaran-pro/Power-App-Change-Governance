// Discriminated union for all entry types stored in cgmp_versionhistory JSON array.
// This replaces all `any[]` casts when parsing version history in ChangeForm.tsx.

export interface EditEntry {
  _type: 'edit';
  timestamp: string;
  by: string;
  byUpn?: string;
  previousValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
}

export interface CommentEntry {
  _type: 'comment';
  id: string;
  timestamp: string;
  by: string;
  byUpn?: string;
  text: string;
}

export interface CommentDeletedEntry {
  _type: 'comment_deleted';
  id: string;
  timestamp: string;
  deletedBy: string;
}

export interface RescheduleProposedEntry {
  _type: 'rescheduleProposed';
  id: string;
  timestamp: string;
  by: string;
  byUpn?: string;
  proposedStart: string;
  proposedEnd: string;
  reason?: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
}

export interface RescheduleAcceptedEntry {
  _type: 'rescheduleAccepted';
  timestamp: string;
  by: string;
  proposalId: string;
}

export interface RescheduleDeclinedEntry {
  _type: 'rescheduleDeclined';
  timestamp: string;
  by: string;
  proposalId: string;
  reason?: string;
}

export interface MttrEntry {
  _type: 'mttr';
  timestamp: string;
  minutes: number;
}

export type HistoryEntryUnion =
  | EditEntry
  | CommentEntry
  | CommentDeletedEntry
  | RescheduleProposedEntry
  | RescheduleAcceptedEntry
  | RescheduleDeclinedEntry
  | MttrEntry;
