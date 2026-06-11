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

type Orientation = "horizontal" | "vertical";

// Per-show video shape. "horizontal" keeps the standard landscape player;
// "vertical" switches the watch page to the portrait/TikTok-style player on
// mobile-width viewports. Mirrors StatusSelect's hidden-input pattern so the
// uncontrolled <form> still submits the value via FormData.
export function OrientationSelect({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue: Orientation;
}) {
  const t = useAdminT();
  const [value, setValue] = useState<Orientation>(defaultValue);
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Select value={value} onValueChange={(v) => setValue(v as Orientation)}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="horizontal">
            {t.orientationSelect.horizontal}
          </SelectItem>
          <SelectItem value="vertical">
            {t.orientationSelect.vertical}
          </SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}
