import { config } from "dotenv";
config({ path: ".env.local" });

// Seeds the catalog with placeholder shows for layout/density testing. Every
// row gets slug `demo-*` so they're trivial to wipe later
// (`DELETE FROM shows WHERE slug LIKE 'demo-%'`). No seasons/episodes attach,
// so visiting any of them renders the "Coming soon" branch on /watch.
// Idempotent on slug — re-running adds anything new and leaves existing rows
// alone. Pass `--reset` to delete demo rows instead.

const FAKE_SHOWS: Array<{
  slug: string;
  title: string;
  description: string;
  genre: string[];
}> = [
  { slug: "demo-the-bleeding-sun", title: "The Bleeding Sun", description: "A war photographer returns to her hometown to find it under a quieter, stranger occupation.", genre: ["drama", "thriller"] },
  { slug: "demo-aurora-blackout", title: "Aurora Blackout", description: "When the northern lights stop appearing, a power-grid engineer follows the silence north.", genre: ["sci-fi", "mystery"] },
  { slug: "demo-echoes-of-november", title: "Echoes of November", description: "Three estranged siblings inherit a vineyard and the secret it was bought to bury.", genre: ["drama"] },
  { slug: "demo-glasshouse", title: "Glasshouse", description: "A botanist's research station becomes a locked room when one of her plants starts answering questions.", genre: ["thriller", "mystery"] },
  { slug: "demo-wandering-tide", title: "Wandering Tide", description: "Two former lovers reunite on a slow ferry that keeps missing its port.", genre: ["drama", "romance"] },
  { slug: "demo-the-hourglass-verdict", title: "The Hourglass Verdict", description: "A defense lawyer with six hours to find the witness that didn't survive the trial.", genre: ["thriller", "drama"] },
  { slug: "demo-crowfall", title: "Crowfall", description: "In a kingdom where memory is currency, a thief discovers she has too much of it.", genre: ["fantasy", "drama"] },
  { slug: "demo-lighter-than-smoke", title: "Lighter Than Smoke", description: "A failed magician's children stage one last show to save the family theater.", genre: ["comedy", "drama"] },
  { slug: "demo-iron-saints", title: "Iron Saints", description: "Two cousins enlist in a foreign army and meet again on opposite sides of a borderless war.", genre: ["action", "drama"] },
  { slug: "demo-below-zero-hour", title: "Below Zero Hour", description: "An Arctic rescue pilot races a storm she's flown into on purpose.", genre: ["thriller"] },
  { slug: "demo-saltwater-holiday", title: "Saltwater Holiday", description: "Six strangers, one rental house, and a tide that won't stop bringing things back.", genre: ["comedy", "romance"] },
  { slug: "demo-the-quiet-architect", title: "The Quiet Architect", description: "Every building she designs starts disappearing — but only from the city's records.", genre: ["drama", "mystery"] },
  { slug: "demo-static-bloom", title: "Static Bloom", description: "A radio host and her favorite listener meet in person and break the show.", genre: ["sci-fi", "romance"] },
  { slug: "demo-last-train-to-nowhere", title: "Last Train to Nowhere", description: "The 11:47 still runs, but only certain passengers can find the platform.", genre: ["drama", "thriller"] },
  { slug: "demo-goldfinch-run", title: "Goldfinch Run", description: "A pair of small-time thieves are given a job that pays in birds.", genre: ["comedy", "action"] },
  { slug: "demo-midnight-garden-society", title: "Midnight Garden Society", description: "Six retirees, one community plot, and a body under the rhubarb.", genre: ["mystery", "drama"] },
  { slug: "demo-the-cartographers-daughter", title: "The Cartographer's Daughter", description: "She redraws coastlines for a living and finds one that shouldn't exist.", genre: ["drama", "adventure"] },
  { slug: "demo-halcyon", title: "Halcyon", description: "On the colony ship, the captain wakes a year early. So does the ship.", genre: ["sci-fi", "drama"] },
  { slug: "demo-burnt-letters", title: "Burnt Letters", description: "An archivist finds her grandmother in the marginalia of a stranger's diary.", genre: ["mystery"] },
  { slug: "demo-the-pale-witness", title: "The Pale Witness", description: "The only person who saw the crime swears she wasn't there. The footage agrees.", genre: ["thriller", "mystery"] },
  { slug: "demo-vermillion", title: "Vermillion", description: "Two painters share a studio, a city, and an obsession that's killed people before.", genre: ["drama"] },
  { slug: "demo-the-last-cathedral", title: "The Last Cathedral", description: "Inside the four-hundred-year restoration that nearly toppled a continent.", genre: ["documentary"] },
  { slug: "demo-tomorrows-ghost", title: "Tomorrow's Ghost", description: "A grief counselor starts receiving voicemails from clients she hasn't met yet.", genre: ["sci-fi"] },
  { slug: "demo-coda", title: "Coda", description: "A retired pianist agrees to one final concert in the city that broke her.", genre: ["drama", "romance"] },
  { slug: "demo-wild-honey", title: "Wild Honey", description: "Three generations of women, one beekeeping operation, and a season that won't end.", genre: ["drama"] },
  { slug: "demo-the-empty-chapel", title: "The Empty Chapel", description: "The congregation hasn't gathered in twenty years. The bell rings anyway.", genre: ["horror"] },
  { slug: "demo-paper-birds", title: "Paper Birds", description: "A boy folds origami every night for the friend he hasn't met yet.", genre: ["animation", "drama"] },
  { slug: "demo-the-tin-diaries", title: "The Tin Diaries", description: "Two roommates document their twenties in cassette tape and bad coffee.", genre: ["drama", "comedy"] },
  { slug: "demo-slow-burn", title: "Slow Burn", description: "Arson investigator. Family member. Every fire points home.", genre: ["thriller"] },
  { slug: "demo-twelve-streets", title: "Twelve Streets", description: "A taxi driver works a single neighborhood for thirty years and notices a pattern.", genre: ["drama", "mystery"] },
  { slug: "demo-brass-and-bone", title: "Brass and Bone", description: "A jazz drummer in 1920s Chicago is recruited for one more kind of band.", genre: ["action", "drama"] },
  { slug: "demo-the-cardinal-path", title: "The Cardinal Path", description: "A pilgrim trail. A vanished party of seven. A guide who insists they're still walking.", genre: ["mystery"] },
  { slug: "demo-frostline", title: "Frostline", description: "Border guards in a country that hasn't agreed to its own map yet.", genre: ["thriller", "action"] },
  { slug: "demo-honest-theft", title: "Honest Theft", description: "She returns everything she steals. The police are starting to recognize the pattern.", genre: ["comedy", "drama"] },
  { slug: "demo-the-glass-lighthouse", title: "The Glass Lighthouse", description: "The keeper, the storm, and the light that's been answering back.", genre: ["drama"] },
];

