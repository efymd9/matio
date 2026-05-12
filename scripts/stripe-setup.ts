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

async function ensureProduct(name: string, plan: "monthly" | "annual") {
  const list = await stripe.products.list({ limit: 100 });
  const existing = list.data.find(
    (p) => p.active && p.metadata.plan === plan,
  );
  if (existing) {
    console.log(`✓ product plan=${plan} already exists: ${existing.id}`);
    return existing;
  }
  const created = await stripe.products.create({ name, metadata: { plan } });
  console.log(`+ created product plan=${plan}: ${created.id}`);
  return created;
}

async function ensurePrice(
  productId: string,
  plan: "monthly" | "annual",
  unitAmount: number,
  interval: "month" | "year",
) {
  const list = await stripe.prices.list({
    product: productId,
    limit: 100,
    active: true,
  });
  const existing = list.data.find((p) => p.metadata.plan === plan);
  if (existing) {
    console.log(
      `✓ price plan=${plan} already exists: ${existing.id} ($${(existing.unit_amount ?? 0) / 100}/${interval})`,
    );
    return existing;
  }
  const created = await stripe.prices.create({
    product: productId,
    unit_amount: unitAmount,
    currency: "usd",
    recurring: { interval },
    metadata: { plan },
  });
  console.log(
    `+ created price plan=${plan}: ${created.id} ($${unitAmount / 100}/${interval})`,
  );
  return created;
}

async function main() {
  const monthlyProduct = await ensureProduct("Matio Monthly", "monthly");
  const monthlyPrice = await ensurePrice(
    monthlyProduct.id,
    "monthly",
    999,
    "month",
  );

  const annualProduct = await ensureProduct("Matio Annual", "annual");
  const annualPrice = await ensurePrice(
    annualProduct.id,
    "annual",
    7999,
    "year",
  );

  console.log("\nAdd these to .env.local (replace any existing values):\n");
  console.log(`STRIPE_PRICE_MONTHLY=${monthlyPrice.id}`);
  console.log(`STRIPE_PRICE_ANNUAL=${annualPrice.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
