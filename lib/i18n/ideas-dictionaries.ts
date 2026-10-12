// Copy for the public /ideas landing (#297) — the story-idea form, its
// How-it-works / FAQ blocks and the Idea Submission Terms sheet. English
// only since #445 (2026-10-12) — the site has no Spanish any more; the
// Spanish translation this file carried until then is in git history (rows
// sent under it say `locale = 'es'`).
//
// A separate module rather than an `ideas` section in dictionaries.ts, for
// the same reason admin-dictionaries.ts and app-dictionaries.ts are separate:
// dictionaries.ts ships in the client bundle of EVERY page (the header calls
// useT()) and Metro bundles it into the app (mobile/src/shared/i18n.ts). The
// Terms, seven FAQ answers and the form copy would bloat both. Only
// app/(public)/ideas/* and components/ideas/* import this file. Universal.
//
// LEGAL STATUS: the Idea Submission Terms, the "Before you send it" summary,
// the privacy line and the FAQ promises are a DRAFT pending counsel review
// (docs/registry.md, #168). English is the text the owner approved. The
// mockup's inline notes addressed to counsel are deliberately NOT rendered —
// they live in the registry row and in #168.
//
// Any edit to the Terms or to the wording of ticks 1–3 must bump
// IDEA_TERMS_VERSION in lib/idea-submission.ts — the version stamped on
// every row is the only proof of which text a fan agreed to.

import { IDEA_TERMS_VERSION } from "../idea-submission";

/** A sentence with one inline link: `before` + <link>{link}</link> + `after`. */
export type IdeasLinked = { before: string; link: string; after: string };

