import { createContext, use, useCallback, useEffect, useRef, type ReactNode } from "react";
import { AppState } from "react-native";
import type { CatalogResponse } from "@/shared/api-types";
import { api } from "./client";
import { useAsync } from "./use-async";

// The catalog, loaded once for Home and Browse together — they used to fetch
// it separately and could disagree — and kept fresh while the app stays in
// memory. TestFlight testers keep it open for days: new shows, episode counts
// and artwork used to wait for a force-quit, and a launch that met an empty
// catalog stayed on «The catalog is being curated» for good. So on every
// return to the foreground, a catalog older than CATALOG_STALE_MS (or one
// that never loaded) is reloaded SILENTLY: what is on screen stays until the
// new answer lands, and a failure changes nothing.
export const CATALOG_STALE_MS = 5 * 60_000;

type Catalog = ReturnType<typeof useAsync<CatalogResponse>>;

const CatalogContext = createContext<Catalog | null>(null);

export function CatalogProvider({ children }: { children: ReactNode }) {
  const catalog = useAsync(useCallback(() => api.catalog(), []), []);
  const { data, reload } = catalog;

  // When the catalog on screen arrived; 0 until one has.
  const loadedAt = useRef(0);
  useEffect(() => {
    if (data) loadedAt.current = Date.now();
  }, [data]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && Date.now() - loadedAt.current >= CATALOG_STALE_MS) reload();
    });
    return () => subscription.remove();
  }, [reload]);

  return <CatalogContext value={catalog}>{children}</CatalogContext>;
}

export function useCatalog(): Catalog {
  const catalog = use(CatalogContext);
  if (!catalog) {
    throw new Error("useCatalog() used outside <CatalogProvider>");
  }
  return catalog;
}
