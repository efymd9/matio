import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions, type Subscription } from "@/db/schema";
import { MatioLogo } from "@/components/site/matio-logo";
import { Icon } from "@/components/site/icon";
import { getOrSyncCurrentUser } from "@/lib/admin";
import { applyUserAttribution } from "@/lib/attribution";
import { getDict } from "@/lib/i18n/server";
import type { Dict } from "@/lib/i18n/dictionaries";
import { ACCESS_GRANTING_STATUSES } from "@/lib/subscription-access";
import { linkTrialSessionsToCurrentUser } from "@/lib/trial";
import { startCheckout } from "./actions";
import { SubmitButton } from "./submit-button";

export default async function SubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; resume?: string }>;
}) {
  // Sync the user mirror before anything that touches FKs against users.id.
  // On a fresh signup the Clerk user.created webhook can lag behind the
  // user landing here, leaving trial_sessions.user_id with nothing to point
  // at — linkTrialSessionsToCurrentUser would FK-crash without this step.
  const user = await getOrSyncCurrentUser();
  // Proxy gates /subscribe to require auth, so user should always be set
  // here — defensive bounce in case Clerk session goes missing mid-request.
  if (!user) redirect("/");
  const userId = user.id;

  await linkTrialSessionsToCurrentUser();
  // Stamp the user's UTM cookies onto their users row. /subscribe is
  // the conversion-funnel checkpoint everyone passes through, so this
  // catches paywall-driven signups, header-driven signups followed by
  // a subscribe attempt, and returning users hitting the page via a
  // remarketing link.
  await applyUserAttribution(userId);

  const { t } = await getDict();

  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        inArray(subscriptions.status, [...ACCESS_GRANTING_STATUSES]),
      ),
    )
    .orderBy(desc(subscriptions.updatedAt))
    .limit(1);

  if (existing) {
    return <AlreadySubscribed sub={existing} t={t} />;
  }

  const { show, resume } = await searchParams;

  return (
    <div className="relative min-h-screen overflow-hidden bg-background pb-16 pt-28 sm:pt-32">
      {/* Soft radial accent behind the content */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        aria-hidden
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 0%, rgba(255,61,61,0.18), transparent 55%)",
        }}
      />

      <div className="relative mx-auto max-w-md px-6 sm:px-8">
        <div className="space-y-4 text-center">
          <div className="flex justify-center">
            <MatioLogo size={20} accent="#ff3d3d" />
          </div>
          <p className="text-[11px] font-bold uppercase tracking-[0.4em] text-[#ff3d3d]">
            {t.subscribe.membershipKicker}
          </p>
          <h1 className="text-4xl font-extrabold leading-[0.95] tracking-tight text-white sm:text-5xl">
            {t.subscribe.membershipHeadline}
            <br />
            <span className="text-white/55">{t.subscribe.watchEverything}</span>
          </h1>
          <p className="text-sm text-white/55">
            {t.subscribe.cancelAnytimeAll}
          </p>
        </div>

        <form action={startCheckout} className="mt-10 space-y-6">
          {show && <input type="hidden" name="show" value={show} />}
          {resume && <input type="hidden" name="resume" value={resume} />}

          <MembershipCard
            title={t.subscribe.monthly}
            price={t.subscribe.monthlyPrice}
            interval={t.subscribe.monthlyInterval}
            sub={t.subscribe.monthlySub}
          />

          <SubmitButton />
        </form>

        {/* Trust row */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-[11px] text-white/45">
          <span className="flex items-center gap-1.5">
            <Icon name="lock" size={12} />
            {t.subscribe.secureCheckout}
          </span>
          <span className="flex items-center gap-1.5">
            <Icon name="check" size={12} color="#7fd87a" />
            {t.subscribe.cancelInOneClick}
          </span>
          <span className="flex items-center gap-1.5">
            <Icon name="check" size={12} color="#7fd87a" />
            {t.subscribe.fourKWhenAvailable}
          </span>
        </div>
      </div>
    </div>
  );
}

function AlreadySubscribed({ sub, t }: { sub: Subscription; t: Dict }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background pb-16 pt-28 sm:pt-32">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        aria-hidden
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 0%, rgba(255,61,61,0.16), transparent 55%)",
        }}
      />
      <div className="relative mx-auto max-w-2xl px-6 text-center sm:px-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.4em] text-[#ff3d3d]">
          {t.subscribe.alreadyMemberKicker}
        </p>
        <h1 className="mt-3 text-4xl font-extrabold leading-[0.95] tracking-tight text-white sm:text-5xl">
          {t.subscribe.youreSubscribed}
        </h1>
        <p className="mx-auto mt-4 max-w-md text-sm text-white/65">
          {t.subscribe.yourPlanIs(sub.plan, sub.status)}
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-2.5">
          <Link
            href="/api/billing-portal"
            className="inline-flex h-11 items-center rounded-md bg-white px-7 text-sm font-bold text-black transition-colors hover:bg-white/90"
          >
            {t.subscribe.manageSubscription}
          </Link>
          <Link
            href="/"
            className="inline-flex h-11 items-center rounded-md border border-white/15 bg-white/[0.06] px-7 text-sm font-semibold text-white transition-colors hover:bg-white/[0.12]"
          >
            {t.subscribe.backToBrowse}
          </Link>
        </div>
      </div>
    </div>
  );
}

// Single-plan membership card. No radio, no selection state — the form
// submits the only plan we sell. Kept the framed card visual so the
// price is visually anchored above the CTA rather than floating loose.
function MembershipCard({
  title,
  price,
  interval,
  sub,
}: {
  title: string;
  price: string;
  interval: string;
  sub?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border-[1.5px] border-[#ff3d3d] bg-gradient-to-br from-[#ff3d3d22] to-white/[0.04] p-5 shadow-[0_12px_40px_-20px_rgba(255,61,61,0.55)] sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-white/55">
        {title}
      </p>
      <div className="mt-4 flex items-baseline gap-1.5">
        <span className="text-3xl font-extrabold tracking-tight text-white">
          {price}
        </span>
        <span className="text-sm text-white/55"> / {interval}</span>
      </div>
      {sub && <p className="mt-1 text-xs text-white/55">{sub}</p>}
    </div>
  );
}
