import {
  boolean,
  date,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

// First-party audience measurement (consent-exempt): one row per anonymous
// browser, keyed by the server-minted `matio_aid` cookie value. Written by
// the /api/t beacon — never by middleware — so crawlers (no JS) and
// Next.js prefetches (no beacon) never create rows. Stores country-level
// geo only; the raw IP is never persisted (same stance as trial ip_hash).
//
// First-visit attribution (utm_*/referrer) is write-once: it identifies the
// channel that FIRST brought the browser here, which is the cut every
// funnel/matrix on /admin/analytics slices by. `user_id` is filled in when
// the visitor registers ("склейка" — the merge the analytics spec requires);
// onDelete: set null so deleting an account de-identifies the visit history
// instead of erasing it.
export const visitors = pgTable(
  "visitors",
  {
    aid: uuid("aid").primaryKey(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    firstPath: text("first_path"),
    // Full first-visit document.referrer (client-reported; length-capped at
    // the beacon). The derived source bucket (tiktok/instagram/…) is
    // computed at query time from utm_source ?? referrer host — storing the
    // raw value keeps the mapping fixable retroactively.
    referrer: text("referrer"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    // ISO-3166-1 alpha-2 from x-vercel-ip-country at first beacon.
    country: text("country"),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
  },
  (t) => [
    // The registration funnel counts "visitors in cohort who registered" by
    // joining through user_id; first_seen_at bounds every cohort scan.
    index("visitors_user_id_idx").on(t.userId),
    index("visitors_first_seen_at_idx").on(t.firstSeenAt),
  ],
);

// Per-day visit ledger: one row per (anonymous browser, UTC day), upserted
// by the beacon on every pageview. The three flags are monotonic
// (false → true within a day) and power the funnel's first three stages:
// landed on the homepage → opened a show/watch page → hit the sign-up wall.
export const visitorDays = pgTable(
  "visitor_days",
  {
    aid: uuid("aid")
      .notNull()
      .references(() => visitors.aid, { onDelete: "cascade" }),
    // UTC calendar day, stored as a plain date (mode:"string" — no TZ
    // round-trips through JS Date).
    day: date("day", { mode: "string" }).notNull(),
    landedHome: boolean("landed_home").notNull().default(false),
    showViewed: boolean("show_viewed").notNull().default(false),
    wallSeen: boolean("wall_seen").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.aid, t.day] }),
    // Range scans ("unique visitors between X and Y") pivot on day alone.
    index("visitor_days_day_idx").on(t.day),
  ],
);

export type Visitor = typeof visitors.$inferSelect;
export type NewVisitor = typeof visitors.$inferInsert;
export type VisitorDay = typeof visitorDays.$inferSelect;
