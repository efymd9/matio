import Link from "next/link";
import type { ReactNode } from "react";
import { withAppEmbed } from "@/lib/app-embed";
import { isAppEmbed } from "@/lib/app-embed-server";

// A cross-link between the legal documents. On the web it is the plain link it
// always was. In the app's embed variant (#310) it stays inside the embed:
// «Privacy Policy» followed from the Terms opens the bare document, not the
// full site with its header and Subscribe link.
export async function LegalLink({
  href,
  className,
  children,
}: {
  href: "/terms" | "/privacy" | "/cookies";
  className?: string;
  children: ReactNode;
}) {
  const target = (await isAppEmbed()) ? withAppEmbed(href) : href;
  return (
    <Link href={target} className={className}>
      {children}
    </Link>
  );
}