export const en = {
  meta: {
    title: "Write what happens next",
    description:
      "Continue a Matio series or pitch a brand-new one. The best ideas may make it into a series, with your name in the credits.",
  },
  formAria: "Send Matio a story idea",
  h1: ["Your story", "could be next"] as [string, string],
  chapter: (n: number) => `Chapter ${n} / 3`,
  chapterLabels: {
    1: "Chapter 1 / 3 · Logline",
    2: "Chapter 2 / 3 · Your story",
    3: "Chapter 3 / 3 · Your credit",
  },
  headings: { story: "Your story", credit: "Your credit" },
  barNext: "Next",
  whatIf: "What if…",
  logline: {
    placeholder:
      "e.g. A postman banished from his kingdom has one last letter to deliver: to the king who exiled him.",
    help: "One or two sentences, up to 300 characters.",
  },
  pitchCta: "Pitch your story",
  notContest:
    "This isn't a contest, and there's no prize. It's a chance to see your story made. The best ideas may make it into a Matio series, with your name in the credits.",
  series: {
    label: "Which story are you writing?",
    placeholder: "Choose a series…",
    help: "Continuing a series? Pick which one. Starting fresh? Choose “A brand-new series”.",
    newOption: "A brand-new series",
  },
  workingTitle: {
    label: "Working title (optional)",
    placeholder: "e.g. The Last Letter",
    help: "A name for your idea. Skip it if you don't have one yet.",
  },
  story: {
    label: "Your story",
    help1:
      "Tell the story. Synopsis, scenes, twists: up to 10,000 characters. Text only. We don't open links or attachments.",
    help2:
      "Fiction only. Leave out real people's names and private details, yours included. And please don't borrow characters from other studios' stories.",
    placeholderShow: (show: string) =>
      `Pick up after the last episode of ${show}. Who's in the scene, what goes wrong, what's the twist?`,
    placeholderNew:
      "Where are we, who do we follow, and what stands in their way? Scenes, twists, the ending if you have one.",
  },
  over: (k: string) => `${k} over`,
  name: {
    label: "Name or pen name",
    placeholder: "How your credit should read",
    help: "This is how we'd credit you on screen.",
  },
  email: {
    label: "Email",
    placeholder: "you@example.com",
    help: "The only way we'll get in touch.",
  },
  beforeYouSend: {
    title: "Before you send it",
    items: [
      {
        lead: "It's yours.",
        body: "You wrote it, and it isn't copied or already sold.",
      },
      {
        lead: "We can use it.",
        body: "You give Matio a free, non-exclusive licence to use, adapt and build on your idea. You can still use it yourself.",
      },
      {
        lead: "No obligation, no payment.",
        body: "We may never make it, and we don't pay for ideas sent here.",
      },
      {
        lead: "Great minds think alike.",
        body: "We develop lots of stories. If we make something similar, it may not come from yours.",
      },
      {
        lead: "Credit where it's due.",
        body: "If we turn your idea into a Matio series or episode, we'll credit you on screen under the name you give us.",
      },
    ],
    draft: "(Draft, pending legal review.)",
  },
  ticks: {
    age: "I'm 18 or older.",
    terms: {
      before:
        "This idea is my own original work (or I have my co-writers' OK), and I agree to the ",
      link: "Idea Submission Terms",
      after: ".",
    },
    termsHelp:
      "The full terms open over this page. Your draft stays where it is.",
    optIn:
      "Email me about new Matio episodes and future story calls. Unsubscribe anytime.",
    optInHelp: "Optional. You don't need it to send your idea.",
  },
  privacy: {
    before:
      "Matio (DEEP ORDINARY LTD) keeps your idea, name and email to review your idea and contact you about it. We keep them for up to 24 months, or longer only if we develop your idea with you. We never sell them or show them to other fans. How we handle your data and your rights: ",
    link: "Privacy Policy",
    after: ".",
  },
  submit: "Send my idea",
  sending: "Sending…",
  errors: {
    summary: "A few things need a look before we can send it.",
    series:
      "Pick the series you're continuing, or choose “A brand-new series”.",
    title: "Keep the title under 100 characters.",
    loglineRequired: "Add a logline: one or two sentences.",
    loglineTooLong: "Your logline is over 300 characters. Make it tighter.",
    storyRequired: "Tell us the story. A few lines is a start.",
    storyTooLong: "Your story is over 10,000 characters. Trim it a little.",
    nameRequired: "Tell us what to call you.",
    nameTooLong: "Keep it under 80 characters.",
    email: "That email doesn't look right.",
    age: "Tick to confirm you're 18 or older.",
    terms: "Tick to confirm the idea is yours and you agree to the terms.",
    rateLimited:
      "That's a lot of ideas from one network. Give it an hour, then try again. Your text is still here.",
    generic:
      "Something went wrong on our side. Your story is still here. Try again.",
  },
  success: {
    title: "Idea received",
    thanks: "Thank you, ",
    afterName: ". If your idea is a fit for a Matio series, we'll email you at ",
    afterEmail: ". We can't reply to every idea.",
    onList: "You're on the list for new episodes and future story calls.",
    again: "Send another idea →",
  },
  rail: {
    title: "Your pitch",
    steps: ["1 · Logline", "2 · Your story", "3 · Your credit"] as [string, string, string],
    story: "Story",
    newSeries: "A brand-new series",
    choose: "Choose a series…",
    done: "Done",
  },
  how: {
    title: "How it works",
    steps: [
      {
        num: "01",
        title: "Pick your world",
        body: "Continue one of our series, or start something we haven't made yet.",
      },
      {
        num: "02",
        title: "Write it down",
        body: "A logline, then the story: synopsis, scenes, twists. Text only, straight from your phone.",
      },
      {
        num: "03",
        title: "We take it from there",
        body: "Our team reviews ideas. If yours fits a Matio series, we'll email you. If it makes it to screen, you get the credit.",
      },
    ],
  },
  faq: {
    title: "Questions",
    owns: {
      q: "Who owns my idea?",
      a: {
        before:
          "You do. By sending it, you give Matio a free, non-exclusive licence to use, adapt and build on it, and you can still use it yourself. The full wording is in the ",
        link: "Idea Submission Terms",
        after: ".",
      },
    },
    paid: {
      q: "Will I be paid?",
      a: "No. This isn't a contest, and we don't pay for ideas sent through this page. If we turn your idea into a Matio series or episode, we'll credit you on screen under the name you give us. If we want to work with you further, we'll contact you, and anything more is agreed separately in writing.",
    },
    more: {
      q: "Can I send more than one idea?",
      a: "Yes. Send each idea on its own form, so every story stands on its own.",
    },
    language: {
      q: "Which language should I write in?",
      a: "English or Spanish. Use whichever one you tell stories in.",
    },
    after: {
      q: "What happens after I send it?",
      a: "Our team reviews ideas. If yours fits a Matio series, we'll email you. We can't reply to every idea, and there's no set timeline.",
    },
    keep: {
      q: "How long do you keep my story?",
      a: {
        before:
          "Up to 24 months, or longer only if we develop your idea with you. We never sell it or show it to other fans. The details are in our ",
        link: "Privacy Policy",
        after: ".",
      },
    },
    delete: {
      q: "How do I delete my submission?",
      a: {
        before: "Email ",
        link: "maksym@matio.tv",
        after:
          " from the address you used, and we'll delete it. You can also ask us for a copy of what we hold.",
      },
    },
  },
  terms: {
    title: "Idea Submission Terms",
    close: "Close",
    scrimAria: "Close the Idea Submission Terms",
    version: `Version ${IDEA_TERMS_VERSION} · Draft, pending legal review`,
    intro:
      "These terms apply when you send a story idea to DEEP ORDINARY LTD (“Matio”, “we”), 66 Paul Street, London EC2A 4NA, through matio.tv.",
    items: [
      { lead: "1. Who can submit.", body: "You must be 18 or older." },
      {
        lead: "2. It's your idea.",
        body: "You confirm that you wrote it yourself (or that everyone who co-wrote it agrees to these terms), that it isn't copied from anyone else's work, and that you haven't sold or given exclusive rights in it to anyone else.",
      },
      {
        lead: "3. What you let us do.",
        body: "You give Matio a free, worldwide, non-exclusive, perpetual and irrevocable licence to read, use, adapt, change, combine and build on your idea, in any series, episode or other production and in any medium, and to let our production partners do the same for Matio productions. The licence is non-exclusive, so you keep the right to use your idea yourself.",
      },
      {
        lead: "4. No obligation.",
        body: "We don't have to use or develop your idea, reply to you, or explain our decisions.",
      },
      {
        lead: "5. Similar ideas.",
        body: "We create many stories, and people often have similar ideas. We may already be developing, or may later develop on our own, stories similar to yours. That doesn't mean we used your idea, and it gives you no claim against us.",
      },
      {
        lead: "6. No payment.",
        body: "We don't pay for ideas sent through this page. If we want to work with you on a production, we'll contact you, and anything further will be agreed separately in writing.",
      },
      {
        lead: "7. Credit.",
        body: "If we develop your idea into a Matio series or episode, we'll credit you on screen under the name or pen name you gave us (for example “Story idea by …”).",
      },
    ],
    data: {
      lead: "8. Your personal data.",
      before: "We handle your name, email and submission as described in our ",
      link: "Privacy Policy",
      after: ".",
    },
    law: {
      lead: "9. Law.",
      body: "These terms are governed by the laws of England and Wales. If you're a consumer, you keep the protections of the law where you live.",
    },
  },
};

export type IdeasDict = typeof en;
