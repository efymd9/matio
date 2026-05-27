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

const PRODUCT_NAME = "Matio Membership";
const PLAN = "monthly";
const UNIT_AMOUNT = 3800; // $38.00 USD
const INTERVAL = "month" as const;
const CURRENCY = "usd";

async function ensureProduct() {
  const list = await stripe.products.list({ limit: 100 });
  const existing = list.data.find(
    (p) => p.active && p.metadata.plan === PLAN,
  );
  if (existing) {
    // Keep the product but make sure the display name reflects the
    // current single-plan branding. Stripe lets us update the name in
    // place without rotating the product id (which prices reference).
    if (existing.name !== PRODUCT_NAME) {
      const renamed = await stripe.products.update(existing.id, {
        name: PRODUCT_NAME,
      });
      console.log(`~ renamed product ${existing.id} → "${PRODUCT_NAME}"`);
      return renamed;
    }
    console.log(`✓ product already exists: ${existing.id}`);
    return existing;
  }
  const created = await stripe.products.create({
    name: PRODUCT_NAME,
    metadata: { plan: PLAN },
  });
  console.log(`+ created product: ${created.id}`);
  return created;
}

async function ensurePrice(productId: string) {
  const list = await stripe.prices.list({
    product: productId,
    limit: 100,
    active: true,
  });
  const matching = list.data.find(
    (p) =>
      p.metadata.plan === PLAN &&
      p.unit_amount === UNIT_AMOUNT &&
      p.currency === CURRENCY &&
      p.recurring?.interval === INTERVAL,
  );
  if (matching) {
    console.log(
      `✓ price already exists at $${UNIT_AMOUNT / 100}/${INTERVAL}: ${matching.id}`,
    );
    return matching;
  }
  // Stripe prices are immutable — to change the amount we archive any
  // stale active price for this product+plan and create a fresh one.
  // Past subscriptions on the old price keep billing at the old amount;
  // only new checkouts switch to the new price.
  const stale = list.data.filter((p) => p.metadata.plan === PLAN);
  for (const p of stale) {
    await stripe.prices.update(p.id, { active: false });
    console.log(
      `~ archived stale price: ${p.id} ($${(p.unit_amount ?? 0) / 100}/${p.recurring?.interval ?? "?"})`,
    );
  }
  const created = await stripe.prices.create({
    product: productId,
    unit_amount: UNIT_AMOUNT,
    currency: CURRENCY,
    recurring: { interval: INTERVAL },
    metadata: { plan: PLAN },
  });
  console.log(
    `+ created price: ${created.id} ($${UNIT_AMOUNT / 100}/${INTERVAL})`,
  );
  return created;
}

async function main() {
  const product = await ensureProduct();
  const price = await ensurePrice(product.id);

  console.log("\nAdd this to .env.local (replace any existing value):\n");
  console.log(`STRIPE_PRICE_MONTHLY=${price.id}`);
  console.log(
    "\nThen push to Vercel:\n  vercel env rm STRIPE_PRICE_MONTHLY production --yes",
  );
  console.log(`  echo -n "${price.id}" | vercel env add STRIPE_PRICE_MONTHLY production`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
