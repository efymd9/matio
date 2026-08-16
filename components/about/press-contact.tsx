import type { Dict, Locale } from "@/lib/i18n/dictionaries";
import { socialProfilesForLocale } from "@/lib/social-links";
import { SocialIcon } from "@/components/site/social-icon";

// «Press contact» band shared by /about and /press (the mock renders it on
// both pages, above the site footer): mailto headline, social row, entity
// line. Presentational on purpose — dict and locale arrive as props so the
// Lab can render it without a request context.

const CIRCLE =
  "flex size-10 items-center justify-center rounded-full border border-cream/25 text-cream/85 transition-colors hover:bg-cream/10";

export function PressContact({ t, locale }: { t: Dict; locale: Locale }) {
  return (
    <section className="bg-linear-160 from-burgundy to-umber text-center">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-3.5 px-6 py-18 sm:px-12">
        <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-cream/70">
          {t.press.contactKicker}
        </span>
        <a
          href="mailto:contact@matio.tv"
          className="font-display text-3xl uppercase leading-none text-cream transition-opacity hover:opacity-90 sm:text-5xl xl:text-6xl"
        >
          contact@matio.tv
        </a>
        <p className="mt-1 max-w-xl text-[15px] leading-relaxed text-cream/75">
          {t.press.contactBody}
        </p>
        <ul
          aria-label={t.footer.followUs}
          className="mt-3 flex flex-wrap items-center justify-center gap-3.5"
        >
          <li>
            <a
              href="https://matio.tv/"
              aria-label={t.press.websiteAria}
              className={CIRCLE}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" />
              </svg>
            </a>
          </li>
          {socialProfilesForLocale(locale).map((profile) => (
            <li key={profile.url}>
              <a
                href={profile.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={profile.label}
                className={CIRCLE}
              >
                <SocialIcon platform={profile.platform} size={17} />
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs leading-relaxed text-cream/55">
          {t.about.bodyWho}
        </p>
      </div>
    </section>
  );
}
