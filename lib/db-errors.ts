// Postgres error-code detection for Drizzle queries. Drizzle 0.44+ wraps
// driver errors in DrizzleQueryError with the original PostgresError on
// `.cause` — `.code` on the thrown error itself is undefined (verified
// against Neon 2026-07-16). Walk the cause chain so both wrapped and bare
// driver errors match.
type PgErrorLike = { code?: string; constraint_name?: string };

function findPgError(e: unknown, code: string): PgErrorLike | undefined {
  for (let err = e, depth = 0; err && depth < 5; depth++) {
    if ((err as PgErrorLike).code === code) return err as PgErrorLike;
    err = (err as { cause?: unknown }).cause;
  }
  return undefined;
}

function hasPgCode(e: unknown, code: string): boolean {
  return findPgError(e, code) !== undefined;
}

// 23505 = unique_violation. With `constraint`, only a violation of THAT
// constraint matches — postgres-js names it on the error as
// `constraint_name` (e.g. "users_email_unique", drizzle/0000_*.sql), so a
// caller can tell "the address is taken" from any other unique key.
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const pg = findPgError(e, "23505");
  if (!pg) return false;
  return constraint === undefined || pg.constraint_name === constraint;
}

// 23503 = foreign_key_violation — e.g. a watch_progress write for a user
// whose `users` mirror row has not landed yet (late Clerk webhook).
export function isForeignKeyViolation(e: unknown): boolean {
  return hasPgCode(e, "23503");
}
