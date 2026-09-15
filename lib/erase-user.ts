import * as Sentry from "@sentry/nextjs";
import { and, count, eq, gt, inArray, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/db/schema";
import {
  erasedCustomers,
  marketingLinks,
  showReminders,
  subscriptions,
  trialSessions,
  users,
  visitors,
  watchDays,
  watchProgress,
} from "@/db/schema";
import { describeError } from "@/lib/observability";
import {
  erasePosthogPerson,
  lookupPosthogPersons,
  type PosthogEraseResult,
  type PosthogLookupResult,
} from "@/lib/posthog-erase";
import type { PosthogQueryConfig } from "@/lib/posthog-hogql";
import { ACCESS_GRANTING_STATUSES } from "@/lib/subscription-status";
import { isSubjectId } from "@/lib/user-export";

// Art. 17 GDPR for our database and the processors we can reach — the ONE
// erasure mechanism, run by two callers with the same code: the Clerk
// `user.deleted` webhook (app/api/webhooks/clerk/route.ts) and
// `pnpm erase-user <id> --apply` (scripts/erase-user.ts) for the day the
// webhook did not arrive or a restore from backup resurrected what it had
// erased (docs/runbooks/db-restore.md §7). Clerk is the source of truth for
// the account: deleting it there (UserProfile → "Delete account", the
// dashboard, or our own hand-run erasure request) is the trigger; the
// script repeats the effect, it does not replace the trigger.
//
// Order, unchanged since #161/#179 and pinned by the tests:
//   1. a live Stripe subscription is set to cancel at period end
//      (best-effort — the erasure never waits for Stripe);
//   2. the customer id is tombstoned in erased_customers BEFORE the users
//      row goes, so the customer's later webhooks cannot re-create the
//      account through claimGuestCheckout (a failure here throws — the
//      tombstone is what makes the erasure stick);
//   3. DELETE show_reminders by the account's address and by user_id
//      (the one PII table keyed on the address rather than the account);
//   4. DELETE users — the FK actions declared in db/schema/* take the rest
//      (route.test.ts pins the map): CASCADE — subscriptions,
//      watch_progress, watch_days; SET NULL — trial_sessions, visitors
//      (visit history stays, de-identified), marketing_links.created_by;
//   5. the PostHog person behind the Clerk id, with its events
//      (best-effort, #180) — after the local rows, keyed by the id alone,
//      and ALSO when the local row was already gone: a redelivery or a
//      script re-run is how a processor step that failed gets retried.
// Idempotent: a re-run for an erased account writes nothing locally.
//
// Universal on purpose (no `server-only`, no env read, no module singleton):
// the database client, the Stripe client and the PostHog credentials are
// handed in, because a tsx script cannot load a `server-only` module
// (docs/gotchas.md) and the webhook must run the SAME code the script does.
// The Stripe Customer itself is NOT deleted here — whether to
// `customers.del` (invoices are Stripe's own tax records either way) is the
// owner's call, tracked in docs/registry.md.

export type EraseDb = Pick<
  PostgresJsDatabase<typeof schema>,
  "select" | "insert" | "delete"
>;

export type EraseStripeLike = {
  subscriptions: {
    update: (
      id: string,
      params: { cancel_at_period_end: true },
      options: { timeout: number; maxNetworkRetries: number },
    ) => Promise<unknown>;
  };
};

export type EraseUserDeps = {
  db: EraseDb;
  /**
   * Lazy on purpose: the client is built only when there is a live
   * subscription to cancel, and a missing key surfaces exactly like a
   * Stripe outage — the loud "cancel it at Stripe by hand" line by id
   * (lib/stripe.ts:getStripe throws without STRIPE_SECRET_KEY).
   */
  getStripe: () => EraseStripeLike;
  /** null → PostHog is skipped with `skipped_unconfigured`, no request made. */
  posthog: PosthogQueryConfig | null;
};

export type EraseUserResult =
  | {
      /** Already erased or never mirrored — nothing written locally. */
      status: "not_found";
      posthog: PosthogEraseResult;
    }
  | {
      status: "erased";
      reminderRows: number;
      stripeCustomer: boolean;
      liveSubscription: boolean;
      cancelRequested: boolean;
      posthog: PosthogEraseResult;
    };

// Per-request ceiling for the cancel-at-period-end call. Stripe answers in
// well under a second; the ceiling exists so a Stripe stall cannot consume
// the whole function budget before the local DELETEs run.
export const STRIPE_CANCEL_TIMEOUT_MS = 5_000;
// The SDK retries connection failures, timeouts and 5xx; the count is stated
// here so the worst case is a decision, not a surprise: 3 attempts × 5s plus
// backoff ≈ 17s, well inside the function budget. Retries are safe (stripe-node
// keys every POST with an idempotency key) and worth having: Svix's own
// redelivery cannot repeat THIS call — by then the local rows are gone and the
// handler finds no user — so after the last attempt the loud error log below
// is the only recovery path.
export const STRIPE_CANCEL_RETRIES = 2;

/** The one predicate for "a subscription Stripe is still billing". */
function liveSubscriptionWhere(userId: string) {
  return and(
    eq(subscriptions.userId, userId),
    inArray(subscriptions.status, [...ACCESS_GRANTING_STATUSES]),
    gt(subscriptions.currentPeriodEnd, new Date()),
  );
}

/** Reminder rows the account owns: by its (lowercased) address OR by user_id. */
function reminderRowsWhere(userId: string, email: string) {
  return or(
    eq(showReminders.email, email.toLowerCase()),
    eq(showReminders.userId, userId),
  );
}

export async function eraseUser(
  userId: string,
  deps: EraseUserDeps,
): Promise<EraseUserResult> {
  const { db } = deps;

  const [user] = await db
    .select({ email: users.email, stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    // Already erased (Clerk redelivers on timeouts; the script is re-run
    // after a restore) or never mirrored — the local end state holds. The
    // processor step still runs: it needs only the id, and this is the
    // retry path for a PostHog failure on the first pass.
    return {
      status: "not_found",
      posthog: await erasePosthogAndReport(userId, deps.posthog),
    };
  }

  // Money guard. A live Stripe subscription outlives the account — Stripe
  // keeps billing a customer who can no longer sign in. The subscription is
  // set to cancel at the end of the paid period (the viewer keeps what they
  // paid for; nothing is charged after). `cancel_at_period_end: true` is
  // idempotent at Stripe — a Clerk redelivery that reaches this point again
  // re-sets the same flag. Best-effort: a Stripe failure must not stop the
  // erasure (the account is the thing the user asked to be rid of), but it
  // must not be silent either — the ids (never the address) go to the log
  // AND to Sentry, because Vercel logs live a day and Sentry drops console
  // breadcrumbs wholesale. A short request timeout keeps a slow Stripe from
  // eating the function budget the DELETEs below still need.
  const [liveSub] = await db
    .select({ stripeSubscriptionId: subscriptions.stripeSubscriptionId })
    .from(subscriptions)
    .where(liveSubscriptionWhere(userId))
    .limit(1);
  let cancelRequested = false;
  if (liveSub) {
    const ids = {
      userId,
      stripeCustomerId: user.stripeCustomerId,
      stripeSubscriptionId: liveSub.stripeSubscriptionId,
    };
    try {
      await deps.getStripe().subscriptions.update(
        liveSub.stripeSubscriptionId,
        { cancel_at_period_end: true },
        {
          timeout: STRIPE_CANCEL_TIMEOUT_MS,
          maxNetworkRetries: STRIPE_CANCEL_RETRIES,
        },
      );
      cancelRequested = true;
      console.info(
        "erase user: live Stripe subscription set to cancel at period end",
        ids,
      );
    } catch (err) {
      // Stripe's error text is not echoed: it quotes request parameters,
      // and the log-audit only allows ids and statuses through. Name, code
      // and HTTP status are enough to tell "no such subscription" from
      // "Stripe is down".
      console.error(
        "erase user: could NOT schedule the live Stripe subscription's cancellation — cancel it at Stripe by hand",
        { ...ids, error: describeError(err) },
      );
    }
    Sentry.captureMessage(
      cancelRequested
        ? "erase user: live Stripe subscription set to cancel at period end"
        : "erase user: live Stripe subscription NOT cancelled — cancel by hand",
      {
        level: cancelRequested ? "info" : "error",
        tags: {
          userId,
          stripeSubscriptionId: liveSub.stripeSubscriptionId,
          cancelRequested: String(cancelRequested),
        },
      },
    );
  }

  // Tombstone the Stripe customer BEFORE the users row goes: from here on
  // the customer's webhooks (the cancel-at-period-end update just
  // requested, a renewal, the final subscription.deleted) find no local
  // user, and a guest sub's `guest = "1"` metadata would otherwise send them
  // into claimGuestCheckout to re-create the account. Write-if-absent, so a
  // redelivery is a no-op; a failure here throws (500 → Clerk retries) —
  // unlike the Stripe call above, this row is what makes the erasure stick.
  if (user.stripeCustomerId) {
    await db
      .insert(erasedCustomers)
      .values({ stripeCustomerId: user.stripeCustomerId })
      .onConflictDoNothing({ target: erasedCustomers.stripeCustomerId });
  }

  // No transaction around the two DELETEs — on purpose: the only partial
  // state a crash between them can leave is "reminders gone, users row still
  // here", i.e. too much erased, never a surviving address; the 500 makes
  // Clerk retry and the retry converges (reminders already gone, users found
  // and deleted). The order matters: reminders first, or SET NULL would cut
  // the user_id link before the explicit delete can use it.

  // "Delete my account" erases the reminder requests too: every row for the
  // account's address (the same reach as unsubscribeEmail — the address IS
  // the subscription) plus any row the account linked under another
  // address. This runs BEFORE the users DELETE, because the FK's SET NULL
  // would drop that link first. Reminder addresses are stored lowercased.
  const reminders = await db
    .delete(showReminders)
    .where(reminderRowsWhere(userId, user.email))
    .returning({ id: showReminders.id });

  await db.delete(users).where(eq(users.id, userId));

  const posthog = await erasePosthogAndReport(userId, deps.posthog);

  console.info("erase user: local data erased", {
    userId,
    reminderRows: reminders.length,
    stripeCustomer: user.stripeCustomerId !== null,
    liveSubscription: liveSub !== undefined,
    cancelRequested,
    posthog: posthog.status,
    posthogPersons: posthog.personIds.length,
  });
  return {
    status: "erased",
    reminderRows: reminders.length,
    stripeCustomer: user.stripeCustomerId !== null,
    liveSubscription: liveSub !== undefined,
    cancelRequested,
    posthog,
  };
}

// The processor half, with its reporting: a person left standing at PostHog
// is a human's task (runbook §4 — the dashboard's "Delete person" button),
// so both outcomes that leave one are shouted by id to the log AND to
// Sentry, like the Stripe cancellation above. `skipped_forbidden` is the
// key lacking person:write; `failed` is an outage, a timeout or an
// unexpected answer. `deleted` / `not_found` / `skipped_unconfigured` ride
// the info line only.
async function erasePosthogAndReport(
  userId: string,
  cfg: PosthogQueryConfig | null,
): Promise<PosthogEraseResult> {
  const result = await erasePosthogPerson(cfg, userId);
  if (result.status === "skipped_forbidden" || result.status === "failed") {
    console.error(
      "erase user: PostHog person NOT erased — delete it by hand (docs/runbooks/gdpr-requests.md §4)",
      {
        userId,
        posthog: result.status,
        personIds: result.personIds,
        httpStatus: result.httpStatus,
        error: result.error,
      },
    );
    Sentry.captureMessage(
      "erase user: PostHog person NOT erased — delete by hand",
      {
        level: "error",
        tags: { userId, posthogStatus: result.status },
      },
    );
  }
  return result;
}

// ── Dry run (scripts/erase-user.ts) ─────────────────────────────────────
// What an --apply would touch, as COUNTS by the same predicates the erasure
// uses — every clause a Drizzle expression the tests render and read.
// Reads only; the script prints this and stops unless told otherwise.

export type ErasePreview = {
  /** false → nothing to erase locally (already erased or never mirrored). */
  found: boolean;
  /** Rows the erasure deletes (explicitly or through CASCADE). */
  deleted: {
    users: number;
    show_reminders: number;
    subscriptions: number;
    watch_progress: number;
    watch_days: number;
  };
  /** Rows that survive with user_id → NULL (SET NULL). */
  deidentified: {
    trial_sessions: number;
    visitors: number;
    marketing_links: number;
  };
  stripeCustomer: boolean;
  /** The customer id is already in erased_customers. */
  tombstoned: boolean;
  /** A subscription Stripe is still billing — --apply asks Stripe to cancel it. */
  liveSubscription: boolean;
  posthog: PosthogLookupResult;
};

export async function previewErasure(
  userId: string,
  deps: { db: EraseDb; posthog: PosthogQueryConfig | null },
): Promise<ErasePreview> {
  const { db } = deps;
  const total = async (
    where: ReturnType<typeof eq> | ReturnType<typeof or>,
    table:
      | typeof users
      | typeof showReminders
      | typeof subscriptions
      | typeof watchProgress
      | typeof watchDays
      | typeof trialSessions
      | typeof visitors
      | typeof marketingLinks
      | typeof erasedCustomers,
  ) => {
    const [row] = await db.select({ n: count() }).from(table).where(where);
    return Number(row?.n ?? 0);
  };

  const [user] = await db
    .select({ email: users.email, stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const [reminders, subs, progress, days, trials, visits, links, live] =
    await Promise.all([
      total(
        user
          ? reminderRowsWhere(userId, user.email)
          : eq(showReminders.userId, userId),
        showReminders,
      ),
      total(eq(subscriptions.userId, userId), subscriptions),
      total(eq(watchProgress.userId, userId), watchProgress),
      total(eq(watchDays.userId, userId), watchDays),
      total(eq(trialSessions.userId, userId), trialSessions),
      total(eq(visitors.userId, userId), visitors),
      total(eq(marketingLinks.createdBy, userId), marketingLinks),
      total(liveSubscriptionWhere(userId), subscriptions),
    ]);
  const tombstoned = user?.stripeCustomerId
    ? (await total(
        eq(erasedCustomers.stripeCustomerId, user.stripeCustomerId),
        erasedCustomers,
      )) > 0
    : false;

  return {
    found: user !== undefined,
    deleted: {
      users: user ? 1 : 0,
      show_reminders: reminders,
      subscriptions: subs,
      watch_progress: progress,
      watch_days: days,
    },
    deidentified: {
      trial_sessions: trials,
      visitors: visits,
      marketing_links: links,
    },
    stripeCustomer: Boolean(user?.stripeCustomerId),
    tombstoned,
    liveSubscription: live > 0,
    posthog: await lookupPosthogPersons(deps.posthog, userId),
  };
}

// ── The script's stdout ─────────────────────────────────────────────────
// Ids, counts and statuses — never a value. The log audit pins it.

export function summarizeErasePreview(
  userId: string,
  p: ErasePreview,
): string {
  const counts = (o: Record<string, number>) =>
    Object.entries(o)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
  return [
    `subject: ${userId}${p.found ? "" : " (no users row — already erased or never mirrored)"}`,
    `would delete: ${counts(p.deleted)}`,
    `would de-identify (user_id → NULL): ${counts(p.deidentified)}`,
    `stripe: customer=${p.stripeCustomer ? (p.tombstoned ? "yes (tombstoned)" : "yes") : "none"} live_subscription=${p.liveSubscription ? "yes (would be set to cancel at period end)" : "no"}`,
    `posthog: ${p.posthog.status}${p.posthog.personIds.length > 0 ? ` persons=${p.posthog.personIds.length}` : ""}${p.posthog.httpStatus ? ` http=${p.posthog.httpStatus}` : ""}${p.posthog.error ? ` error=${p.posthog.error.name}` : ""}`,
  ].join("\n");
}

export function summarizeEraseResult(
  userId: string,
  r: EraseUserResult,
): string {
  const posthog = `posthog: ${r.posthog.status}${r.posthog.personIds.length > 0 ? ` persons=${r.posthog.personIds.length}` : ""}${r.posthog.httpStatus ? ` http=${r.posthog.httpStatus}` : ""}${r.posthog.error ? ` error=${r.posthog.error.name}` : ""}`;
  if (r.status === "not_found") {
    return [`subject: ${userId}`, "local: nothing to erase (no users row)", posthog].join("\n");
  }
  return [
    `subject: ${userId}`,
    `local: erased (show_reminders=${r.reminderRows}, users=1 + cascades)`,
    `stripe: customer=${r.stripeCustomer ? "tombstoned" : "none"} live_subscription=${r.liveSubscription ? (r.cancelRequested ? "cancel at period end requested" : "NOT cancelled — cancel by hand") : "no"}`,
    posthog,
  ].join("\n");
}

/** Vendor steps an --apply left for a human (the script's exit code 3). */
export function stepsLeftByHand(r: EraseUserResult): string[] {
  const left: string[] = [];
  if (r.status === "erased" && r.liveSubscription && !r.cancelRequested) {
    left.push("stripe: cancel the live subscription by hand");
  }
  if (r.posthog.status === "skipped_forbidden" || r.posthog.status === "failed") {
    left.push("posthog: delete the person by hand (runbook §4)");
  }
  return left;
}

// ── CLI arguments ───────────────────────────────────────────────────────

export const ERASE_USAGE =
  "usage: DATABASE_URL=<host> pnpm erase-user <userId> [--apply]\n" +
  "  userId   — the Clerk id (users.id), e.g. user_2abc…; the account must already be deleted in Clerk\n" +
  "  --apply  — actually erase; without it the script prints what WOULD be erased and changes nothing\n" +
  "  Optional, best-effort: STRIPE_SECRET_KEY (cancel a live subscription), POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID (delete the person).\n" +
  "  Nothing is read from .env.local on purpose — every variable is passed explicitly.";

export type ParsedEraseArgs =
  | { ok: true; userId: string; apply: boolean }
  | {
      ok: false;
      reason: "missing_user_id" | "invalid_user_id" | "unknown_argument";
      message: string;
    };

export function parseEraseArgs(argv: readonly string[]): ParsedEraseArgs {
  let userId: string | null = null;
  let apply = false;
  for (const arg of argv) {
    if (arg === "--apply") {
      apply = true;
    } else if (arg.startsWith("-") || userId !== null) {
      return {
        ok: false,
        reason: "unknown_argument",
        message: `unexpected argument: ${arg}`,
      };
    } else {
      userId = arg;
    }
  }
  if (userId === null) {
    return { ok: false, reason: "missing_user_id", message: "missing <userId>" };
  }
  if (!isSubjectId(userId)) {
    return {
      ok: false,
      reason: "invalid_user_id",
      message: "userId may only contain letters, digits, '_' and '-'",
    };
  }
  return { ok: true, userId, apply };
}
