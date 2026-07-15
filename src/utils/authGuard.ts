// Shared auth-error detection for all Dataverse service calls.
// Every service method that stores a result from retrieveMultipleRecordsAsync /
// retrieveRecordAsync / createRecordAsync / updateRecordAsync must call
// checkForAuthError(result) immediately after the await. On 401/403 it fires
// the cgmp-session-expired custom event which SessionExpiredBanner listens for.

export function dispatchSessionExpiry(): void {
  try {
    sessionStorage.setItem('cgmp-session-expired', '1');
    window.dispatchEvent(new CustomEvent('cgmp-session-expired'));
  } catch { /* ignore */ }
}

export function checkForAuthError<T extends { success?: boolean; error?: unknown }>(result: T): T {
  if (!result.success && result.error) {
    const err = result.error as { status?: number; statusCode?: number; code?: string };
    const status = err.status ?? err.statusCode ?? 0;
    const code = typeof err.code === 'string' ? err.code : '';
    if (status === 401 || status === 403 || code === '0x8004A112' || code === '0x80072560') {
      dispatchSessionExpiry();
    }
  }
  return result;
}
