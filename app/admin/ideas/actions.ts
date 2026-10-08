"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { ideaSubmissions } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";

// The one write the admin panel has on story ideas (#297): delete — for spam,
// and for a fan who asks by email to maksym@ (runbook
// docs/runbooks/gdpr-requests.md). There is no edit on purpose.
//
// `after` is bound by the page, the deleteEpisode idiom: the list stays on
// revalidatePath (its row simply disappears), the detail page leaves for the
// list because its own row is gone. No validation: the id is bound by the UI
// itself, and a forged post with a garbage id fails at the driver — the throw
// registry at the top of app/admin/actions.ts does not grow. No log line:
// nothing here would carry more than the id, and the id is on the page.
export async function deleteIdeaSubmission(
  id: string,
  after: "list" | "detail",
): Promise<void> {
  await requireAdmin();
  await db.delete(ideaSubmissions).where(eq(ideaSubmissions.id, id));
  revalidatePath("/admin/ideas");
  if (after === "detail") redirect("/admin/ideas");
}
