// Shared UTM value normalization. Lowercases, trims, and strips any character
// outside [a-z0-9_-] — which kills case drift ("TikTok" vs "tiktok"), encoded
// spaces, and stray junk like a leaked ">" from a malformed ad link
// (e.g. utm_campaign=campaign_1 vs campaign_1> fragmenting one campaign in two).
//
// Mirrors the PostHog funnel breakdown expression
//   replaceRegexpAll(lower(trim(properties.utm_campaign)), '[^a-z0-9_-]', '')
// so the app's attribution columns / cookies / Stripe metadata and PostHog
// group campaigns IDENTICALLY. Numeric Meta {{campaign.id}} values pass through
// unchanged (all digits are kept).
//
// Deliberately NOT "server-only": shared by lib/attribution.ts (server, via
// proxy.ts) AND components/site/posthog-provider.tsx (client before_send hook),
// so the normalization can never drift between the two write paths.
export function normalizeUtm(
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return normalized || undefined;
}
