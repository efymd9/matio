// Postgres error-code detection for Drizzle queries. Drizzle 0.44+ wraps
// driver errors in DrizzleQueryError with the original PostgresError on
// `.cause` — `.code` on the thrown error itself is undefined (verified
// against Neon 2026-07-16). Walk the cause chain so both wrapped and bare
// driver errors match.

// 23505 = unique_violation.
export function isUniqueViolation(e: unknown): boolean {
  for (let err = e, depth = 0; err && depth < 5; depth++) {
    if ((err as { code?: string }).code === "23505") return true;
    err = (err as { cause?: unknown }).cause;
  }
  return false;
}
