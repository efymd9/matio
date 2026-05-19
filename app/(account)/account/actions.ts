"use server";

import { redirect } from "next/navigation";
import { getOrSyncCurrentUser } from "@/lib/admin";
import { getStripe } from "@/lib/stripe";

export async function openBillingPortal() {
  const user = await getOrSyncCurrentUser();
  if (!user) redirect("/");

  if (!user.stripeCustomerId) {
    throw new Error(
      "No Stripe customer on file — subscribe first to create one",
    );
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const session = await getStripe().billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${origin}/account`,
  });

  redirect(session.url);
}
