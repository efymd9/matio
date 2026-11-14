// Copy for the two business pages (#498): /studio (Production & VFX) and
// /licensing (Content Licensing), and their enquiry forms. English only.
// A separate module for the reason careers-dictionaries.ts is one:
// dictionaries.ts ships in every page's client bundle and in the app. Only
// app/(public)/{studio,licensing}/* and components/b2b/* import it.
// Universal.
//
// The hero lines and the three service blocks are the owner's brief (#498)
// verbatim. Nothing here names a client, a project under NDA, a price, a
// turnaround or a territory: rights and terms are answered per request.
//
// LEGAL STATUS: the privacy line under each form is a DRAFT pending counsel
// review, with the /privacy "Business enquiries" section (#168).

import type { EnquiryErrorCode, EnquiryField } from "../b2b-enquiry";

const ERRORS: Record<EnquiryErrorCode, string> = {
  required: "This field is required.",
  too_long: "This is too long — please shorten it.",
  invalid_email: "Enter an email address like name@company.com.",
  invalid_choice: "Choose one of the options.",
};

const FORM_COMMON = {
  optional: "Optional",
  sending: "Sending…",
  errors: ERRORS,
  summary: (n: number) =>
    n === 1 ? "Please fix 1 field above." : `Please fix ${n} fields above.`,
  rateLimited:
    "You've sent several requests in the last hour. Please try again later, or write to contact@matio.tv.",
  serverError:
    "Something went wrong and your request was not sent. Please try again, or write to contact@matio.tv.",
  privacy: {
    before: "We use these details only to answer your request — see our ",
    link: "Privacy Policy",
    after: ".",
  },
  sendAnother: "Send another request",
};

export const studio = {
  meta: {
    title: "Production & VFX",
    description:
      "Matio produces films, pilots and scripted series, combining live action with generative visual effects — and adds VFX to footage you've already shot. Send us a brief.",
  },
  hero: {
    badge: "Production & VFX",
    title: "Film, series & VFX production",
    body:
      "Matio produces films, pilots and scripted series. We combine live action with generative visual effects and can add VFX to footage you've already shot.",
    cta: "Discuss a project",
    stillAlt: "Moonlight falling through the broken roof of a ruined cathedral",
  },
  services: {
    label: "What we do",
    items: [
      {
        title: "Scripted Series & Pilots",
        body:
          "Bring us a script or a synopsis. We assess the scope with you and can start with a paid pilot.",
      },
      {
        title: "Live Action + AI",
        body:
          "Shoots with live actors, combined with digital locations and effects. The scope of the shoot and of post-production is agreed from your brief.",
      },
      {
        title: "VFX for Existing Footage",
        body:
          "We work with footage you've already shot — set extensions or environment replacement that keep the actors' performances intact. Start with an estimate on a few shots and an agreed test shot.",
      },
    ],
  },
  work: {
    label: "Selected work",
    kicker: "Serial production",
    body:
      "A gothic dark-romance series written, produced and premiered by Matio — our own example of serial production from script to final frame.",
    cta: "View the series",
  },
  beforeAfter: {
    label: "Before / After",
    before: "Before",
    after: "After",
  },
  form: {
    label: "Discuss a project",
    title: "Tell us about your project",
    intro:
      "A few lines are enough. No scripts or footage yet — if there's a fit, we'll ask for them.",
    aria: "Project brief",
    name: { label: "Your name", placeholder: "Full name" },
    email: { label: "Email", placeholder: "name@company.com" },
    projectType: { label: "What do you need?", placeholder: "Choose one" },
    brief: {
      label: "Short brief",
      placeholder: "The project, where it stands, what you'd like Matio to do.",
    },
    timeline: { label: "Timeline", placeholder: "e.g. shoot in spring, delivery by Q3" },
    budget: { label: "Budget range", placeholder: "Choose a range" },
    submit: "Send brief",
    successTitle: "Brief received",
    successBody:
      "Thank you — your brief is with the Matio team. We'll reply to the email you gave us.",
    ...FORM_COMMON,
  },
};

export const licensing = {
  meta: {
    title: "Content Licensing",
    description:
      "License Matio originals for streaming platforms, broadcasters and distributors. Explore the catalogue, request a screener and ask about rights for your market.",
  },
  hero: {
    badge: "Content Licensing",
    title: "License Matio originals",
    body:
      "Explore Matio's catalogue for streaming platforms, broadcasters and distributors. Request a screener and ask about rights for your market.",
    cta: "Request a screener",
  },
  catalogue: {
    label: "Available titles",
    rights:
      "Rights availability by territory and term is confirmed by the Matio team on request.",
    empty:
      "We're confirming the first titles for licensing. Send us a request and we'll tell you what's available for your market.",
    genre: "Genre",
    episodes: "Episodes",
    languages: "Languages",
    format: "Format",
    trailer: "Watch trailer",
    request: "Request a screener",
  },
  form: {
    label: "Request a screener",
    title: "Tell us where you'd show it",
    intro:
      "Tell us who you are and where you'd show it. The team checks the rights and sends the screener by hand.",
    aria: "Screener request",
    title_: { label: "Title", general: "The catalogue — not sure yet" },
    name: { label: "Your name", placeholder: "Full name" },
    company: { label: "Company", placeholder: "Platform, broadcaster or distributor" },
    email: { label: "Work email", placeholder: "name@company.com" },
    market: { label: "Market or territory", placeholder: "e.g. Spain, LATAM, worldwide" },
    submit: "Request screener",
    successTitle: "Request received",
    successBody:
      "Thank you — the Matio team will check the rights and reply to your work email.",
    ...FORM_COMMON,
  },
};

export type StudioDict = typeof studio;
export type LicensingDict = typeof licensing;
export type EnquiryFormCopy = typeof FORM_COMMON;
export type { EnquiryField };
