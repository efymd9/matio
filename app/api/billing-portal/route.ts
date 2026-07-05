import { NextResponse } from "next/server";
import { getOrSyncCurrentUser } from "@/lib/admin";
import { paymentsEnabled } from "@/lib/free-mode";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

// Direct entry into the Stripe Customer Portal. Lets the "Manage
// subscription" menu item in <UserMenu/> link straight to Stripe without
// bouncing through /account. Server-only: auth + DB lookup + Stripe session
// + 302 happen in one round-trip, and the target URL is Stripe-issued
// (not user-controlled) so this isn't an open-redirect surface.
export async function GET() {
  const user = await getOrSyncCurrentUser();
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  // Not signed in → bounce home. The menu item is only rendered when the
  // <Show when="signed-in"> guard passes, so this is just defense-in-depth
  // for anyone hitting the URL directly.
  if (!user) {
    return NextResponse.redirect(new URL("/", origin));
  }

  // Subscribed users get a portal session. Pre-subscription users have no
  // customer record yet — send them to /subscribe to create one instead of
  // 500-ing. With payments off, /subscribe itself bounces home; skip the
  // double hop. (The portal itself stays functional in free mode — legacy
  // subscribers cancel through here.)
  if (!user.stripeCustomerId) {
    return NextResponse.redirect(
      new URL(paymentsEnabled() ? "/subscribe" : "/", origin),
    );
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${origin}/`,
  });

  const res = NextResponse.redirect(session.url);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
