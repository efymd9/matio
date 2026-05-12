import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions, type Subscription } from "@/db/schema";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { linkTrialSessionsToCurrentUser } from "@/lib/trial";
import { startCheckout } from "./actions";

const HAS_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"] as const;

export default async function SubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; resume?: string }>;
}) {
  // User just signed up via Clerk and landed back here — claim any trial
  // sessions on their cookie before they pay.
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
    <div className="mx-auto max-w-3xl space-y-10 px-6 pb-16 pt-32 sm:pt-40">
      <div className="space-y-3 text-center">
        <p className="text-[10px] font-medium uppercase tracking-[0.4em] text-accent">
          Membership
        </p>
        <h1 className="font-display text-5xl italic leading-none">
          Choose a plan
        </h1>
        <p className="text-sm text-muted-foreground">Cancel anytime.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <PlanCard
          plan="monthly"
          title="Monthly"
          price="$9.99"
          interval="month"
          show={show}
          resume={resume}
        />
        <PlanCard
          plan="annual"
          title="Annual"
          price="$79.99"
          interval="year"
          note="Save ~33% vs monthly"
          show={show}
          resume={resume}
        />
      </div>
    </div>
  );
}

function AlreadySubscribed({ sub }: { sub: Subscription }) {
  return (
    <div className="mx-auto max-w-2xl space-y-7 px-6 pb-16 pt-32 text-center sm:pt-40">
      <p className="text-[10px] font-medium uppercase tracking-[0.4em] text-accent">
        Already a member
      </p>
      <h1 className="font-display text-5xl italic leading-none">
        You&apos;re subscribed
      </h1>
      <p className="text-sm text-muted-foreground">
        Your <span className="capitalize text-foreground/80">{sub.plan}</span>{" "}
        plan is{" "}
        <span className="capitalize text-foreground/80">{sub.status}</span>.
        You can change or cancel any time in your account.
      </p>
      <div className="flex flex-wrap justify-center gap-3 pt-2">
        <Link
          href="/account"
          className="inline-flex h-12 items-center rounded-full bg-foreground px-7 text-sm font-medium text-background transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          Manage subscription
        </Link>
        <Link
          href="/"
          className="inline-flex h-12 items-center rounded-full border border-foreground/30 bg-background/20 px-7 text-sm font-medium backdrop-blur-md transition-colors hover:border-foreground/50"
        >
          Back to browse
        </Link>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  title,
  price,
  interval,
  note,
  show,
  resume,
}: {
  plan: "monthly" | "annual";
  title: string;
  price: string;
  interval: string;
  note?: string;
  show?: string;
  resume?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <span className="text-3xl font-semibold">{price}</span>
          <span className="text-muted-foreground"> / {interval}</span>
        </div>
        {note && <p className="text-sm text-green-600">{note}</p>}
        <form action={startCheckout}>
          <input type="hidden" name="plan" value={plan} />
          {show && <input type="hidden" name="show" value={show} />}
          {resume && <input type="hidden" name="resume" value={resume} />}
          <Button type="submit" className="w-full">
            Subscribe
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

