import Link from "next/link";
import type { ReactNode } from "react";
import { withAppEmbed } from "@/lib/app-embed";
import { isAppEmbed } from "@/lib/app-embed-server";
import { getLocale } from "@/lib/i18n/server";
import { localizedPath } from "@/lib/seo";

// A cross-link between the legal documents. On the web it is the plain link it
// always was. In the app's embed variant (#310) it stays inside the embed, in
// the language being read: «Privacy Policy» followed from the Terms opens the
// bare document, not the full site with its header and Subscribe link — and
// not the English one, because an embed URL's language is its path.
export async function LegalLink({
  href,
  className,
  children,
}: {
  href: "/terms" | "/privacy" | "/cookies";
  className?: string;
  children: ReactNode;
}) {
  const target = (await isAppEmbed())
    ? withAppEmbed(localizedPath(href, await getLocale()))
    : href;
  return (
    <Link href={target} className={className}>
      {children}
    </Link>
  );
}
