"use server";

import {
  normalizeScreenerRequest,
  validateScreenerRequest,
  type EnquiryResult,
  type ScreenerRequestInput,
} from "@/lib/b2b-enquiry";
import { submitEnquiry } from "@/lib/b2b-enquiry-submit";
import { getPublishedShows } from "@/lib/catalog";
import { LICENSING_SLUGS } from "@/lib/licensing";

// A screener request from /licensing (#498). Anonymous; one email to
// contact@matio.tv, subject "Screener request — <title>" (or "— catalogue"
// when the buyer picked no title). The title is resolved from the slug on
// the SERVER, against the licensing list — what the form posted is only a
// choice among our titles. The team checks the rights and sends the
// screener by hand. Never throws (lib/b2b-enquiry-submit.ts).
export async function requestScreener(input: ScreenerRequestInput): Promise<EnquiryResult> {
  const v = normalizeScreenerRequest(input ?? {});
  return submitEnquiry({
    kind: "screener",
    honeypot: v.website,
    validate: () => validateScreenerRequest(v, LICENSING_SLUGS),
    buildEmail: async () => {
      let title = "catalogue";
      if (v.title) {
        const show = (await getPublishedShows()).find((s) => s.slug === v.title);
        title = show?.title ?? v.title;
      }
      return {
        kind: "screener",
        subject: `Screener request — ${title}`,
        replyTo: v.email,
        fields: [
          ["Title", v.title ? `${title} (https://matio.tv/shows/${v.title})` : "Not chosen — the catalogue"],
          ["Name", v.name],
          ["Company", v.company],
          ["Work email", v.email],
          ["Market / territory", v.market],
        ],
      };
    },
  });
}
