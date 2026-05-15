/**
 * Extract a printable message from anything thrown — `Error.message`
 * if it's an Error instance, otherwise `String(value)`. Used wherever
 * we surface a caught error to the user via a toast / banner / store
 * error slot. Centralised because the inline form (`err instanceof
 * Error ? err.message : String(err)`) was duplicated across 10+ sites.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
