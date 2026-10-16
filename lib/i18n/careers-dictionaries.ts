// Copy for the public /careers page (#376) — the hero, the How-we-work and
// What-happens-next blocks, the application form and the FAQ. English only
// (the site is English-only since #445). The roles themselves — titles,
// summaries, duties, requirements, the per-role form hints — live in
// lib/careers.ts, next to their ids.
//
// A separate module rather than a `careers` section in dictionaries.ts, for
// the reason ideas-dictionaries.ts is separate: dictionaries.ts ships in the
// client bundle of EVERY page and Metro bundles it into the app. Only
// app/(public)/careers/* and components/careers/* import this file.
// Universal.
//
// Studio facts are copied from /about and nothing else (#376 spec): no
// salary, perks, city, office, team size or response time is promised here.
//
// Every line that NAMES or COUNTS the roles (the meta description, the
// hero's role line, the section title, the phone bar, the FAQ answer) is
// built from lib/careers.ts:VACANCY_LIST below — a role changes in one place.
// careers-dictionaries.test.ts pins it.
//
// LEGAL STATUS: the privacy line and the FAQ answer about personal data are a
// DRAFT pending counsel review, with the /privacy "Job applications" section
// (docs/registry.md, #168).

import { VACANCY_LIST } from "../careers";
import { JOB_APPLICATION_RETENTION_MONTHS, JOB_LIMITS } from "../job-application";

/** A sentence with one inline link: `before` + <link>{link}</link> + `after`. */
export type CareersLinked = { before: string; link: string; after: string };

const KEEP = `${JOB_APPLICATION_RETENTION_MONTHS} months`;

// "a", "a and b", "a, b and c" — a hand-rolled list join: this module ships
// to the browser, and Intl.ListFormat is missing from older iOS Safari.
export function joinWithAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// The number of open roles as a word ("Two"), digits past ten.
export function countWord(n: number): string {
  const words = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  return words[n] ?? String(n);
}

const ROLE_TITLES = VACANCY_LIST.map((v) => v.title);
const ROLE_COUNT = countWord(VACANCY_LIST.length);
const ROLES_NOUN = VACANCY_LIST.length === 1 ? "role" : "roles";

// The analytics count a sent application leaves behind (#376): with
// marketing cookies on, PostHog gets `job_application_submitted {position}`
// — the role, nothing the candidate wrote. Said wherever the copy promises
// what the details are used for.

