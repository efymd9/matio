import Link from "next/link";
import { redirect } from "next/navigation";
import { MatioLogo } from "@/components/site/matio-logo";
import { getPublishableKey } from "@/lib/checkout-session";
import { paymentsEnabled } from "@/lib/free-mode";
import { getDict } from "@/lib/i18n/server";
import { CheckoutClient } from "./checkout-client";

// In-site checkout. Both CTAs route here — the signed-in /subscribe submit and
// the signed-out pay-first paywall — and the embedded Stripe iframe renders in
// place (no redirect to checkout.stripe.com). The actual flow selection
// (signed-in vs guest), all duplicate/rate-limit guards, and session creation
// live server-side in app/checkout/actions.ts (called from CheckoutClient on
// mount), so this page stays a thin branded shell. noindex — it's a
// per-session transactional surface, never a landing page.
export const metadata = {
  robots: { index: false, follow: false },
};

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; ep?: string; resume?: string }>;
}) {
  // Payments off → no checkout. The server actions carry their own guard
  // (defense in depth for clients mounted across the flag-flip deploy).
  if (!paymentsEnabled()) redirect("/");

  const { show, ep, resume } = await searchParams;
  const { t } = await getDict();
  // Read the publishable key server-side at request time (runtime, not
  // build-inlined) and hand it to the client — see lib/checkout-session.ts.
  const publishableKey = getPublishableKey();

  // Back goes to the watch flow the buyer came from (player wall re-renders
  // there) or the catalog. Built from our params only; the slug lands in a
  // relative /watch path, never an absolute redirect.
  let backHref = "/";
  if (show) {
    const params = new URLSearchParams();
    if (ep) params.set("ep", ep);
    if (resume) params.set("resume", resume);
    const qs = params.toString();
    backHref = `/watch/${encodeURIComponent(show)}${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background pb-16 pt-24 sm:pt-28">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        aria-hidden
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 0%, rgba(230,179,102,0.18), transparent 55%)",
        }}
      />

      <div className="relative mx-auto max-w-md px-6 sm:px-8">
        <div className="space-y-4 text-center">
          <div className="flex justify-center">
            <MatioLogo size={20} />
          </div>
          <p className="text-[11px] font-bold uppercase tracking-[0.4em] text-gold">
            {t.checkout.kicker}
          </p>
          <h1 className="text-3xl font-extrabold leading-[0.95] tracking-tight text-cream sm:text-4xl">
            {t.checkout.title}
          </h1>
        </div>

        <CheckoutClient
          show={show}
          ep={ep}
          resume={resume}
          publishableKey={publishableKey}
        />

        <div className="mt-6 text-center">
          <Link
            href={backHref}
            className="text-[11px] font-medium text-cream/45 underline underline-offset-2 transition-colors hover:text-cream/75"
          >
            {t.checkout.back}
          </Link>
        </div>
      </div>
    </div>
  );
}
