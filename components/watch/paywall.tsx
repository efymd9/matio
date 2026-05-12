import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

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
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-4 rounded-md border bg-muted p-6 text-center">
      <div className="space-y-1">
        <p className="text-lg font-semibold">Your free trial has ended</p>
        <p className="text-sm text-muted-foreground">
          Subscribe to keep watching.
        </p>
      </div>
      <Link
        href={`/subscribe?${params.toString()}`}
        className={buttonVariants()}
      >
        Subscribe
      </Link>
    </div>
  );
}
