import { cn } from "@/lib/utils";

// Rust dot separating meta-row entries (hero + show detail): 3px, stepping
// up to 4px from the desktop breakpoint per the 8a/9a spec.
export function MetaDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-[3px] shrink-0 rounded-full bg-rust xl:size-1",
        className,
      )}
    />
  );
}
