"use client";

import { createUpload } from "@mux/upchunk";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { createMuxUpload, markEpisodeReprocessing } from "@/app/admin/actions";

type Status = "idle" | "preparing" | "uploading" | "uploaded" | "error";

function formatSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

// Drag-and-drop video uploader. The Mux wiring is unchanged from the
// original: createMuxUpload mints the direct-upload URL, upchunk streams
// the file in 5 MB chunks straight to Mux, and markEpisodeReprocessing
// flips the episode row to `processing` only on the upload `success`
// event (so a cancelled upload never strands the episode — see
// app/admin/actions.ts). Everything here is the surface around that.
export function UploadWidget({ episodeId }: { episodeId: string }) {
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const isWorking = status === "preparing" || status === "uploading";

  function pickFile(next: File | null) {
    if (!next) return;
    if (!next.type.startsWith("video/")) {
      setError("That doesn’t look like a video file.");
      return;
    }
    setFile(next);
    setStatus("idle");
    setProgress(0);
    setError(null);
  }

  async function startUpload() {
    if (!file) return;
    setStatus("preparing");
    setError(null);
    setProgress(0);

    let uploadUrl: string;
    try {
      const result = await createMuxUpload(episodeId);
      uploadUrl = result.uploadUrl;
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to start upload");
      return;
    }

    setStatus("uploading");
    const upload = createUpload({
      endpoint: uploadUrl,
      file,
      chunkSize: 5120, // 5 MB chunks
    });
    upload.on("error", (e) => {
      const detail = (e as CustomEvent<{ message?: string }>).detail;
      setStatus("error");
      setError(detail?.message ?? "Upload failed");
    });
    upload.on("progress", (e) => {
      setProgress((e as CustomEvent<number>).detail);
    });
    upload.on("success", async () => {
      setProgress(100);
      try {
        await markEpisodeReprocessing(episodeId);
      } catch (err) {
        setStatus("error");
        setError(
          err instanceof Error
            ? err.message
            : "Upload finished but the server couldn’t mark the episode reprocessing",
        );
        return;
      }
      setStatus("uploaded");
      // Mux fires the asset.ready webhook asynchronously after
      // transcoding. Refresh once to surface the new status; the user
      // can refresh again if it's still processing.
      setTimeout(() => router.refresh(), 5000);
    });
  }

  function reset() {
    setFile(null);
    setStatus("idle");
    setProgress(0);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="video/*"
        className="sr-only"
        disabled={isWorking}
        onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
      />

      {/* Drop zone — also the file picker via the wrapping label. While a
          file is selected or uploading we swap it for the detail card so
          the drop target doesn't fight the progress UI. */}
      {!file ? (
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pickFile(e.dataTransfer.files?.[0] ?? null);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-6 py-10 text-center transition-colors ${
            dragOver
              ? "border-[#ff3d3d]/70 bg-[#ff3d3d]/[0.06]"
              : "border-white/15 bg-black/20 hover:border-white/30 hover:bg-white/[0.03]"
          }`}
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-white/[0.06]">
            <UploadGlyph />
          </span>
          <span className="text-sm font-semibold text-white">
            Drop a video here, or{" "}
            <span className="text-[#ff3d3d]">browse</span>
          </span>
          <span className="text-[11px] text-white/40">
            MP4, MOV, or any video file · uploaded straight to Mux
          </span>
        </label>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
              <FilmGlyph />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">
                {file.name}
              </p>
              <p className="font-mono text-[11px] text-white/45">
                {formatSize(file.size)}
              </p>
            </div>
            {status === "uploaded" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#7fd87a]/15 px-2.5 py-1 text-[11px] font-bold text-[#7fd87a]">
                <CheckGlyph />
                Uploaded
              </span>
            ) : !isWorking ? (
              <button
                type="button"
                onClick={reset}
                className="text-xs font-medium text-white/50 transition-colors hover:text-white"
              >
                Remove
              </button>
            ) : null}
          </div>

          {/* Progress bar — visible while uploading or after success. */}
          {(isWorking || status === "uploaded") && (
            <div className="mt-3.5">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                <div
                  className="h-full rounded-full bg-[#ff3d3d] transition-[width] duration-200 ease-out"
                  style={{
                    width: `${status === "preparing" ? 4 : progress}%`,
                  }}
                />
              </div>
              <p className="mt-1.5 font-mono text-[11px] text-white/50">
                {status === "preparing"
                  ? "Preparing upload…"
                  : status === "uploading"
                    ? `Uploading · ${progress.toFixed(0)}%`
                    : "Transcoding on Mux — this page will refresh"}
              </p>
            </div>
          )}

          {/* Start button — only in the pre-upload state. */}
          {status === "idle" && (
            <button
              type="button"
              onClick={startUpload}
              className="mt-3.5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[#ff3d3d] text-sm font-bold text-white shadow-[0_8px_24px_-12px_rgba(255,61,61,0.8)] transition-[filter] hover:brightness-110 active:scale-[0.99]"
            >
              <UploadGlyph small />
              Start upload
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-[#ff3d3d]/30 bg-[#ff3d3d]/[0.06] px-3.5 py-2.5">
          <span className="mt-0.5 shrink-0 text-[#ff7d7d]">
            <CrossGlyph />
          </span>
          <div className="flex-1">
            <p className="text-sm text-[#ff7d7d]">{error}</p>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStatus("idle");
              }}
              className="mt-0.5 text-xs font-medium text-white/50 transition-colors hover:text-white"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Small inline glyphs — there's no "upload"/"film" in the site Icon set,
// so these are local to the widget.
function UploadGlyph({ small }: { small?: boolean }) {
  const s = small ? 14 : 20;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={small ? "text-white" : "text-white/70"}
      aria-hidden
    >
      <path d="M12 16V4" />
      <path d="m6 10 6-6 6 6" />
      <path d="M4 20h16" />
    </svg>
  );
}

function FilmGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-white/70"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function CrossGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
