"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MatioLogo } from "./matio-logo";
import { Icon } from "./icon";

// Sticky transparent → frosted-dark header. Hides on /watch (immersive
// fullscreen player) and /admin (own nav).
export function SiteHeader({ authSlot }: { authSlot: React.ReactNode }) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

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
          ? "border-b border-white/[0.06] bg-background/85 backdrop-blur-xl backdrop-saturate-150"
          : "border-b-0 bg-gradient-to-b from-background/70 via-background/25 to-transparent",
      )}
    >
      <div className="mx-auto flex max-w-screen-2xl items-center gap-8 px-6 py-4 sm:px-12">
        <Link
          href="/"
          className="group flex items-center transition-opacity hover:opacity-90"
          aria-label="matio home"
        >
          <MatioLogo size={20} accent="#ff3d3d" color="#ffffff" />
        </Link>
        <nav className="hidden gap-7 text-sm font-medium text-white/70 sm:flex">
          <Link
            href="/"
            className="transition-colors hover:text-white"
          >
            Browse
          </Link>
          <Link
            href="/subscribe"
            className="transition-colors hover:text-white"
          >
            Subscribe
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <button
            type="button"
            aria-label="Search"
            className="hidden text-white/80 transition-colors hover:text-white sm:inline-flex"
          >
            <Icon name="search" size={20} />
          </button>
          {authSlot}
        </div>
      </div>
    </header>
  );
}
