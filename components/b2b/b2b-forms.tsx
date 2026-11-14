"use client";

import {
  BUDGET_RANGES,
  ENQUIRY_LIMITS,
  STUDIO_PROJECT_TYPES,
  normalizeScreenerRequest,
  normalizeStudioBrief,
  validateScreenerRequest,
  validateStudioBrief,
  type EnquiryResult,
  type ScreenerRequestInput,
  type StudioBriefInput,
} from "@/lib/b2b-enquiry";
import { licensing, studio } from "@/lib/i18n/b2b-dictionaries";
import { EnquiryForm, type EnquiryFieldDef } from "./enquiry-form";

// The two concrete forms (#498). Client components because the rules
// (functions) cannot cross from a server page; the server action arrives as a
// prop, so these never import a server module. The copy is imported here,
// not passed: it carries functions (the error summary), which cannot cross
// from a server page to a client component.

export function StudioBriefForm({
  submit,
}: {
  submit: (input: StudioBriefInput) => Promise<EnquiryResult>;
}) {
  const t = studio.form;
  const fields: EnquiryFieldDef[] = [
    { kind: "text", name: "name", ...t.name, autoComplete: "name", maxLength: ENQUIRY_LIMITS.name },
    { kind: "text", name: "email", type: "email", ...t.email, autoComplete: "email", maxLength: ENQUIRY_LIMITS.email },
    { kind: "select", name: "projectType", ...t.projectType, options: STUDIO_PROJECT_TYPES },
    { kind: "textarea", name: "brief", ...t.brief, maxLength: ENQUIRY_LIMITS.brief },
    { kind: "text", name: "timeline", ...t.timeline, optional: true, maxLength: ENQUIRY_LIMITS.timeline },
    { kind: "select", name: "budget", ...t.budget, optional: true, options: BUDGET_RANGES },
  ];
  return (
    <EnquiryForm
      fields={fields}
      initial={{ name: "", email: "", projectType: "", brief: "", timeline: "", budget: "" }}
      copy={t}
      validate={(v) => validateStudioBrief(normalizeStudioBrief(v))}
      submit={submit}
      event="studio_brief_submitted"
    />
  );
}

export function ScreenerRequestForm({
  titles,
  preselected,
  submit,
}: {
  // The titles on offer, in the catalogue's order: slug + display title.
  titles: readonly { slug: string; title: string }[];
  preselected: string | null;
  submit: (input: ScreenerRequestInput) => Promise<EnquiryResult>;
}) {
  const t = licensing.form;
  const slugs = titles.map((x) => x.slug);
  const fields: EnquiryFieldDef[] = [
    ...(titles.length > 0
      ? [
          {
            kind: "select" as const,
            name: "title" as const,
            label: t.title_.label,
            placeholder: t.title_.general,
            options: titles.map((x) => ({ id: x.slug, label: x.title })),
          },
        ]
      : []),
    { kind: "text", name: "name", ...t.name, autoComplete: "name", maxLength: ENQUIRY_LIMITS.name },
    { kind: "text", name: "company", ...t.company, autoComplete: "organization", maxLength: ENQUIRY_LIMITS.company },
    { kind: "text", name: "email", type: "email", ...t.email, autoComplete: "email", maxLength: ENQUIRY_LIMITS.email },
    { kind: "text", name: "market", ...t.market, maxLength: ENQUIRY_LIMITS.market },
  ];
  return (
    <EnquiryForm
      fields={fields}
      initial={{
        title: preselected && slugs.includes(preselected) ? preselected : "",
        name: "",
        company: "",
        email: "",
        market: "",
      }}
      copy={t}
      validate={(v) => validateScreenerRequest(normalizeScreenerRequest(v), slugs)}
      submit={submit}
      event="screener_requested"
    />
  );
}
