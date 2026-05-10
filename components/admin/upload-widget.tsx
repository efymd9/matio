"use client";

import { createUpload } from "@mux/upchunk";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createMuxUpload } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";

type Status = "idle" | "preparing" | "uploading" | "uploaded" | "error";

export function UploadWidget({ episodeId }: { episodeId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const isWorking = status === "preparing" || status === "uploading";

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
    upload.on("success", () => {
      setStatus("uploaded");
      setProgress(100);
      // Mux fires the asset.ready webhook asynchronously after transcoding.
      // Refresh once to surface the new status; user can re-refresh later.
      setTimeout(() => router.refresh(), 5000);
    });
  }

  return (
    <div className="space-y-3">
      <input
        type="file"
        accept="video/*"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setStatus("idle");
          setProgress(0);
          setError(null);
        }}
        disabled={isWorking}
        className="block text-sm"
      />
      {file && (
        <div className="flex items-center gap-3">
          <Button onClick={startUpload} disabled={isWorking || status === "uploaded"}>
            {status === "preparing"
              ? "Preparing…"
              : status === "uploading"
                ? `Uploading ${progress.toFixed(0)}%`
                : status === "uploaded"
                  ? "Uploaded"
                  : "Start upload"}
          </Button>
          <span className="text-sm text-muted-foreground">
            {file.name} · {(file.size / 1_048_576).toFixed(1)} MB
          </span>
        </div>
      )}
      {status === "uploaded" && (
        <p className="text-sm text-muted-foreground">
          Upload complete — Mux is transcoding. Page will refresh; if status
          stays &quot;processing&quot;, refresh again in a moment.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
