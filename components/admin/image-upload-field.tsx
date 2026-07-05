"use client";

import { upload } from "@vercel/blob/client";
import { useId, useRef, useState } from "react";
import { Icon } from "@/components/site/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminT } from "@/lib/i18n/admin-client";

type Status = "idle" | "uploading" | "error";

// Drag-and-drop artwork field for the show form. Mirrors the props of the
// old paste-only ArtworkField (value/onChange drive the controlled poster/
// hero form state) but adds a drop zone that streams the file straight to
// Vercel Blob via @vercel/blob/client — the URL it returns is written back
// into the same field, so the existing createShow/updateShow server action
// persists it unchanged. The URL input stays below as a fallback for
// same-origin paths (e.g. a legacy /shows/*.png). Note: an arbitrary
// external host won't render through next/image on the public pages — only
// uploaded Blob URLs and same-origin paths are served there.
//
// Raw <img> for the preview (not next/image): the source is admin-entered or
// freshly-uploaded and arbitrary (any host), so it can't pass next/image's
// remotePatterns allowlist. Auth-gated, low-traffic preview — raw img is the
// right tool here; the public surfaces use next/image (and the Blob host is
// allowlisted in next.config.ts for them).
export function ImageUploadField({
  label,
  name,
  value,
  onChange,
  ratio,
  hint,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  ratio: "poster" | "hero";
  hint: string;
}) {
  const t = useAdminT();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [broken, setBroken] = useState(false);

  const trimmed = value.trim();
  const uploading = status === "uploading";

  async function handleFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus("error");
      setError(t.imageUpload.notAnImage);
      return;
    }
    setStatus("uploading");
    setError(null);
    setProgress(0);
    setBroken(false);

    try {
      // Sanitise the filename for a clean pathname; the server adds a random
      // suffix (addRandomSuffix) so this never collides or overwrites.
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
      const result = await upload(`shows/${ratio}-${safeName}`, file, {
        access: "public",
        handleUploadUrl: "/api/admin/upload-image",
        contentType: file.type,
        onUploadProgress: (e) => setProgress(e.percentage),
      });
      onChange(result.url);
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : t.imageUpload.uploadFailed);
    } finally {
      // Allow re-selecting the same file after a remove/replace.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const boxRatio =
    ratio === "poster"
      ? "aspect-[2/3] w-full max-w-[200px]"
      : "aspect-video w-full";

  return (
    <div className="space-y-2.5">
      <Label htmlFor={inputId} className="text-cream/80">
        {label}
      </Label>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
        className="peer sr-only"
        disabled={uploading}
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />

      {/* The preview box is also the drop target + click-to-browse surface. */}
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!uploading) handleFile(e.dataTransfer.files?.[0] ?? null);
        }}
        className={`group relative block cursor-pointer overflow-hidden rounded-xl border bg-black/40 transition-colors peer-focus-visible:border-gold/70 peer-focus-visible:ring-2 peer-focus-visible:ring-gold/60 ${boxRatio} ${
          dragOver
            ? "border-gold/70 bg-gold/[0.06]"
            : "border-white/10 hover:border-white/25"
        } ${uploading ? "cursor-wait" : ""}`}
      >
        {trimmed && !broken ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={trimmed}
              alt={t.imageUpload.altPreview(label)}
              className="absolute inset-0 h-full w-full object-cover"
              onError={() => setBroken(true)}
            />
            {/* Hover scrim prompting replace — hidden while uploading. */}
            {!uploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-150 group-hover:bg-black/55 group-hover:opacity-100">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-cream">
                  <UploadGlyph />
                  {t.imageUpload.dropOrClickToReplace}
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center">
            <span className="flex size-9 items-center justify-center rounded-full bg-white/[0.06]">
              <Icon
                name={broken ? "close" : "info"}
                size={15}
                color={broken ? "#ff7d7d" : "#f6efe470"}
              />
            </span>
            <span className="text-[11px] font-semibold text-cream/70">
              {broken ? t.imageUpload.couldntLoadUrl : t.imageUpload.dropImage}
              {!broken && (
                <span className="text-gold"> {t.imageUpload.orBrowse}</span>
              )}
            </span>
            <span className="text-[10px] text-cream/35">
              {t.imageUpload.formatHint}
            </span>
          </div>
        )}

        {/* Upload progress overlay */}
        {uploading && (
          <div
            role="status"
            aria-live="polite"
            className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-black/70 px-4"
          >
            <div className="h-1.5 w-full max-w-[140px] overflow-hidden rounded-full bg-white/[0.12]">
              <div
                className="h-full rounded-full bg-gold transition-[width] duration-200 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="font-mono text-[11px] text-cream/70">
              {t.imageUpload.uploadingPercent(progress.toFixed(0))}
            </span>
          </div>
        )}

        {/* Aspect-ratio chip */}
        <span className="pointer-events-none absolute right-2 top-2 rounded-[3px] bg-black/60 px-1.5 py-0.5 font-mono text-[9px] text-cream/70 backdrop-blur-md">
          {ratio === "poster" ? "2:3" : "≈21:9"}
        </span>
      </label>

      {/* URL field — auto-filled after upload, editable for paste / legacy
          /shows/*.png paths. This is the value the form actually submits. */}
      <Input
        name={name}
        value={value}
        disabled={uploading}
        onChange={(e) => {
          onChange(e.target.value);
          setBroken(false);
          if (status === "error") setStatus("idle");
        }}
        placeholder={t.imageUpload.urlPlaceholder}
        className="font-mono text-xs"
      />

      {hint ? <p className="text-[11px] text-cream/40">{hint}</p> : null}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-rust/30 bg-rust/[0.06] px-3 py-2"
        >
          <span className="mt-0.5 shrink-0 text-rust">
            <Icon name="close" size={13} color="#a8401f" />
          </span>
          <div className="flex-1">
            <p className="text-xs text-rust">{error}</p>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStatus("idle");
              }}
              className="mt-0.5 text-[11px] font-medium text-cream/50 transition-colors hover:text-cream"
            >
              {t.imageUpload.dismiss}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Local upload glyph — the site Icon set has no "upload" entry (same reason
// the Mux upload widget defines its own).
function UploadGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 16V4" />
      <path d="m6 10 6-6 6 6" />
      <path d="M4 20h16" />
    </svg>
  );
}
