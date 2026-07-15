/**
 * Escapes a string value for safe use in an OData $filter expression.
 * Single quotes are doubled per OData spec (RFC 5023 §8.1).
 */
export function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Validates that a value is a well-formed GUID (UUID) before use in OData filters.
 * Returns the GUID unchanged if valid, or throws if malformed.
 */
export function assertGuid(value: string, fieldName: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`[CGMP] Invalid GUID for OData filter field "${fieldName}": "${value}"`);
  }
  return value;
}

export function buildODataFilter(field: string, value: string): string {
  return `${field} eq '${escapeODataString(value)}'`;
}
