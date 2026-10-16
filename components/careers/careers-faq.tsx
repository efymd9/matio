import type { ReactNode } from "react";
import { Icon } from "@/components/site/icon";
import { TEXT_LINK } from "@/components/ideas/ideas-parts";
import type { CareersDict, CareersLinked } from "@/lib/i18n/careers-dictionaries";
import { SectionLabel } from "./careers-parts";

// The /careers FAQ (#376). No "use client": rendered on the server and handed
// to the client landing as its `faq` slot — native <details>, so it works
// without JavaScript.

function Question({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group border-b border-rust/30">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-[15px] leading-[1.4] font-bold text-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/60 xl:text-[17px] [&::-webkit-details-marker]:hidden">
        <span>{q}</span>
        <Icon
          name="chevron-down"
          size={16}
          className="flex-none text-cream/60 transition-transform duration-200 ease-out group-open:rotate-180"
        />
      </summary>
      <p className="pr-8 pb-[18px] text-[15px] leading-[1.6] text-cream/70">{children}</p>
    </details>
  );
}

function Linked({ text, link }: { text: CareersLinked; link: ReactNode }) {
  return (
    <>
      {text.before}
      {link}
      {text.after}
    </>
  );
}

export function CareersFaq({ t }: { t: CareersDict }) {
  const f = t.faq;
  return (
    <section aria-labelledby="careers-faq-title" className="flex flex-col gap-5">
      <div className="flex flex-col gap-4">
        <SectionLabel>{f.label}</SectionLabel>
        <h2
          id="careers-faq-title"
          className="font-display text-[40px] leading-none uppercase tracking-[0.02em] text-cream xl:text-[56px] xl:leading-[0.98]"
        >
          {f.title}
        </h2>
      </div>
      <div className="border-t border-rust/30">
        <Question q={f.roles.q}>{f.roles.a}</Question>
        <Question q={f.files.q}>{f.files.a}</Question>
        <Question q={f.reply.q}>{f.reply.a}</Question>
        <Question q={f.ideas.q}>
          <Linked
            text={f.ideas.a}
            link={
              <a href="/ideas" className={TEXT_LINK}>
                {f.ideas.a.link}
              </a>
            }
          />
        </Question>
        <Question q={f.data.q}>
          <Linked
            text={f.data.a}
            link={
              <a href={`mailto:${f.data.a.link}`} className={TEXT_LINK}>
                {f.data.a.link}
              </a>
            }
          />
        </Question>
      </div>
    </section>
  );
}
