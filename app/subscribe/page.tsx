import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions, type Subscription } from "@/db/schema";
import { MatioLogo } from "@/components/site/matio-logo";
import { Icon } from "@/components/site/icon";
import { linkTrialSessionsToCurrentUser } from "@/lib/trial";
import { startCheckout } from "./actions";

const HAS_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"] as const;

export default async function SubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; resume?: string }>;
}) {
  await linkTrialSessionsToCurrentUser();

  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        inArray(subscriptions.status, [...HAS_SUBSCRIPTION_STATUSES]),
      ),
    )
    .orderBy(desc(subscriptions.updatedAt))
    .limit(1);

  if (existing) {
    return <AlreadySubscribed sub={existing} />;
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

      <div className="relative mx-auto max-w-3xl px-6 sm:px-8">
        <div className="space-y-4 text-center">
          <div className="flex justify-center">
            <MatioLogo size={20} accent="#ff3d3d" />
          </div>
          <p className="text-[11px] font-bold uppercase tracking-[0.4em] text-[#ff3d3d]">
            Membership
          </p>
          <h1 className="text-4xl font-extrabold leading-[0.95] tracking-tight text-white sm:text-5xl">
            Pick a plan.
            <br />
            <span className="text-white/55">Watch everything.</span>
          </h1>
          <p className="text-sm text-white/55">
            Cancel anytime. All originals included.
          </p>
        </div>

        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          <PlanCard
            plan="monthly"
            title="Monthly"
            price="$9.99"
            interval="month"
            sub="Billed monthly · cancel anytime"
            show={show}
            resume={resume}
          />
          <PlanCard
            plan="annual"
            title="Annual"
            price="$79.99"
            interval="year"
            sub="≈ $6.67/mo · 33% off"
            highlight
            badge="Best value"
            show={show}
            resume={resume}
          />
        </div>

        {/* Trust row */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-[11px] text-white/45">
          <span className="flex items-center gap-1.5">
            <Icon name="lock" size={12} />
            Secure checkout via Stripe
          </span>
          <span className="flex items-center gap-1.5">
            <Icon name="check" size={12} color="#7fd87a" />
            Cancel in one click
          </span>
          <span className="flex items-center gap-1.5">
            <Icon name="check" size={12} color="#7fd87a" />
            4K when available
          </span>
        </div>
      </div>
    </div>
  );
}

function AlreadySubscribed({ sub }: { sub: Subscription }) {
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
          Already a member
        </p>
        <h1 className="mt-3 text-4xl font-extrabold leading-[0.95] tracking-tight text-white sm:text-5xl">
          You&apos;re subscribed.
        </h1>
        <p className="mx-auto mt-4 max-w-md text-sm text-white/65">
          Your <span className="capitalize text-white">{sub.plan}</span> plan is{" "}
          <span className="capitalize text-white">{sub.status}</span>. Change or
          cancel any time in your account.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-2.5">
          <Link
            href="/account"
            className="inline-flex h-11 items-center rounded-md bg-white px-7 text-sm font-bold text-black transition-colors hover:bg-white/90"
          >
            Manage subscription
          </Link>
          <Link
            href="/"
            className="inline-flex h-11 items-center rounded-md border border-white/15 bg-white/[0.06] px-7 text-sm font-semibold text-white transition-colors hover:bg-white/[0.12]"
          >
            Back to browse
          </Link>
        </div>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  title,
  price,
  interval,
  sub,
  badge,
  highlight = false,
  show,
  resume,
}: {
  plan: "monthly" | "annual";
  title: string;
  price: string;
  interval: string;
  sub?: string;
  badge?: string;
  highlight?: boolean;
  show?: string;
  resume?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl p-5 sm:p-6 ${
        highlight
          ? "border-[1.5px] border-[#ff3d3d] bg-gradient-to-br from-[#ff3d3d22] to-white/[0.04]"
          : "border border-white/10 bg-white/[0.04]"
      }`}
    >
      {highlight && badge ? (
        <span className="absolute right-4 top-4 rounded-full bg-[#ff3d3d] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-white">
          {badge}
        </span>
      ) : null}
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
      <form action={startCheckout} className="mt-5">
        <input type="hidden" name="plan" value={plan} />
        {show && <input type="hidden" name="show" value={show} />}
        {resume && <input type="hidden" name="resume" value={resume} />}
        <button
          type="submit"
          className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-md text-sm font-bold transition-colors ${
            highlight
              ? "bg-gradient-to-r from-[#ff3d3d] to-[#ff5e3d] text-white hover:brightness-110"
              : "bg-white text-black hover:bg-white/90"
          }`}
        >
          <Icon name="play" size={14} color={highlight ? "#ffffff" : "#0a0a0c"} />
          Subscribe
        </button>
      </form>
    </div>
  );
}
