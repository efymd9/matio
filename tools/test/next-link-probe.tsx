// A stand-in for `next/link` in jsdom suites that have to tell a next/link
// anchor from a plain <a> — and to read the `prefetch` prop, which next/link
// never writes to the DOM. Shared by components/site/site-footer.test.tsx,
// components/site/site-header.test.tsx and app/subscribe/page.test.tsx (#259),
// so "is this a next/link?" means one thing in all three. Lives under tools/
// like the Stripe checkout fake: test scaffolding, outside coverage.
//
// Why a suite cares: next/link PREFETCHES whatever scrolls into view. For a
// route handler with a side effect that is a GET nobody asked for; for a page
// the proxy answers with a cross-origin redirect it is a fetch that can only
// fail. Neither is visible in the rendered HTML — only through this probe.
//
// Usage: vi.mock("next/link", async () => await import("@/tools/test/next-link-probe"));
//
//   data-next-link            present ⇔ the anchor came from next/link
//   data-prefetch="default"   the prop was left out (next/link's own default)
//   data-prefetch="false"     prefetch={false}
import type { AnchorHTMLAttributes } from "react";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  prefetch?: boolean | "auto" | null;
};

export default function NextLinkProbe({ href, prefetch, ...rest }: Props) {
  return (
    <a
      {...rest}
      href={href}
      data-next-link=""
      data-prefetch={prefetch === undefined ? "default" : String(prefetch)}
    />
  );
}

export function isNextLink(el: Element): boolean {
  return el.hasAttribute("data-next-link");
}

export function prefetchOf(el: Element): string | null {
  return el.getAttribute("data-prefetch");
}
