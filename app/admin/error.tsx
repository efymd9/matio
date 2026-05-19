"use client";

// Admin-specific error boundary. Plenty of admin server actions throw
// (validation errors in createShow / updateShow / season + episode CRUD,
// Mux upload failures, etc.) — they used to bubble to a white screen.
// Now they land here with the action's Error.message surfaced inline so
// the admin can see what went wrong and try again without losing context.

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AdminSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">
            Something went wrong
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-foreground/85">
            {error.message || "An unexpected error occurred."}
          </p>
          {error.digest && (
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              ref · {error.digest}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" onClick={reset}>
              Try again
            </Button>
            <Link
              href="/admin"
              className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Back to admin home
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
