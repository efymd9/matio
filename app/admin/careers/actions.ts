"use server";

import * as Sentry from "@sentry/nextjs";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { jobApplications } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { describeDbError } from "@/lib/db-errors";

// The one write the admin panel has on job applications (#376): delete — for
// spam, and for a candidate who asks by email (runbook
// docs/runbooks/gdpr-requests.md). There is no edit and no status on purpose.
//
// A TYPED answer, not a throw: a failed DELETE comes back as
// `{ ok: false, error: "failed" }` and the form says so inline (a thrown
// message is masked in prod — the 2026-07-16 lesson). The admin check stays
// a redirect (requireAdmin), as everywhere in the panel. `after` is bound by
// the page, the deleteIdeaSubmission idiom: the list stays on revalidatePath
// (its row disappears), the detail page leaves for the list because its own
// row is gone. useActionState calls the bound action with (prevState,
// formData); neither is read, so neither is declared.

export type DeleteJobApplicationState = { ok: true } | { ok: false; error: "failed" } | null;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function deleteJobApplication(
  id: string,
  after: "list" | "detail",
): Promise<DeleteJobApplicationState> {
  await requireAdmin();
  // The id is bound by the page itself; a forged post with garbage would
  // be a 22P02 at the driver — answered like any other failure.
  if (!UUID_RE.test(id)) return { ok: false, error: "failed" };
  try {
    await db.delete(jobApplications).where(eq(jobApplications.id, id));
  } catch (e) {
    // Class and SQLSTATE only — the statement binds nothing personal, but
    // the rule is the same for every path that reports a DB failure.
    const { name, code } = describeDbError(e);
    console.error("deleteJobApplication: failed", { id, name, code });
    Sentry.captureMessage("deleteJobApplication: failed", {
      level: "error",
      tags: { code: code ?? "none", name },
    });
    return { ok: false, error: "failed" };
  }
  revalidatePath("/admin/careers");
  if (after === "detail") redirect("/admin/careers");
  return { ok: true };
}
