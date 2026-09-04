// Which /admin/analytics page to render. The spec'd retention dashboard (v2)
// is the dashboard in BOTH modes since 2026-09-04 — it is the one the owner
// reads. The pre-2026-07-18 legacy dashboard (MRR, subscription mix, paid
// funnels) stays reachable in paid mode via `?view=legacy`; in free mode its
// paid panels would be zeros, so the switch is ignored there.
export type AnalyticsView = "v2" | "legacy";

export function resolveAnalyticsView(
  paymentsOn: boolean,
  view: string | string[] | undefined,
): AnalyticsView {
  const v = Array.isArray(view) ? view[0] : view;
  return paymentsOn && v === "legacy" ? "legacy" : "v2";
}
