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

/**
 * What can be said about a failed statement without quoting it: the error's
 * class and the driver's SQLSTATE (42P01 undefined_table, 40P01 deadlock,
 * 57014 query_canceled, …). Drizzle 0.44+ wraps the PostgresError in a
 * DrizzleQueryError with the original on `.cause` — walked the same way as
 * above. The message is deliberately NOT read: Drizzle's wrapper repeats the
 * statement WITH its params (`Failed query: <sql>\nparams: <params>`), the
 * driver quotes the statement too, and a constraint error can quote the row.
 * Lived in lib/retention.ts until the playback-token routes needed it (#326);
 * this module has no imports, so a route can take it without the schema.
 */
export function describeDbError(e: unknown): { name: string; code: string | null } {
  const name = e instanceof Error ? e.name : typeof e;
  for (let err = e, depth = 0; err && depth < 5; depth++) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return { name, code };
    err = (err as { cause?: unknown }).cause;
  }
  return { name, code: null };
}
