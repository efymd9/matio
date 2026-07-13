"use client";

import { useActionState } from "react";
import {
  sendShowReminders,
  type SendRemindersState,
} from "@/app/admin/reminder-actions";
import { FormSubmitButton } from "@/components/admin/form-submit-button";
import { useAdminT } from "@/lib/i18n/admin-client";

// Body of the "Episode reminders" panel on the admin show page. The panel
// shell (kicker/title/badge) is server-rendered by the page; this client
// island owns the episode picker + send button + inline result feedback
// (useActionState + typed-state action, same pattern as link-form.tsx).
export function RemindersPanel({
  showId,
  isPublished,
  configured,
  pendingCount,
  sentCount,
  episodes,
}: {
  showId: string;
  isPublished: boolean;
  configured: boolean;
  pendingCount: number;
  sentCount: number;
  episodes: { id: string; label: string }[];
}) {
  const t = useAdminT();
  const tr = t.reminders;
  const [state, formAction] = useActionState<SendRemindersState, FormData>(
    sendShowReminders,
    { status: "idle" },
  );

  const errorCopy: Record<
    Extract<SendRemindersState, { status: "error" }>["code"],
    string
  > = {
    not_configured: tr.notConfigured,
    episode_invalid: tr.errorEpisodeInvalid,
    no_pending: tr.errorNoPending,
    send_failed: tr.errorSendFailed,
    unknown: tr.errorUnknown,
  };

  // A successful send leaves pendingCount stale until the revalidated
  // page streams in — prefer the action result when we have one.
  const sentJustNow = state.status === "ok" ? state.sent : 0;
  const effectivePending = Math.max(0, pendingCount - sentJustNow);

  let hint: string | null = null;
  if (!configured) hint = tr.notConfigured;
  else if (!isPublished) hint = tr.publishFirst;
  else if (episodes.length === 0) hint = tr.noEpisodes;
  else if (effectivePending === 0 && state.status !== "ok") hint = tr.noPending;

  return (
    <div className="space-y-4">
      <p className="text-sm text-cream/65">{tr.description}</p>

      {hint ? (
        <p className="text-sm text-cream/50">{hint}</p>
      ) : (
        <form
          action={formAction}
          onSubmit={(e) => {
            if (!window.confirm(tr.confirmSend(effectivePending))) {
              e.preventDefault();
            }
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="showId" value={showId} />
          {/* Native <select>, same reasoning as the cast picker: a plain
              form post doesn't justify pulling in the client Select. */}
          <select
            name="episodeId"
            required
            defaultValue={episodes[0]?.id}
            aria-label={tr.episodeAria}
            className="h-8 rounded-md border border-white/15 bg-black/40 px-2.5 text-xs font-semibold text-cream/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
          >
            {episodes.map((ep) => (
              <option key={ep.id} value={ep.id}>
                {ep.label}
              </option>
            ))}
          </select>
          <FormSubmitButton pendingLabel={tr.sendPending}>
            {tr.sendCta}
          </FormSubmitButton>
        </form>
      )}

      {state.status === "error" ? (
        <p className="rounded-lg border border-rust/25 bg-rust/[0.08] px-3 py-2 text-sm text-rust">
          {errorCopy[state.code]}
          {state.sent > 0 ? ` ${tr.sentOk(state.sent)}` : null}
        </p>
      ) : null}
      {state.status === "ok" ? (
        <p className="rounded-lg border border-gold/25 bg-gold/[0.07] px-3 py-2 text-sm text-gold">
          {tr.sentOk(state.sent)}
        </p>
      ) : null}

      {sentCount > 0 ? (
        <p className="text-xs text-cream/40">{tr.sentSoFar(sentCount)}</p>
      ) : null}
    </div>
  );
}
