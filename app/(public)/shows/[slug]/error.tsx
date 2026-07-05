"use client";

export default function ShowError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center text-cream">
      <h2 className="mb-2 text-xl font-semibold">Something went wrong loading this show</h2>
      <p className="mb-6 text-sm text-cream/55">{error.message || "An unexpected error occurred."}</p>
      <button
        onClick={reset}
        className="inline-flex h-11 items-center justify-center rounded-full bg-gold-cta px-6 text-sm font-extrabold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-transform active:scale-[0.98]"
      >
        Try again
      </button>
    </div>
  );
}
