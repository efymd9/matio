// DRAFT pending legal-counsel review (#168), like /terms, /privacy and
// /cookies. Written 2026-10-27 for #485 — the Support URL App Store Connect
// asks for before the first iOS submission (#486). An agent's draft from the
// code (every sentence is tied to it in #485's PR), merged only on the
// owner's «да» in the PR thread.
//
// What the page leans on — change one of these and this page changes too:
//  - «Delete account» in the app: the two confirmations in
//    lib/i18n/app-dictionaries.ts (`deleteConfirmBody`, then
//    `deleteFinalTitle`) and POST /api/v1/account/delete, which erases our
//    data (lib/erase-user.ts) before it deletes the Clerk account.
//  - On the website deletion goes by email, not through the «Delete account»
//    in Clerk's own account menu. That button is on in the production
//    instance (`delete_self`), but until Clerk's production webhook carries
//    `user.deleted` (#172) it removes the Clerk account and leaves everything
//    we keep — so the page names the path that erases all of it. Once #172 is
//    done, the button can be named here.
//  - Cancelling: «Manage subscription» in the user menu and the footer →
//    /api/billing-portal → the Stripe Customer Portal (cancel at period end).
//  - No price, no link to /subscribe or /checkout (App Store 3.1.1 — the app
//    sells nothing, and this is the URL its store page points to);
//    ./support.test.tsx pins it.
//  - No `?embed=app` variant: the app opens only the three legal documents
//    (lib/app-embed.ts), and its own support entry is the mailto in
//    /v1/config — nothing in the app opens this page.
import type { Metadata } from "next";
import Link from "next/link";
import { getDict } from "@/lib/i18n/server";
import { canonicalUrl } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return {
    title: t.legal.supportTitle,
    description: t.legal.supportDescription,
    alternates: { canonical: canonicalUrl("/support") },
  };
}

const LAST_UPDATED = "October 27, 2026";

const SUPPORT_EMAIL = "maksym@matio.tv";

export default async function SupportPage() {
  const { t } = await getDict();
  return (
    <main className="bg-background pt-28 pb-24 sm:pt-32">
      <article className="mx-auto max-w-3xl px-6 sm:px-8">
        <header className="mb-10 space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">
            matio
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight text-cream sm:text-4xl">
            {t.legal.supportTitle}
          </h1>
          <p className="font-mono text-[11px] text-cream/45">
            {t.legal.lastUpdated(LAST_UPDATED)}
          </p>
        </header>
        <SupportEn />
        <div className="mt-12 border-t border-white/[0.06] pt-6">
          <Link
            href="/"
            className="text-sm font-semibold text-cream/70 transition-colors hover:text-cream"
          >
            ← {t.legal.backHome}
          </Link>
        </div>
      </article>
    </main>
  );
}

const linkClass = "underline underline-offset-2 hover:text-white";

function Email() {
  return (
    <a href={`mailto:${SUPPORT_EMAIL}`} className={linkClass}>
      {SUPPORT_EMAIL}
    </a>
  );
}

function SupportEn() {
  return (
    <div className="prose-legal space-y-8 text-[15px] leading-relaxed text-white/75">
      <Section id="about" title="Who we are">
        <p>
          Matio is a streaming service for original short series from the
          Matio studio. It is run by DEEP ORDINARY LTD, registered in England
          and Wales (company no.&nbsp;17381666), registered office: 66 Paul
          Street, London EC2A&nbsp;4NA, United Kingdom.
        </p>
      </Section>

      <Section id="contact" title="Contact us">
        <p>
          Write to <Email />. It is our one address for everything: help with
          your account, the website or the app, a subscription, and requests
          about your personal data.
        </p>
        <p>
          We aim to reply within a few working days. Requests about your
          personal data are answered within 30 days, as our Privacy Policy
          says (section 7).
        </p>
        <p>
          It helps if you write from the email address of your Matio account
          and tell us whether you use the website or the app, and on which
          device.
        </p>
      </Section>

      <Section id="sign-in" title="Signing in">
        <p>
          Matio has no passwords. To sign in or create an account, you enter
          your email address, we email you a one-time code, and you type the
          code in to continue. The email is sent for us by Clerk, the company
          that runs sign-in for Matio. On the website you can also choose
          &ldquo;Continue with Google&rdquo;.
        </p>
        <p>If the code doesn&rsquo;t arrive:</p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            Look in your spam or junk folder &mdash; and, in Gmail, under
            Promotions and Updates.
          </li>
          <li>
            Check that the email address you typed is right. In the app,
            &ldquo;Use a different email&rdquo; takes you back to correct it.
          </li>
          <li>
            Wait a minute, then ask for a new code: &ldquo;Resend code&rdquo;
            in the app, &ldquo;Resend&rdquo; on the website. Use the newest
            code &mdash; an earlier one may no longer work.
          </li>
          <li>
            Still nothing? Write to <Email /> from the address you are signing
            in with, and we&rsquo;ll look into it.
          </li>
        </ul>
      </Section>

      <Section id="delete-account" title="Deleting your account">
        <p>
          <strong>In the app:</strong> open the Account tab and tap{" "}
          <strong>Delete account</strong>. The app asks you twice. First it
          tells you what will be erased: your account, your watch progress
          and your new-episode reminders &mdash; and that an active
          subscription is cancelled at the end of the current billing period,
          so you won&rsquo;t be charged again. Then it reminds you that this
          can&rsquo;t be undone. When you confirm, your account is deleted
          straight away.
        </p>
        <p>
          <strong>On the website:</strong> write to <Email /> from the email
          address of your account and ask us to delete it. We check that the
          request comes from you, delete your account and the data we keep
          with it in the same way, and reply when it&rsquo;s done.
        </p>
        <p>
          Deleting the app from your phone does not delete your account. A
          few records outlive the account &mdash; for example, the billing
          records Stripe keeps for as long as tax law requires. Our{" "}
          <Link href="/privacy" className={linkClass}>
            Privacy Policy
          </Link>{" "}
          explains what is kept and for how long (sections 6 and 11), and your
          other rights over your data &mdash; to see it, get a copy of it or
          correct it &mdash; in section 7.
        </p>
      </Section>

      <Section id="subscriptions" title="Subscriptions">
        <p>
          Nothing is sold in the Matio app. A subscription bought on the
          website is managed there: sign in on matio.tv and choose{" "}
          <strong>Manage subscription</strong> &mdash; in the menu behind your
          profile picture at the top of the page, or in the links at the
          bottom. You can cancel there: the subscription stops renewing, and
          you keep access until the end of the period you have already paid
          for.
        </p>
        <p>
          Deleting your account also cancels an active subscription at the
          end of the current billing period, so you won&rsquo;t be charged
          again.
        </p>
      </Section>

      <Section id="policies" title="Our policies">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <Link href="/privacy" className={linkClass}>
              Privacy Policy
            </Link>{" "}
            &mdash; what personal data we keep, why, for how long, and your
            rights.
          </li>
          <li>
            <Link href="/terms" className={linkClass}>
              Terms of Service
            </Link>{" "}
            &mdash; the rules of the service.
          </li>
          <li>
            <Link href="/cookies" className={linkClass}>
              Cookie Policy
            </Link>{" "}
            &mdash; the cookies the website uses and how to manage them.
          </li>
        </ul>
      </Section>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-3 scroll-mt-24">
      <h2 className="text-xl font-extrabold tracking-tight text-white sm:text-2xl">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
