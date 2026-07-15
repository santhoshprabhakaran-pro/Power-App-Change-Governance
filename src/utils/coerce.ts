/**
 * Safely cast a Dataverse option-set value (which may arrive as string or number) to a typed numeric code.
 * Replaces `as unknown as number` / `as any` casts at OData boundaries.
 */
export function coerceOptionSet<T extends number>(v: unknown): T {
  return Number(v) as T;
}

/**
 * Safely parse a JSON string that may be null/undefined. Returns empty array on parse failure.
 */
export function safeParseJson<T>(json: string | undefined | null, fallback: T[] = []): T[] {
  if (!json) return fallback;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}
