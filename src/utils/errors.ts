export const CGMP_ERRORS = {
  // Data load errors
  E001: { code: 'CGMP-E001', message: 'Failed to load changes from Dataverse', action: 'Check network connection and try again' },
  E002: { code: 'CGMP-E002', message: 'Failed to load projects', action: 'Check network connection and try again' },
  E003: { code: 'CGMP-E003', message: 'Failed to load user profile', action: 'Sign out and sign back in' },
  E004: { code: 'CGMP-E004', message: 'Failed to load notifications', action: 'Refresh the page' },
  // Change lifecycle errors
  E010: { code: 'CGMP-E010', message: 'Failed to save change', action: 'Check required fields and try again' },
  E011: { code: 'CGMP-E011', message: 'Failed to publish change', action: 'Verify all required fields are complete' },
  E012: { code: 'CGMP-E012', message: 'Failed to transition change status', action: 'Refresh the page and try again' },
  E013: { code: 'CGMP-E013', message: 'Blackout period conflict detected', action: 'Select a date outside the blackout period or request Admin override' },
  E014: { code: 'CGMP-E014', message: 'Change is locked by another user', action: 'Wait for the other user to close their session' },
  E015: { code: 'CGMP-E015', message: 'Failed to clone change', action: 'Try again or create a new change manually' },
  // Bridge errors
  E020: { code: 'CGMP-E020', message: 'Failed to start bridge execution', action: 'Check bridge details and try again' },
  E021: { code: 'CGMP-E021', message: 'Failed to update bridge status', action: 'Refresh the page and try again' },
  E022: { code: 'CGMP-E022', message: 'ISM sign-off required before handover', action: 'Request ISM to complete sign-off first' },
  // Authentication/authorization errors
  E030: { code: 'CGMP-E030', message: 'Session expired', action: 'Sign in again to continue' },
  E031: { code: 'CGMP-E031', message: 'Insufficient permissions for this action', action: 'Contact your administrator for access' },
  // Validation errors
  E040: { code: 'CGMP-E040', message: 'Required fields are missing', action: 'Fill in all required fields marked with *' },
  E041: { code: 'CGMP-E041', message: 'Invalid date range: end must be after start', action: 'Correct the date fields' },
  E042: { code: 'CGMP-E042', message: 'Invalid Teams URL', action: 'Use a URL starting with https://teams.microsoft.com/' },
  // System errors
  E050: { code: 'CGMP-E050', message: 'Unexpected error occurred', action: 'Refresh the page. If the problem persists, note the error code and contact support' },
  E051: { code: 'CGMP-E051', message: 'Dataverse service unavailable', action: 'Wait a moment and try again. Check your network connection' },
} as const;

export type CgmpErrorKey = keyof typeof CGMP_ERRORS;

export function formatErrorMessage(key: CgmpErrorKey, detail?: string): string {
  const err = CGMP_ERRORS[key];
  return detail ? `${err.message}: ${detail} (${err.code})` : `${err.message} (${err.code})`;
}
