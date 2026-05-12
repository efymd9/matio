import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions, users } from "@/db/schema";
import { Icon } from "@/components/site/icon";
import { openBillingPortal } from "./actions";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { welcome } = await searchParams;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) redirect("/sign-in");

  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        inArray(subscriptions.status, ["active", "trialing", "past_due"]),
      ),
    )
    .orderBy(desc(subscriptions.updatedAt))
    .limit(1);

  const initial = (user.email[0] ?? "M").toUpperCase();
  const renewLabel = subscription
    ? subscription.cancelAtPeriodEnd
      ? "Cancels on"
      : "Renews on"
    : null;
  const renewDate = subscription
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-5 pb-20 pt-28 sm:px-6 sm:pt-32">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Account
        </h1>
        <Icon name="settings" size={22} color="rgba(255,255,255,0.7)" />
      </div>

      {welcome === "1" && (
        <div className="rounded-xl border border-[#7fd87a]/30 bg-[#7fd87a]/10 p-4 text-sm text-white">
          <div className="flex items-center gap-2">
            <Icon name="check" size={16} color="#7fd87a" />
            <span className="font-semibold">Welcome.</span>
            <span className="text-white/70">Your subscription is active.</span>
          </div>
        </div>
      )}

      {/* User card — gradient avatar block */}
      <div className="flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#ff3d3d22] to-white/[0.04] p-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-2xl font-extrabold text-white"
          style={{
            backgroundImage:
              "linear-gradient(135deg, #ff3d3d 0%, #b821a3 100%)",
          }}
          aria-hidden
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold text-white">
            {user.email}
          </p>
          <p className="text-xs capitalize text-white/55">
            {user.role}
            {subscription ? " · Premium" : ""}
          </p>
        </div>
        <Icon name="chevron-right" size={18} color="rgba(255,255,255,0.4)" />
      </div>

      {/* Subscription card */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.08em] text-white/55">
              Subscription
            </p>
            <p className="mt-1 text-base font-bold text-white">
              {subscription
                ? `${subscription.plan === "annual" ? "Annual" : "Monthly"} · Premium`
                : "Not subscribed"}
            </p>
          </div>
          {subscription ? (
            <span
              className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.04em] ${
                subscription.status === "active"
                  ? "bg-[#7fd87a]/15 text-[#7fd87a]"
                  : subscription.status === "past_due"
                    ? "bg-amber-500/15 text-amber-400"
                    : "bg-white/10 text-white/70"
              }`}
            >
              {subscription.status}
            </span>
          ) : null}
        </div>
        {subscription && renewDate ? (
          <p className="mt-2 text-xs text-white/65">
            {renewLabel}{" "}
            <strong className="font-semibold text-white">{renewDate}</strong>
          </p>
        ) : null}
        <div className="mt-4">
          {subscription ? (
            <form action={openBillingPortal}>
              <button
                type="submit"
                className="inline-flex h-10 w-full items-center justify-center rounded-md border border-white/15 bg-transparent px-4 text-xs font-semibold text-white transition-colors hover:bg-white/10"
              >
                Manage subscription
              </button>
            </form>
          ) : (
            <Link
              href="/subscribe"
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-white text-sm font-bold text-black transition-colors hover:bg-white/90"
            >
              Subscribe
            </Link>
          )}
        </div>
      </div>

      {/* Menu sections */}
      {[
        {
          title: "Viewing",
          items: ["My list", "Watch history", "Downloads", "Ratings"],
        },
        {
          title: "Account",
          items: ["Payment methods", "Notifications", "Privacy", "Language"],
        },
        {
          title: "Help",
          items: ["FAQ", "Contact support", "Terms of use"],
        },
      ].map((section) => (
        <div key={section.title} className="space-y-2">
          <p className="px-1 text-[11px] uppercase tracking-[0.08em] text-white/45">
            {section.title}
          </p>
          <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.04]">
            {section.items.map((item, i) => (
              <div
                key={item}
                className={`flex items-center justify-between px-4 py-3.5 text-sm text-white transition-colors hover:bg-white/[0.04] ${
                  i < section.items.length - 1
                    ? "border-b border-white/[0.05]"
                    : ""
                }`}
              >
                <span>{item}</span>
                <Icon
                  name="chevron-right"
                  size={16}
                  color="rgba(255,255,255,0.35)"
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      <p className="text-center text-[10px] text-white/30">
        matio · v1.0
      </p>
    </div>
  );
}
