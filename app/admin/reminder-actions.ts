"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons, showReminders, shows } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { unsubscribeUrls } from "@/lib/email-unsubscribe";
import { renderShowReminderEmail } from "@/lib/reminder-email";
import {
  emailFrom,
  emailReplyTo,
  getResend,
  resendConfigured,
} from "@/lib/resend";

// "Notify waiting viewers" — dispatches the show_reminders backlog for a
// show through Resend, announcing one specific (ready) episode. Typed
// result state instead of throw-to-boundary because the panel reports
// success/failure inline (same reasoning as links/actions.ts).
export type SendRemindersState =
  | { status: "idle" }
  | { status: "ok"; sent: number }
  | {
      status: "error";
      code:
        | "not_configured"
        | "episode_invalid"
        | "no_pending"
        | "send_failed"
        | "unknown";
      // Emails already dispatched before the failure — a partial send is
      // real information the admin needs ("173 went out, then Resend
      // errored"), not something to hide behind a bare error.
      sent: number;
    };

// Resend's batch API cap. Batches go out sequentially — the default API
// rate limit (5 req/s) is nowhere near a concern at that cadence.
const BATCH_SIZE = 100;
// Loop safety backstop: 50 batches = 5,000 emails, far above both the
// plausible backlog and the free-plan daily cap. Hitting it means
// something is wrong, not that more sending is needed.
const MAX_BATCHES = 50;

export async function sendShowReminders(
  _prev: SendRemindersState,
  formData: FormData,
): Promise<SendRemindersState> {
  await requireAdmin();

  try {
    const showId = String(formData.get("showId") ?? "");
    const episodeId = String(formData.get("episodeId") ?? "");
    if (!showId || !episodeId) {
      return { status: "error", code: "episode_invalid", sent: 0 };
    }

    if (!resendConfigured()) {
      return { status: "error", code: "not_configured", sent: 0 };
    }

    // Re-verify the whole chain server-side: the episode must belong to
    // this show, be ready to stream, and the show must be publicly
    // reachable — we're about to put a link to it in people's inboxes.
    const [target] = await db
      .select({
        episodeNumber: episodes.number,
        episodeTitle: episodes.title,
        seasonNumber: seasons.number,
        showTitle: shows.title,
        showSlug: shows.slug,
      })
      .from(episodes)
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .innerJoin(shows, eq(seasons.showId, shows.id))
      .where(
        and(
          eq(episodes.id, episodeId),
          eq(seasons.showId, showId),
          eq(episodes.status, "ready"),
          eq(shows.status, "published"),
          isNull(shows.deletedAt),
        ),
      )
      .limit(1);
    if (!target) {
      return { status: "error", code: "episode_invalid", sent: 0 };
    }

    const origin = process.env.NEXT_PUBLIC_APP_URL ?? "https://matio.tv";
    // Deep link straight to the announced episode (?ep= takes the episode
    // id — same param SignupWall uses). UTM triple is normalizeUtm-clean
    // so the attribution pipeline can segment email-driven sessions.
    const watchUrl = `${origin}/watch/${target.showSlug}?ep=${episodeId}&utm_source=email&utm_medium=email&utm_campaign=show-reminder`;

    let sent = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      // Claim-then-send: stamp notified_at BEFORE dispatching so a crash
      // mid-send can't double-email anyone; a failed batch reverts its
      // claim below. FOR UPDATE SKIP LOCKED makes concurrent clicks (two
      // admin tabs) claim disjoint rows instead of double-sending.
      const batch = await db
        .update(showReminders)
        .set({ notifiedAt: new Date() })
        .where(
          inArray(
            showReminders.id,
            db
              .select({ id: showReminders.id })
              .from(showReminders)
              .where(
                and(
                  eq(showReminders.showId, showId),
                  isNull(showReminders.notifiedAt),
                ),
              )
              .orderBy(asc(showReminders.createdAt))
              .limit(BATCH_SIZE)
              .for("update", { skipLocked: true }),
          ),
        )
        .returning({
          id: showReminders.id,
          email: showReminders.email,
          locale: showReminders.locale,
        });

      if (batch.length === 0) {
        if (sent === 0) {
          return { status: "error", code: "no_pending", sent: 0 };
        }
        break;
      }

      const payload = batch.map((row) => {
        const { page, oneClick } = unsubscribeUrls(row.email);
        const rendered = renderShowReminderEmail({
          locale: row.locale,
          showTitle: target.showTitle,
          seasonNumber: target.seasonNumber,
          episodeNumber: target.episodeNumber,
          episodeTitle: target.episodeTitle,
          watchUrl,
          unsubscribePageUrl: page,
        });
        return {
          from: emailFrom(),
          to: [row.email],
          replyTo: emailReplyTo(),
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          // RFC 8058 one-click unsubscribe — Gmail/Yahoo bulk-sender
          // requirement; the POST target authenticates via HMAC token.
          headers: {
            "List-Unsubscribe": `<${oneClick}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        };
      });

      // Deterministic idempotency key over the SORTED claimed-row-id set:
      // an identical retry (same rows, any RETURNING order — Postgres
      // doesn't guarantee one) reuses the key, so a "failed" batch that
      // Resend actually accepted dedupes server-side for 24h; a retry
      // whose composition changed (new signup, unsubscribe) mints a NEW
      // key instead of 409-wedging on invalid_idempotent_request.
      // Remaining accepted edge: accepted-but-response-lost + composition
      // change before retry double-delivers the overlap — a duplicate
      // email is less harm than falsely marking rows sent.
      const claimDigest = crypto
        .createHash("sha256")
        .update(
          batch
            .map((b) => b.id)
            .sort()
            .join(","),
        )
        .digest("hex")
        .slice(0, 40);
      // Permissive validation: one Resend-rejected address fails only its
      // own item (reported in data.errors) instead of the whole batch —
      // strict mode would re-wedge the backlog on every retry.
      const { data, error } = await getResend().batch.send(payload, {
        idempotencyKey: `show-reminder/${episodeId}/${claimDigest}`,
        batchValidation: "permissive",
      });

      if (error) {
        // Un-claim so the rows stay owed an email. If THIS write also
        // fails the rows read as sent-but-weren't — hence the loud log
        // with the exact ids for manual repair.
        const ids = batch.map((b) => b.id);
        try {
          await db
            .update(showReminders)
            .set({ notifiedAt: null })
            .where(inArray(showReminders.id, ids));
        } catch (revertErr) {
          console.error(
            "[reminders] failed to un-claim after send error; rows stamped notified but NOT emailed:",
            ids,
            revertErr,
          );
        }
        console.error(
          `[reminders] batch send failed for show ${showId}:`,
          error.name,
          error.message,
        );
        revalidatePath(`/admin/shows/${showId}`);
        return { status: "error", code: "send_failed", sent };
      }

      // Per-item rejects (invalid address etc.): deliberately keep those
      // rows STAMPED — un-claiming a permanently-bad address would wedge
      // every future send. Logged with row ids for manual repair.
      const itemErrors = data?.errors ?? [];
      if (itemErrors.length > 0) {
        console.error(
          `[reminders] ${itemErrors.length} item(s) rejected in batch for show ${showId}:`,
          itemErrors.map((e) => ({
            rowId: batch[e.index]?.id,
            message: e.message,
          })),
        );
      }
      sent += batch.length - itemErrors.length;
    }

    revalidatePath(`/admin/shows/${showId}`);
    return { status: "ok", sent };
  } catch (err) {
    console.error("[reminders] sendShowReminders failed:", err);
    return { status: "error", code: "unknown", sent: 0 };
  }
}
