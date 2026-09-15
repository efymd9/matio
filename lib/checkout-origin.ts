// Where Stripe sends the buyer back after paying.
//
// This is a money path with a one-way door: by the time the return URL is
// used, the card has been charged. A wrong origin means the charge went
// through and the buyer landed on a page that does not exist — and nobody
// finds out until they complain. That is exactly what the staging rehearsal
// produced on 2026-09-09 (#202): NEXT_PUBLIC_APP_URL was unset on the bench
// and the old inline fallback quietly returned http://localhost:3000.
//
// So the localhost fallback is now allowed in one place only — a developer's
// own machine — and a deployment with no usable origin refuses to create the
// session at all. Refusing before the charge is always better than
// redirecting into nowhere after it.

export class CheckoutOriginError extends Error {
  constructor() {
    super(
      "No absolute origin for the checkout return URL: set NEXT_PUBLIC_APP_URL",
    );
    this.name = "CheckoutOriginError";
  }
}

export type CheckoutOriginInput = {
  /** NEXT_PUBLIC_APP_URL — the deliberate answer, set per environment. */
  appUrl?: string;
  /** Vercel's own marker: present on every deployment, absent locally. */
  onVercel?: string;
  /** The project's stable production host, without a scheme. */
  projectProductionUrl?: string;
  /** This deployment's host, without a scheme (preview deploys). */
  deploymentUrl?: string;
};

function normalize(candidate: string): string | null {
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  // A bare host (Vercel's variables) becomes https. Anything carrying a
  // scheme must carry an http(s) one: prefixing "ftp://matio.tv" would
  // otherwise yield the perfectly parseable — and perfectly wrong —
  // origin "https://ftp".
  const hasScheme = trimmed.includes("://");
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) return null;
  const withScheme = hasScheme ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  return url.origin;
}

/**
 * Pure resolution of the checkout return origin, in order of intent:
 * the explicit variable, then the platform's own hosts, then localhost —
 * and localhost ONLY when this is not a deployment.
 *
 * @throws CheckoutOriginError when deployed with nothing usable.
 */
export function resolveCheckoutOrigin({
  appUrl,
  onVercel,
  projectProductionUrl,
  deploymentUrl,
}: CheckoutOriginInput): string {
  for (const candidate of [appUrl, projectProductionUrl, deploymentUrl]) {
    if (!candidate) continue;
    const origin = normalize(candidate);
    if (origin) return origin;
  }
  if (onVercel) throw new CheckoutOriginError();
  return "http://localhost:3000";
}

/**
 * The same decision, reading the environment. NEXT_PUBLIC_APP_URL is read as
 * a static member expression on purpose: Next inlines it at build time only
 * in that form, and passing `process.env` around would strand it undefined
 * in the server bundle.
 */
export function checkoutOrigin(): string {
  return resolveCheckoutOrigin({
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    onVercel: process.env.VERCEL,
    projectProductionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    deploymentUrl: process.env.VERCEL_URL,
  });
}
