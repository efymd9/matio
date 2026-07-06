import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

// Admin-generated tracked links (/admin/links): a saved (target path, UTM
// triple) pair whose share URL is `SITE_URL + target_path + ?utm_*`. The
// table stores NO click/session data — a link's performance is derived by
// matching its exact normalized (source, medium, campaign) triple against
// trial_sessions.attribution_* / users.attribution_*, i.e. the same
// consent-gated cookie pipeline every other campaign cut uses. UTM values
// are canonicalized at insert (normalizeUtmSource / normalizeUtm) so the
// stored triple is byte-identical to what proxy.ts would persist for a
// visitor who clicked the link.
export const marketingLinks = pgTable(
  "marketing_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Human label shown in the admin table ("July IG reel #1").
    name: text("name").notNull(),
    // Site-relative landing path ("/", "/watch/<slug>", "/shows/<slug>" or a
    // custom path). Validated at the action layer: must start with "/", no
    // scheme/host/query/hash — the UTM query string is appended at render.
    targetPath: text("target_path").notNull(),
    utmSource: text("utm_source").notNull(),
    utmMedium: text("utm_medium").notNull(),
    utmCampaign: text("utm_campaign").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Soft archive: hides the link from the generator list and frees its
    // triple for re-use (see the partial unique below). Rows are kept —
    // historical sessions still match the triple.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    // One ACTIVE link per triple: analytics match on the exact triple, so
    // two live links sharing one would be indistinguishable in every report.
    // Partial so an archived link's triple can be reclaimed.
    uniqueIndex("marketing_links_active_triple_unique")
      .on(t.utmSource, t.utmMedium, t.utmCampaign)
      .where(sql`archived_at IS NULL`),
  ],
);

export type MarketingLink = typeof marketingLinks.$inferSelect;
export type NewMarketingLink = typeof marketingLinks.$inferInsert;
