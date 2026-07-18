Server component — inline SVG tile-grid choropleth, no client JS, no new deps.

```tsx
import { WorldMap } from "@/components/admin/world-map";

// data: iso2 (upper-case) -> value. Missing/zero countries render muted.
<WorldMap
  title="Signups by country"
  data={{ US: 128, MX: 41, ES: 33, AR: 12, BR: 9 }}
  formatValue={(n) => `${n} signups`}   // optional, default: n.toLocaleString()
  emptyLabel="No signups in this range yet"  // shown when every value is 0
/>
```
