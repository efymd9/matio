import type { Metadata } from "next";
import Link from "next/link";
import { getDict } from "@/lib/i18n/server";
import {
  decodeUnsubscribeParams,
  verifyUnsubscribeToken,
} from "@/lib/email-unsubscribe";
import { confirmUnsubscribe } from "./actions";

// Human-facing unsubscribe landing for reminder emails (the footer link).
// Three states: confirm (valid token), done (?done=1 after the action
// redirect), invalid (anything else). Token-addressed, so noindex — the
// page is meaningless without a personal link.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return {
    title: t.unsubscribe.metaTitle,
    robots: { index: false, follow: false },
  };
}

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; t?: string; done?: string }>;
}) {
  const { e, t: token, done } = await searchParams;
  const { t } = await getDict();

  const parsed = decodeUnsubscribeParams(e, token);
  const valid =
    parsed !== null && verifyUnsubscribeToken(parsed.email, parsed.token);

  let heading: string;
  let body: string;
  if (done === "1") {
    heading = t.unsubscribe.doneHeading;
    body = t.unsubscribe.doneBody;
  } else if (valid && parsed) {
    heading = t.unsubscribe.heading;
    body = t.unsubscribe.confirmBody(parsed.email);
  } else {
    heading = t.unsubscribe.invalidHeading;
    body = t.unsubscribe.invalidBody;
  }

  return (
    <main className="bg-background pt-28 pb-24 sm:pt-32">
      <div className="mx-auto max-w-md px-6 sm:px-8">
        <div className="rounded-3xl border border-rust/30 bg-espresso-2/95 p-6 sm:p-8">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">
            matio
          </p>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-cream">
            {heading}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-cream/72">{body}</p>

          {done !== "1" && valid && e && token ? (
            <form action={confirmUnsubscribe.bind(null, e, token)}>
              <button
                type="submit"
                className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-full bg-gold-cta text-sm font-extrabold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-transform duration-150 ease-out active:scale-[0.98]"
              >
                {t.unsubscribe.confirmCta}
              </button>
            </form>
          ) : null}

          <div className="mt-6 border-t border-white/[0.06] pt-4">
            <Link
              href="/"
              className="text-sm font-semibold text-cream/70 transition-colors hover:text-cream"
            >
              ← {t.unsubscribe.backHome}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
