import { cn } from "@/lib/utils";

// Matio mark — outlined circle with a cinema-red disc inside. The wordmark
// (Geist 700, tight tracking) sits next to it unless `markOnly` is set.
export function MatioLogo({
  size = 22,
  className,
  color = "currentColor",
  accent = "#ff3d3d",
  markOnly = false,
}: {
  size?: number;
  className?: string;
  color?: string;
  accent?: string;
  markOnly?: boolean;
}) {
  const mark = (
    <svg
      width={size * 1.05}
      height={size * 1.05}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="11" stroke={color} strokeWidth="1.6" fill="none" />
      <circle cx="12" cy="12" r="4.5" fill={accent} />
    </svg>
  );
  if (markOnly) {
    return (
      <span
        className={cn("inline-flex items-center", className)}
        style={{ color }}
        aria-label="matio"
      >
        {mark}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[7px] font-sans font-bold leading-none",
        className,
      )}
      style={{
        fontSize: size,
        letterSpacing: "-0.03em",
        color,
      }}
      aria-label="matio"
    >
      {mark}
      <span>matio</span>
    </span>
  );
}