async function main() {
  const reset = process.argv.includes("--reset");

  // Dynamic import so DATABASE_URL is populated before db/index loads it.
  const { db } = await import("../db/index.js");
  const { shows } = await import("../db/schema/index.js");
  const { eq, like } = await import("drizzle-orm");

  if (reset) {
    const removed = await db
      .delete(shows)
      .where(like(shows.slug, "demo-%"))
      .returning({ slug: shows.slug });
    console.log(`Removed ${removed.length} demo show(s).`);
    process.exit(0);
  }

  let inserted = 0;
  let skipped = 0;

  for (const [i, show] of FAKE_SHOWS.entries()) {
    const result = await db
      .insert(shows)
      .values({
        slug: show.slug,
        title: show.title,
        description: show.description,
        genre: show.genre,
        status: "published",
        // Alternate which homepage section each demo lives in so both rows
        // have content out of the box. Admin can re-toggle per-show later.
        justReleased: i % 2 === 0,
        popularNow: i % 2 === 1,
      })
      .onConflictDoNothing({ target: shows.slug })
      .returning({ id: shows.id });

    if (result.length > 0) inserted++;
    else skipped++;
  }

  // Re-flag any pre-existing demo rows that were inserted before homepage
  // sections existed. Safe to run repeatedly — restores the alternating
  // split if you've been toggling things in admin to test.
  for (const [i, show] of FAKE_SHOWS.entries()) {
    await db
      .update(shows)
      .set({
        justReleased: i % 2 === 0,
        popularNow: i % 2 === 1,
      })
      .where(eq(shows.slug, show.slug));
  }

  console.log(
    `Inserted ${inserted} demo show(s), skipped ${skipped} (slug already existed); re-flagged section membership across all demo rows.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
