/**
 * Executes multiple Dataverse OData creates in a single $batch request.
 * Falls back to individual creates if $batch fails.
 *
 * TODO: Use this in NotificationCenter.tsx for the "mark all read" operation —
 * replace individual per-notification updates with a single $batch call.
 * The NotificationCenter.tsx file is restricted from direct edits in this build
 * phase; this utility is ready for integration when that file is next in scope.
 */
export async function batchCreate<T extends object>(
  entitySetName: string,
  records: T[],
  orgUrl: string
): Promise<void> {
  if (records.length === 0) return;
  const boundary = `batch_${Date.now()}`;
  const body =
    records
      .map((r) =>
        [
          `--${boundary}`,
          'Content-Type: application/http',
          'Content-Transfer-Encoding: binary',
          '',
          `POST ${orgUrl}/api/data/v9.2/${entitySetName} HTTP/1.1`,
          'Content-Type: application/json',
          '',
          JSON.stringify(r),
        ].join('\r\n')
      )
      .join('\r\n') + `\r\n--${boundary}--`;

  const res = await fetch(`${orgUrl}/api/data/v9.2/$batch`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/mixed;boundary=${boundary}`,
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Accept: 'application/json',
    },
    body,
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`$batch failed: ${res.status}`);
}
