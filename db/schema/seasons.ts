import { integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { shows } from "./shows";

export const seasons = pgTable(
  "seasons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    showId: uuid("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title"),
    description: text("description"),
  },
  (t) => [unique("seasons_show_id_number_unique").on(t.showId, t.number)],
);

export type Season = typeof seasons.$inferSelect;
export type NewSeason = typeof seasons.$inferInsert;
