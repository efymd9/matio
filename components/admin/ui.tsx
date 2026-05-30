import Link from "next/link";
import { Icon } from "@/components/site/icon";
import { Label } from "@/components/ui/label";

// Shared admin presentation primitives. Keep the cinema control-room
// look identical across every admin/shows surface — the show list, the
// ShowForm panels, the season + episode pages all share these so the
// section reads as one cohesive tool rather than a stack of differently
// styled forms.

export function AdminPageHeader({
  backHref,
  backLabel,
  kicker,
  title,
  pills,
  actions,
  subtitle,
}: {
  backHref: string;
  backLabel: string;
  kicker?: string;
  title: string;
  pills?: React.ReactNode;
  actions?: React.ReactNode;
  subtitle?: React.ReactNode;
}) {
  return (
    <div>
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-sm text-white/50 transition-colors hover:text-white"
      >
        <Icon name="back" size={14} />
        {backLabel}
      </Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {kicker ? (
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#ff3d3d]">
              {kicker}
            </p>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <h1 className="text-3xl font-extrabold tracking-tight text-white">
              {title}
            </h1>
            {pills}
          </div>
          {subtitle ? (
            <div className="mt-1 text-sm text-white/55">{subtitle}</div>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function Panel({
  kicker,
  title,
  hint,
  right,
  children,
}: {
  kicker: string;
  title: string;
  hint?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#ff3d3d]">
            {kicker}
          </p>
          <h2 className="mt-1 text-base font-bold tracking-tight text-white">
            {title}
          </h2>
          {hint ? <p className="mt-1 text-xs text-white/45">{hint}</p> : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function DangerPanel({
  description,
  children,
}: {
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#ff3d3d]/25 bg-[#ff3d3d]/[0.04] p-5 sm:p-6">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#ff3d3d]">
        Danger zone
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-white/65">{description}</p>
        {children}
      </div>
    </section>
  );
}

export function Field({
  label,
  htmlFor,
  required,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-white/80">
        {label}
        {required ? <span className="text-[#ff3d3d]">*</span> : null}
      </Label>
      {children}
      {hint ? <p className="text-[11px] text-white/40">{hint}</p> : null}
    </div>
  );
}

// Episode video status. `processing` shows a spinning ring (Mux is
// transcoding), `ready` a green check, `errored` a red cross, and a
// missing asset reads as "No video" so an empty episode is obvious at a
// glance. Each badge pairs colour with an icon/shape so the state is
// legible without relying on colour alone (colour-blind safe).
export function EpisodeStatusBadge({
  status,
  hasAsset,
}: {
  status: "processing" | "ready" | "errored";
  hasAsset: boolean;
}) {
  if (!hasAsset) {
    return (
      <Badge tone="neutral">
        <span className="inline-block size-1.5 rounded-full bg-white/40" />
        No video
      </Badge>
    );
  }
  if (status === "ready") {
    return (
      <Badge tone="green">
        <Icon name="check" size={11} color="#7fd87a" />
        Ready
      </Badge>
    );
  }
  if (status === "errored") {
    return (
      <Badge tone="red">
        <Icon name="close" size={11} color="#ff7d7d" />
        Error
      </Badge>
    );
  }
  return (
    <Badge tone="amber">
      <Spinner className="text-[#f5c451]" />
      Processing
    </Badge>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "green" | "red" | "amber" | "neutral";
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    green: "bg-[#7fd87a]/15 text-[#7fd87a]",
    red: "bg-[#ff3d3d]/15 text-[#ff7d7d]",
    amber: "bg-[#f5c451]/15 text-[#f5c451]",
    neutral: "bg-white/10 text-white/65",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function Spinner({ className }: { className: string }) {
  return (
    <svg
      className={`size-3 animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="3"
      />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
