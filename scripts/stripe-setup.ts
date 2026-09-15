import { config } from "dotenv";
config({ path: ".env.local" });

import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  console.error(
    "STRIPE_SECRET_KEY is not set in .env.local — grab a test key from dashboard.stripe.com",
  );
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const CURRENCY = "usd";

// The one and only plan: $25/mo, charged at checkout (#207). The former
// $1 / 3-day intro fee is gone — there is no trial and no second line item.
const PRODUCT_NAME = "Matio Membership";
const PLAN = "monthly";
const UNIT_AMOUNT = 2500; // $25.00 USD
const INTERVAL = "month" as const;


async function ensureProduct(name: string, plan: string) {
  const list = await stripe.products.list({ limit: 100 });
  const existing = list.data.find((p) => p.active && p.metadata.plan === plan);
  if (existing) {
    // Keep the product but make sure the display name reflects the
    // current branding. Stripe lets us update the name in place without
    // rotating the product id (which prices reference).
    if (existing.name !== name) {
      const renamed = await stripe.products.update(existing.id, { name });
      console.log(`~ renamed product ${existing.id} → "${name}"`);
      return renamed;
    }
    console.log(`✓ product already exists: ${existing.id}`);
    return existing;
  }
  const created = await stripe.products.create({ name, metadata: { plan } });
  console.log(`+ created product: ${created.id}`);
  return created;
}

async function ensurePrice(opts: {
  productId: string;
  plan: string;
  unitAmount: number;
  interval?: "month";
}) {
  const { productId, plan, unitAmount, interval } = opts;
  const list = await stripe.prices.list({
    product: productId,
    limit: 100,
    active: true,
  });
  const matching = list.data.find(
    (p) =>
      p.metadata.plan === plan &&
      p.unit_amount === unitAmount &&
      p.currency === CURRENCY &&
      (interval ? p.recurring?.interval === interval : p.recurring == null),
  );
  if (matching) {
    console.log(
      `✓ price already exists at $${unitAmount / 100}/${interval ?? "one-time"}: ${matching.id}`,
    );
    return matching;
  }
  // Stripe prices are immutable — to change the amount we archive any
  // stale active price for this product+plan and create a fresh one.
  // Past subscriptions on the old price keep billing at the old amount;
  // only new checkouts switch to the new price.
  const stale = list.data.filter((p) => p.metadata.plan === plan);
  for (const p of stale) {
    await stripe.prices.update(p.id, { active: false });
    console.log(
      `~ archived stale price: ${p.id} ($${(p.unit_amount ?? 0) / 100}/${p.recurring?.interval ?? "one-time"})`,
    );
  }
  const created = await stripe.prices.create({
    product: productId,
    unit_amount: unitAmount,
    currency: CURRENCY,
    // Match the live membership price's tax treatment so VAT/sales tax stacks on
    // top of the membership price once a Stripe Tax registration is added.
    tax_behavior: "exclusive",
    ...(interval ? { recurring: { interval } } : {}),
    metadata: { plan },
  });
  console.log(
    `+ created price: ${created.id} ($${unitAmount / 100}/${interval ?? "one-time"})`,
  );
  return created;
}

async function main() {
  const product = await ensureProduct(PRODUCT_NAME, PLAN);
  const price = await ensurePrice({
    productId: product.id,
    plan: PLAN,
    unitAmount: UNIT_AMOUNT,
    interval: INTERVAL,
  });


  console.log("\nAdd these to .env.local (replace any existing values):\n");
  console.log(`STRIPE_PRICE_MONTHLY=${price.id}`);
  console.log("\nThen push to Vercel (then redeploy to pick them up):");
  console.log("  vercel env rm STRIPE_PRICE_MONTHLY production --yes");
  console.log(`  echo -n "${price.id}" | vercel env add STRIPE_PRICE_MONTHLY production`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
