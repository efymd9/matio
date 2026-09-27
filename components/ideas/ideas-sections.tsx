import type { ReactNode } from "react";
import { Icon } from "@/components/site/icon";
import type { Locale } from "@/lib/i18n/dictionaries";
import type { IdeasDict, IdeasLinked } from "@/lib/i18n/ideas-dictionaries";
import { localizedPath } from "@/lib/seo";
import { cn } from "@/lib/utils";
import { CARD, GUTTER, SectionHeading, TEXT_LINK } from "./ideas-parts";
import { IdeasTermsLink } from "./ideas-terms";

// The two blocks under the /ideas form (#297) — "How it works" and the FAQ.
// Rendered on the server: they work without JavaScript (native <details>),
// and only the FAQ's "Idea Submission Terms" link is a client island (it
// opens the form's Terms sheet — see ideas-terms.tsx).

// Phones: full width inside the gutters. 834–1279: the form's 640 column.
// Desktop: the 1200 grid.
const COLUMN = "mx-auto w-full max-w-[640px] xl:max-w-[1200px]";

export function IdeasHowItWorks({ t }: { t: IdeasDict }) {
  return (
    <section aria-labelledby="ideas-how-title" className={cn(GUTTER, "pt-16 xl:pt-24")}>
      <div className={cn(COLUMN, "flex flex-col gap-5 xl:gap-8")}>
        <SectionHeading id="ideas-how-title">{t.how.title}</SectionHeading>
        <ol className="flex flex-col gap-3 xl:grid xl:grid-cols-3 xl:gap-6">
          {t.how.steps.map((step) => (
            <li key={step.num} className={cn(CARD, "flex flex-col gap-2 p-5 xl:gap-3 xl:p-8")}>
              <span className="font-mono text-xs tracking-[0.12em] text-gold/75">
                {step.num}
              </span>
              <h3 className="font-display text-[22px] leading-[1.1] uppercase tracking-[0.01em] text-cream xl:text-[28px]">
                {step.title}
              </h3>
              <p className="text-[15px] leading-[1.6] text-cream/70 xl:text-base">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Question({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group border-b border-rust/20">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-[15px] leading-[1.4] font-semibold text-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/60 xl:min-h-[60px] xl:py-3.5 xl:text-base [&::-webkit-details-marker]:hidden">
        <span>{q}</span>
        <Icon
          name="chevron-down"
          size={16}
          className="flex-none text-cream/60 transition-transform duration-200 ease-out group-open:rotate-180"
        />
      </summary>
      <p className="pr-8 pb-[18px] text-[15px] leading-[1.6] text-cream/70 xl:pr-10 xl:pb-5 xl:text-base">
        {children}
      </p>
    </details>
  );
}

function Linked({ text, link }: { text: IdeasLinked; link: ReactNode }) {
  return (
    <>
      {text.before}
      {link}
      {text.after}
    </>
  );
}

export function IdeasFaq({ t, locale }: { t: IdeasDict; locale: Locale }) {
  const f = t.faq;
  const owns = (
    <Question q={f.owns.q}>
      <Linked
        text={f.owns.a}
        link={<IdeasTermsLink>{f.owns.a.link}</IdeasTermsLink>}
      />
    </Question>
  );
  const keep = (
    <Question q={f.keep.q}>
      <Linked
        text={f.keep.a}
        link={
          <a
            href={`${localizedPath("/privacy", locale)}#ideas`}
            target="_blank"
            rel="noopener"
            className={TEXT_LINK}
          >
            {f.keep.a.link}
          </a>
        }
      />
    </Question>
  );
  const del = (
    <Question q={f.delete.q}>
      <Linked
        text={f.delete.a}
        link={
          <a href={`mailto:${f.delete.a.link}`} className={TEXT_LINK}>
            {f.delete.a.link}
          </a>
        }
      />
    </Question>
  );

  return (
    <section aria-labelledby="ideas-faq-title" className={cn(GUTTER, "py-16 xl:py-24")}>
      <div className={cn(COLUMN, "flex flex-col gap-3 xl:gap-6")}>
        <SectionHeading id="ideas-faq-title">{f.title}</SectionHeading>
        {/* Two columns on desktop — questions 1–4 and 5–7 — one below. */}
        <div className="xl:grid xl:grid-cols-2 xl:items-start xl:gap-x-12">
          <div className="border-t border-rust/20">
            {owns}
            <Question q={f.paid.q}>{f.paid.a}</Question>
            <Question q={f.more.q}>{f.more.a}</Question>
            <Question q={f.language.q}>{f.language.a}</Question>
          </div>
          <div className="xl:border-t xl:border-rust/20">
            <Question q={f.after.q}>{f.after.a}</Question>
            {keep}
            {del}
          </div>
        </div>
      </div>
    </section>
  );
}
