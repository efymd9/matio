// One-shot sweep for #165: erase the Meta CAPI match snapshot (_fbp / _fbc /
// raw IP / user-agent) from the metadata of EVERY subscription at Stripe.
//
// The live code (lib/subscription-mirror.ts) erases the keys right after the
// Purchase event since this script was written; this handles the subscriptions
// created before that, plus any that slip past the live path (a sub whose
// events hit an early return in the mirror — no local user, unknown price).
// Re-runnable: a sub with nothing to erase is skipped.
//
// Deliberately NOT loading .env.local: that file carries the LIVE key, and a
// sweep over production subscriptions has to be an explicit act.
//
//   STRIPE_SECRET_KEY=sk_test_… pnpm stripe:scrub-capi          # dry run (default)
//   STRIPE_SECRET_KEY=sk_test_… pnpm stripe:scrub-capi --apply  # erase
//
// Output is subscription ids and key NAMES only — never the values; they are
// the data being erased.
import Stripe from "stripe";

// Mirror of CAPI_IDENTITY_KEYS in lib/capi-identity.ts — that module is
// `server-only` and cannot be imported from a tsx script. Keep in sync.
const IDENTITY_KEYS = ["capi_fbp", "capi_fbc", "capi_ip", "capi_ua"] as const;
// "" deletes a metadata key at Stripe.
const SCRUB = Object.fromEntries(IDENTITY_KEYS.map((key) => [key, ""]));

const apply = process.argv.includes("--apply");

function requireSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (key) return key;
  console.error(
    "STRIPE_SECRET_KEY must be passed explicitly (this script does not read .env.local on purpose):\n" +
      "  STRIPE_SECRET_KEY=sk_… pnpm stripe:scrub-capi [--apply]",
  );
  process.exit(1);
}

const secretKey = requireSecretKey();
const stripe = new Stripe(secretKey);

async function main() {
  const mode = secretKey.startsWith("sk_live_") ? "LIVE" : "test";
  console.log(`${apply ? "APPLY" : "DRY RUN"} — Stripe ${mode} mode`);

  let scanned = 0;
  let carrying = 0;
  let scrubbed = 0;
  let failed = 0;
  for await (const sub of stripe.subscriptions.list({
    status: "all",
    limit: 100,
  })) {
    scanned += 1;
    const present = IDENTITY_KEYS.filter((key) => Boolean(sub.metadata?.[key]));
    if (present.length === 0) continue;
    carrying += 1;
    console.log(`${sub.id} (${sub.status}): ${present.join(", ")}`);
    if (!apply) continue;
    try {
      await stripe.subscriptions.update(sub.id, { metadata: SCRUB });
      scrubbed += 1;
    } catch (err) {
      failed += 1;
      const reason =
        err instanceof Stripe.errors.StripeError
          ? (err.code ?? err.type)
          : err instanceof Error
            ? err.name
            : "unknown";
      console.error(`  ${sub.id}: update failed (${reason})`);
    }
  }

  const tail = apply
    ? `scrubbed ${scrubbed}, failed ${failed}`
    : "nothing changed (dry run — re-run with --apply)";
  console.log(
    `scanned ${scanned} subscription(s), ${carrying} carrying identity keys; ${tail}`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.name : "failed");
  process.exit(1);
});
