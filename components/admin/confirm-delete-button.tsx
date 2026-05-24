"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";

export function ConfirmDeleteButton({
  children,
  message,
}: {
  children: React.ReactNode;
  message: string;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <Button
      variant="destructive"
      size="sm"
      type="button"
      onClick={() => {
        if (window.confirm(message)) {
          formRef.current?.requestSubmit();
        }
      }}
      ref={(el) => {
        formRef.current = el?.closest("form") ?? null;
      }}
    >
      {children}
    </Button>
  );
}
