"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function SiteHeader({ authSlot }: { authSlot: React.ReactNode }) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  // Hide on /watch, /admin (admin has its own nav), and never on /sign-in flows
  const hidden = pathname?.startsWith("/watch") || pathname?.startsWith("/admin");

  useEffect(() => {
    if (hidden) return;
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [hidden]);

  if (hidden) return null;

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 transition-[background-color,backdrop-filter,border-color] duration-500 ease-out",
        scrolled
          ? "border-b border-border/40 bg-background/75 backdrop-blur-xl backdrop-saturate-150"
          : "border-b-0 bg-transparent",
      )}
    >
      <div className="mx-auto flex max-w-screen-2xl items-center gap-8 px-6 py-4 sm:px-12">
        <Link
          href="/"
          className="group flex items-baseline gap-1 transition-opacity hover:opacity-90"
          aria-label="matio home"
        >
          <span className="font-display text-3xl italic leading-none tracking-tight text-foreground">
            matio
          </span>
          <span className="size-1.5 translate-y-[-2px] rounded-full bg-accent transition-transform duration-500 group-hover:scale-150" />
        </Link>
        <nav className="hidden gap-7 text-sm text-foreground/70 sm:flex">
          <Link
            href="/"
            className="transition-colors hover:text-foreground"
          >
            Browse
          </Link>
          <Link
            href="/subscribe"
            className="transition-colors hover:text-foreground"
          >
            Subscribe
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">{authSlot}</div>
      </div>
    </header>
  );
}
