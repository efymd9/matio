"use server";

import {
  budgetLabel,
  normalizeStudioBrief,
  projectTypeLabel,
  validateStudioBrief,
  type EnquiryResult,
  type StudioBriefInput,
} from "@/lib/b2b-enquiry";
import { submitEnquiry } from "@/lib/b2b-enquiry-submit";

// A production / VFX brief from /studio (#498). Anonymous; the page hands
// this action to the client form as a prop. It becomes one email to
// maksym@matio.tv, subject "Studio brief — <project type>" — the subject is
// our label, never what the sender typed. Never throws (lib/b2b-enquiry-submit.ts).
export async function submitStudioBrief(input: StudioBriefInput): Promise<EnquiryResult> {
  const v = normalizeStudioBrief(input ?? {});
  return submitEnquiry({
    kind: "studio",
    honeypot: v.website,
    validate: () => validateStudioBrief(v),
    buildEmail: async () => {
      const type = projectTypeLabel(v.projectType) ?? v.projectType;
      return {
        kind: "studio",
        subject: `Studio brief — ${type}`,
        replyTo: v.email,
        fields: [
          ["Name", v.name],
          ["Email", v.email],
          ["Project type", type],
          ["Timeline", v.timeline],
          ["Budget range", v.budget ? (budgetLabel(v.budget) ?? "") : ""],
        ],
        body: `Brief:\n${v.brief}`,
      };
    },
  });
}
