import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions, users } from "@/db/schema";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <h1 className="text-2xl font-semibold">Account</h1>

      {welcome === "1" && (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm">
              Welcome — your subscription is active.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Email</dt>
            <dd>{user.email}</dd>
            <dt className="text-muted-foreground">Role</dt>
            <dd>{user.role}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {subscription ? (
            <>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Plan</dt>
                <dd className="capitalize">{subscription.plan}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd className="capitalize">{subscription.status}</dd>
                <dt className="text-muted-foreground">
                  {subscription.cancelAtPeriodEnd ? "Cancels on" : "Renews"}
                </dt>
                <dd>
                  {subscription.currentPeriodEnd.toISOString().slice(0, 10)}
                </dd>
              </dl>
              <form action={openBillingPortal}>
                <Button type="submit">Manage subscription</Button>
              </form>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                You don&apos;t have an active subscription.
              </p>
              <Link href="/subscribe" className={buttonVariants()}>
                Subscribe
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
