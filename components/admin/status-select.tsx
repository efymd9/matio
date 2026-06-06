"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAdminT } from "@/lib/i18n/admin-client";

type Status = "draft" | "published";

export function StatusSelect({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue: Status;
}) {
  const t = useAdminT();
  const [value, setValue] = useState<Status>(defaultValue);
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Select value={value} onValueChange={(v) => setValue(v as Status)}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="draft">{t.statusSelect.draft}</SelectItem>
          <SelectItem value="published">{t.statusSelect.published}</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}
