import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Lazy singleton. The postgres-js client + the DATABASE_URL check are deferred
// to the FIRST query rather than running at module-eval. `next build`'s
// "collect page data" step evaluates every route module (which transitively
// import this file) but never runs a query — so an eager throw-on-import here
// made the whole build fail on any environment without DATABASE_URL (e.g.
// Preview deploys), even though no page actually queries at build time. With
// lazy init the build is env-independent; a real query without DATABASE_URL
// still throws, loudly, at the call site.
type Db = PostgresJsDatabase<typeof schema>;

let cached: Db | undefined;

function getDb(): Db {
  if (cached) return cached;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  cached = drizzle(postgres(connectionString, { prepare: false, max: 1 }), {
    schema,
  });
  return cached;
}

// Proxy so every existing `db.select()/db.insert()/db.transaction()/db.query…`
// call site is unchanged — the underlying client is materialized on first
// property access. Methods are bound to the real instance so drizzle's internal
// `this` is correct.
export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
