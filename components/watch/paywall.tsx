import Link from "next/link";

export function Paywall({
  showSlug,
  resumeSeconds,
}: {
  showSlug: string;
  resumeSeconds?: number;
}) {
  const params = new URLSearchParams({ show: showSlug });
  if (resumeSeconds && resumeSeconds > 0) {
    params.set("resume", String(resumeSeconds));
  }
  return (
    <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-black">
      {/* Atmospheric backdrop */}
      <div
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at 50% 40%, oklch(0.78 0.13 65 / 0.18), transparent 60%), radial-gradient(ellipse at 80% 80%, oklch(0.6 0.2 25 / 0.10), transparent 65%)",
        }}
      />
      <div className="relative flex flex-col items-center gap-6 px-6 text-center">
        <p className="text-[10px] font-medium uppercase tracking-[0.5em] text-accent">
          Trial complete
        </p>
        <h2 className="font-display text-4xl italic leading-tight text-white sm:text-5xl">
          Continue the story
        </h2>
        <p className="max-w-sm text-sm leading-relaxed text-white/65">
          Subscribe to keep watching this and everything else in the catalogue.
        </p>
        <Link
          href={`/subscribe?${params.toString()}`}
          className="mt-2 inline-flex h-12 items-center gap-2 rounded-full bg-foreground px-8 text-sm font-medium text-background transition-all duration-300 hover:bg-accent hover:text-accent-foreground"
        >
          Subscribe
          <span className="text-base">→</span>
        </Link>
      </div>
    </div>
  );
}
