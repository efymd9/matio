"use client";

import { createUpload } from "@mux/upchunk";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { createMuxUpload, markEpisodeReprocessing } from "@/app/admin/actions";
import { useAdminT } from "@/lib/i18n/admin-client";

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
export function UploadWidget({
  episodeId,
  episodeStatus,
}: {
  episodeId: string;
  // The episode row's live status, re-read on every router.refresh(). This is
  // how the widget knows transcoding finished: the Mux webhook flips the row
  // to `ready`, a refresh re-renders the server page, and the new prop value
  // lands here without any client-side polling of Mux itself.
  episodeStatus: "processing" | "ready" | "errored";
}) {
  const t = useAdminT();
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // The library's own English text ("Server responded with 0…"). Useless to an
  // editor, valuable to us — kept behind a disclosure rather than thrown away.
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  // Attempts left while upchunk is retrying a chunk; null when not retrying.
  const [retrying, setRetrying] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const uploadRef = useRef<{ abort: () => void } | null>(null);

  const isWorking = status === "preparing" || status === "uploading";

  // An upload in flight lives only in this tab's memory: a reload or a closed
  // tab loses all progress and has to start from zero.
  useEffect(() => {
    if (!isWorking) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isWorking]);

  // After a successful upload the row sits in `processing` until the Mux
  // webhook arrives — minutes for a long episode. One silent refresh used to
  // be the whole story, and to a human the wait was indistinguishable from a
  // failure (issue #136: the editor re-uploaded a finished file and reported
  // the uploader broken). Poll the server page instead until the row flips,
  // with a ceiling so a lost webhook can't leave an interval running forever.
  useEffect(() => {
    if (status !== "uploaded" || episodeStatus === "ready") return;
    const startedAt = Date.now();
    const tick = setInterval(() => {
      if (Date.now() - startedAt > 15 * 60_000) {
        clearInterval(tick);
        return;
      }
      router.refresh();
    }, 10_000);
    return () => clearInterval(tick);
  }, [status, episodeStatus, router]);

  // Leaving the page mid-upload must not leave an orphan instance behind: it
  // holds window online/offline listeners and would resume on its own.
  useEffect(
    () => () => {
      uploadRef.current?.abort();
      uploadRef.current = null;
    },
    [],
  );

  function pickFile(next: File | null) {
    if (!next) return;
    if (!next.type.startsWith("video/")) {
      setError(t.uploadWidget.invalidVideoFile);
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
      setError(
        err instanceof Error ? err.message : t.uploadWidget.failedToStartUpload,
      );
      return;
    }

    setStatus("uploading");
    setRetrying(null);
    const upload = createUpload({
      endpoint: uploadUrl,
      file,
      chunkSize: 5120, // 5 MB chunks (upchunk counts in KB; must divide by 256)
      // THE fix for issue #130. upchunk only retries statuses listed here, and
      // its default list is [408, 502, 503, 504] — which does NOT include 0.
      // A dropped connection is stamped by XHR as status 0, so upchunk called
      // it fatal and gave up on the FIRST hiccup, never touching its retry
      // budget: "Server responded with 0. Stopping upload." at ~5%, minutes in.
      // 429/500 are here for the same reason — the resumable session answers
      // with them under throttling, and the default treats those as terminal.
      retryCodes: [0, 408, 429, 500, 502, 503, 504],
      // Per CHUNK, reset after each success; there is no exponential backoff in
      // this library, so the window is (attempts-1) × delay ≈ 45s. That rides
      // out a Wi-Fi→LTE handover without hanging the widget on a dead network.
      attempts: 10,
      delayBeforeAttempt: 5,
      // Lets the chunk size follow the actual line speed (doubles under 10s,
      // halves over 30s). The ceiling matters: the library's own default is
      // ~500 MB, and one drop would then throw away half a gigabyte of upload.
      dynamicChunkSize: true,
      minChunkSize: 1024, // 1 MB
      maxChunkSize: 20480, // 20 MB
    });
    uploadRef.current = upload;
    upload.on("error", (e) => {
      const detail = (e as CustomEvent<{ message?: string }>).detail;
      // The instance keeps window online/offline listeners for its whole life
      // and never removes them: a dead upload would resume itself the moment
      // the network came back, while the UI shows an error.
      upload.abort();
      uploadRef.current = null;
      setStatus("error");
      setRetrying(null);
      setError(t.uploadWidget.uploadFailed);
      setErrorDetail(detail?.message ?? null);
    });
    // Fired per failed attempt while the retry budget lasts. This is a normal
    // part of a long upload, not a failure — keep the progress bar and say so.
    upload.on("attemptFailure", (e) => {
      const detail = (e as CustomEvent<{ attemptsLeft?: number }>).detail;
      setRetrying(detail?.attemptsLeft ?? 0);
    });
    upload.on("progress", (e) => {
      setProgress((e as CustomEvent<number>).detail);
      setRetrying(null);
    });
    upload.on("success", async () => {
      uploadRef.current = null;
      setProgress(100);
      setRetrying(null);
      try {
        await markEpisodeReprocessing(episodeId);
      } catch (err) {
        setStatus("error");
        setError(
          err instanceof Error
            ? err.message
            : t.uploadWidget.uploadFinishedButMarkFailed,
        );
        return;
      }
      setStatus("uploaded");
      // Polling (effect above) takes over from here until the webhook flips
      // the row to ready.
    });
  }

  function reset() {
    uploadRef.current?.abort();
    uploadRef.current = null;
    setFile(null);
    setStatus("idle");
    setProgress(0);
    setError(null);
    setErrorDetail(null);
    setRetrying(null);
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
      {/* The row's own state when nothing is being uploaded right now. Without
          this, revisiting the page mid-transcode shows a bare drop zone — the
          exact picture that read as "it failed" in issue #136. */}
      {!file && episodeStatus === "processing" && (
        <div className="flex items-start gap-2 rounded-lg border border-gold/25 bg-gold/[0.06] px-3.5 py-2.5">
          <span className="mt-0.5 shrink-0 text-gold" aria-hidden>
            <SpinnerGlyph />
          </span>
          <p className="text-sm leading-relaxed text-cream/80">
            {t.uploadWidget.processingBanner}
          </p>
        </div>
      )}
      {!file && episodeStatus === "errored" && (
        <div className="flex items-start gap-2 rounded-lg border border-rust/30 bg-rust/[0.06] px-3.5 py-2.5">
          <span className="mt-0.5 shrink-0 text-rust" aria-hidden>
            <CrossGlyph />
          </span>
          <p className="text-sm leading-relaxed text-cream/80">
            {t.uploadWidget.erroredBanner}
          </p>
        </div>
      )}
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
              ? "border-gold/70 bg-gold/[0.06]"
              : "border-white/15 bg-black/20 hover:border-white/30 hover:bg-white/[0.03]"
          }`}
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-white/[0.06]">
            <UploadGlyph />
          </span>
          <span className="text-sm font-semibold text-cream">
            {t.uploadWidget.dropVideoPrefix}
            <span className="text-gold">{t.uploadWidget.browse}</span>
          </span>
          <span className="text-[11px] text-cream/40">
            {t.uploadWidget.acceptedFormatsHint}
          </span>
        </label>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
              <FilmGlyph />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-cream">
                {file.name}
              </p>
              <p className="font-mono text-[11px] text-cream/45">
                {formatSize(file.size)}
              </p>
            </div>
            {status === "uploaded" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#7fd87a]/15 px-2.5 py-1 text-[11px] font-bold text-[#7fd87a]">
                <CheckGlyph />
                {t.uploadWidget.uploadedBadge}
              </span>
            ) : !isWorking ? (
              <button
                type="button"
                onClick={reset}
                className="text-xs font-medium text-cream/50 transition-colors hover:text-cream"
              >
                {t.uploadWidget.remove}
              </button>
            ) : null}
          </div>

          {/* Progress bar — visible while uploading or after success. */}
          {(isWorking || status === "uploaded") && (
            <div className="mt-3.5">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                <div
                  className="h-full rounded-full bg-gold transition-[width] duration-200 ease-out"
                  style={{
                    width: `${status === "preparing" ? 4 : progress}%`,
                  }}
                />
              </div>
              <p className="mt-1.5 font-mono text-[11px] text-cream/50">
                {status === "preparing"
                  ? t.uploadWidget.preparingUpload
                  : status === "uploading"
                    ? retrying !== null
                      ? t.uploadWidget.retryingChunk(retrying)
                      : t.uploadWidget.uploadingProgress(progress.toFixed(0))
                    : episodeStatus === "ready"
                      ? t.uploadWidget.transcodingDone
                      : t.uploadWidget.transcodingWait}
              </p>
            </div>
          )}

          {/* Start button — only in the pre-upload state. */}
          {status === "idle" && (
            <button
              type="button"
              onClick={startUpload}
              className="mt-3.5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-gold-cta text-sm font-bold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-[filter] hover:brightness-110 active:scale-[0.99]"
            >
              <UploadGlyph small />
              {t.uploadWidget.startUpload}
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rust/30 bg-rust/[0.06] px-3.5 py-2.5">
          <span className="mt-0.5 shrink-0 text-rust">
            <CrossGlyph />
          </span>
          <div className="flex-1">
            <p className="text-sm text-rust">{error}</p>
            {status === "error" && file && (
              <p className="mt-1 text-xs leading-relaxed text-cream/60">
                {t.uploadWidget.uploadFailedHint}
              </p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-3">
              {status === "error" && file && (
                <button
                  type="button"
                  onClick={startUpload}
                  className="text-xs font-semibold text-gold transition-colors hover:text-gold-hi"
                >
                  {t.uploadWidget.tryAgain}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setErrorDetail(null);
                  setStatus("idle");
                }}
                className="text-xs font-medium text-cream/50 transition-colors hover:text-cream"
              >
                {t.uploadWidget.dismiss}
              </button>
            </div>
            {/* The library's raw English message. Hidden by default — it means
                nothing to an editor, but it is the first thing we ask for when
                they report a problem. */}
            {errorDetail && (
              <details className="mt-1.5">
                <summary className="cursor-pointer text-xs text-cream/40 transition-colors hover:text-cream/70">
                  {t.uploadWidget.technicalDetails}
                </summary>
                <p className="mt-1 font-mono text-[11px] leading-relaxed text-cream/50">
                  {errorDetail}
                </p>
              </details>
            )}
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
      className={small ? "text-cream" : "text-cream/70"}
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
      className="text-cream/70"
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

function SpinnerGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
      className="animate-spin"
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
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