export const en = {
  meta: {
    title: "Careers",
    description:
      `Matio is hiring: ${joinWithAnd(ROLE_TITLES)}. An independent studio making dark romantic stories and short series, from script to final frame.`,
  },
  hero: {
    badge: "Work with Matio",
    title: ["We are", "hiring."] as [string, string],
    roles: VACANCY_LIST.map((v) => v.shortTitle).join(" · "),
    pitch:
      "An independent studio making dark romantic stories and short series — written, produced and premiered under one roof. We're looking for the people who'll make the next ones with us.",
    cta: "See open roles",
    stillAlt: "Moonlight falling through the broken roof of a ruined cathedral",
  },
  roles: {
    label: "Open roles",
    title: [`${ROLE_COUNT} ${ROLES_NOUN}.`, "Open now."] as [string, string],
    intro:
      "Tell us who you are and what you've made. If there's a fit, we'll write to you.",
    count: (n: number, total: number) =>
      `${String(n).padStart(2, "0")} / ${String(total).padStart(2, "0")}`,
    location: "Location",
    employmentType: "Type",
    whatYoullDo: "What you'll do",
    whatWereLookingFor: "What we're looking for",
    apply: "Apply",
    applyAria: (title: string) => `Apply for ${title}`,
  },
  how: {
    label: "How we work",
    title: ["From script", "to final frame."] as [string, string],
    intro:
      "Dark romantic stories and short series — written, produced and premiered under one roof.",
    mission: {
      label: "Our mission",
      heading:
        "Dark romantic stories and short series, made with more than 12 AI tools.",
      body: "From script to final frame, the whole process happens within the team — no intermediaries.",
      alt: "Matio production still",
    },
    vision: {
      label: "Our vision",
      heading:
        "AI production isn't a shortcut — it's a new instrument for authorial filmmaking.",
      body: "Our series exist in English and Spanish — horizontal for the big screen, vertical for the phone.",
      alt: "Matio production still",
    },
  },
  next: {
    label: "What happens next",
    title: ["After you", "hit send."] as [string, string],
    steps: [
      {
        num: "01",
        title: "Send it",
        body: "About 5 minutes. Links only — nothing to upload.",
      },
      { num: "02", title: "We read it", body: "We read every application." },
      {
        num: "03",
        title: "If there's a fit, we write to you",
        body: "At the email address you give us.",
      },
    ],
  },
  form: {
    aria: "Apply to work at Matio",
    label: "Your application",
    title: ["Answer", "the call."] as [string, string],
    intro:
      "Tell us who you are and what you've made. Anything not marked Optional, we need.",
    optional: "Optional",
    groups: {
      role: "The role",
      you: "You",
      work: "Your work",
      send: "Send",
    },
    position: {
      label: "I'm applying for",
      help: "Pick a role to see what to send.",
    },
    fullName: { label: "Full name", placeholder: "Your name" },
    email: { label: "Email", placeholder: "you@example.com" },
    location: { label: "Where are you based?", placeholder: "City, country" },
    linkedin: {
      label: "LinkedIn",
      placeholder: "https://www.linkedin.com/in/…",
    },
    portfolio: {
      // Used before a role is picked; each role then names it itself
      // (lib/careers.ts: portfolioLabel).
      label: "Portfolio or work",
      placeholder: "https://…",
      help: "A website, a reel, a Drive or Vimeo link — whatever shows your work best.",
    },
    socials: {
      label: "Social profiles",
      help: "Up to four — the accounts where your work lives.",
      platform: (n: number) => `Platform for profile ${n}`,
      value: (n: number) => `Link or handle for profile ${n}`,
      placeholder: "@handle or link",
      remove: (n: number) => `Remove profile ${n}`,
      add: "Add a profile",
    },
    about: {
      label: "About you",
      help: "Who you are, what you've made, and what you'd want to make at Matio.",
    },
    age: "I'm 18 or older.",
    privacy: {
      before: `We use these details only to consider you for work at Matio and keep them for ${KEEP}. With marketing cookies on, our analytics also counts that an application for a role was sent — never what's in it. `,
      link: "Privacy Policy",
      after: "",
    } satisfies CareersLinked,
    submit: "Send application",
    sending: "Sending…",
    over: (n: string) => `${n} over`,
  },
  errors: {
    summary: "A few things need a look before we can send it.",
    position: "Pick the role you're applying for.",
    nameRequired: "Tell us your name.",
    nameTooLong: `Keep your name under ${JOB_LIMITS.fullName} characters.`,
    emailRequired: "We need an email to reply to.",
    email: "That email doesn't look right.",
    locationRequired: "Tell us where you're based.",
    locationTooLong: `Keep it under ${JOB_LIMITS.location} characters.`,
    link: "Paste a full link, starting with https://.",
    portfolioRequired: "Add a link to your portfolio or reel.",
    socialsTooMany: `Up to ${JOB_LIMITS.socials} profiles.`,
    social: "Paste a full link (https://…) or an @handle.",
    messageRequired: "Tell us a little about yourself.",
    messageTooLong: `Keep it under ${JOB_LIMITS.message.toLocaleString("en")} characters.`,
    age: "Please confirm you're 18 or older.",
    rateLimited:
      "Too many applications from this connection in the last hour. Try again later.",
    generic: "Something went wrong and your application wasn't sent. Try again.",
  },
  success: {
    kicker: "Application sent",
    title: (firstName: string) => `Thanks, ${firstName}.`,
    body: ["We read every application. If there's a fit, we'll write to ", "."] as [
      string,
      string,
    ],
    watch: "Watch Matio",
  },
  bar: {
    title: "We are hiring",
    sub: `${ROLE_COUNT} open ${ROLES_NOUN} · about 5 minutes`,
    apply: "Apply",
  },
  faq: {
    label: "Questions",
    title: "Before you ask.",
    roles: {
      q: "Which roles are open?",
      a: `${ROLE_COUNT}: ${joinWithAnd(ROLE_TITLES)}. Pick one at the top of the form.`,
    },
    files: {
      q: "Can I attach a CV?",
      a: "No files — links only. Your LinkedIn, a portfolio or reel, and the profiles where your work lives tell us what we need.",
    },
    reply: {
      q: "Will I hear back?",
      a: "We read every application. If there's a fit, we'll write to the email address you give us.",
    },
    ideas: {
      q: "I have a story idea, not a CV.",
      a: {
        before: "That's a different door: pitch it at ",
        link: "matio.tv/ideas",
        after: ".",
      } satisfies CareersLinked,
    },
    data: {
      q: "What happens to my details?",
      a: {
        before: `We use them only to consider you for work at Matio and keep them for ${KEEP}. With marketing cookies on, our analytics also counts that an application for a role was sent — never what's in it. Ask us to delete them any time: `,
        link: "maksym@matio.tv",
        after: ".",
      } satisfies CareersLinked,
    },
  },
};

export type CareersDict = typeof en;
