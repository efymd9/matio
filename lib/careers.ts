// The open roles on /careers (#376) — defined in code, universal and pure: the
// public page renders them, the application form picks one, the server action
// and lib/job-application.ts validate against the ids, and the admin panel
// filters by them. A vacancy CRUD in the admin panel is a later task
// (docs/registry.md); until then a role changes here, in one place.
//
// The copy is a draft built from the studio facts on /about and nothing else:
// no salary, perks, city or office. `location` / `employmentType` are null
// until the owner gives them — a null fact is simply not drawn (never a
// placeholder in production).
//
// The ids are also the values of the `job_position` enum (db/schema/
// job_applications.ts) and the anchors on the page (#ai-creator,
// #sales-distribution) — a new id needs a migration adding the enum value.

export const JOB_POSITIONS = ["ai-creator", "sales-distribution"] as const;
export type JobPosition = (typeof JOB_POSITIONS)[number];

export type Vacancy = {
  id: JobPosition;
  /** The role as a heading. */
  title: string;
  /** The role in the position picker and the admin filter. */
  shortTitle: string;
  summary: string;
  /** null → the fact row is not rendered. */
  location: string | null;
  /** null → the fact row is not rendered. */
  employmentType: string | null;
  whatYoullDo: readonly string[];
  whatWereLookingFor: readonly string[];
  /** The form's portfolio field: its label, and whether this role needs it. */
  portfolioLabel: string;
  portfolioRequired: boolean;
  /** The help line under "About you" once this role is picked. */
  aboutHint: string;
};

export const VACANCIES: Record<JobPosition, Vacancy> = {
  "ai-creator": {
    id: "ai-creator",
    title: "AI Creator",
    shortTitle: "AI Creator",
    summary: "Turn our scripts into scenes with a 12+ tool AI pipeline.",
    location: null,
    employmentType: null,
    whatYoullDo: [
      "Build shots, characters and locations that hold one look across a whole series",
      "Generate, edit and finish episodes for horizontal and vertical screens",
      "Cut trailers, clips and social edits for our shows",
      "Test new tools and fold the good ones into the pipeline",
    ],
    whatWereLookingFor: [
      "A portfolio of AI video or imagery you made yourself",
      "Hands-on work with generative image and video tools, and an editor",
      "An eye for atmosphere, light and continuity",
      "A feel for dark romance and short-form drama",
    ],
    portfolioLabel: "Portfolio or reel",
    portfolioRequired: true,
    aboutHint: "The tools you use and what you've made with them.",
  },
  "sales-distribution": {
    id: "sales-distribution",
    title: "Sales & Distribution Manager",
    shortTitle: "Sales & Distribution",
    summary: "Take Matio's series to platforms, broadcasters and distributors.",
    location: null,
    employmentType: null,
    whatYoullDo: [
      "Find and win platforms, distributors and buyers for our series",
      "Run the pipeline from first outreach to signed deal",
      "Prepare pitch decks, screeners and offers with the team",
      "Open markets for English- and Spanish-language content",
    ],
    whatWereLookingFor: [
      "Experience selling or licensing film, TV or digital content",
      "Relationships with platforms, distributors or buyers",
      "Comfort with rights, windows and deal terms",
      "Strong written English (Spanish is a plus)",
    ],
    portfolioLabel: "Website or other work",
    portfolioRequired: false,
    aboutHint: "Markets, platforms and buyers you've worked with.",
  },
};

/** The roles in page order. */
export const VACANCY_LIST: readonly Vacancy[] = JOB_POSITIONS.map(
  (id) => VACANCIES[id],
);

export function isJobPosition(value: unknown): value is JobPosition {
  return (
    typeof value === "string" &&
    (JOB_POSITIONS as readonly string[]).includes(value)
  );
}
