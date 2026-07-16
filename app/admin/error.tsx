"use client";

// Admin-specific error boundary — the last resort for unexpected throws
// (forged-post integrity guards, Mux upload failures, transient DB/API
// errors). NOT for form validation: in production builds Next.js masks a
// thrown Error's message behind a digest, so anything an admin can trip
// by typing must return a typed error code rendered inline in the form
// instead (AdminFormState in app/admin/actions.ts, CreateLinkState in
// app/admin/links/actions.ts). Error.message renders inline in dev only.

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAdminT } from "@/lib/i18n/admin-client";

export default function AdminSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useAdminT();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">
            {t.errorBoundary.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-foreground/85">
            {error.message || t.errorBoundary.unexpectedError}
          </p>
          {error.digest && (
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              ref · {error.digest}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" onClick={reset}>
              {t.errorBoundary.tryAgain}
            </Button>
            <Link
              href="/admin"
              className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              {t.errorBoundary.backToAdminHome}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
