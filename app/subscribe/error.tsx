"use client";

export default function SubscribeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black text-white">
      <h2 className="mb-2 text-xl font-semibold">Something went wrong</h2>
      <p className="mb-6 text-sm text-neutral-400">{error.message || "An unexpected error occurred."}</p>
      <button
        onClick={reset}
        className="rounded-md bg-[#ff3d3d] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-80"
      >
        Try again
      </button>
    </div>
  );
}
