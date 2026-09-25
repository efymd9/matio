import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./client";

// Minimal fetch-state hook. Deliberately not a data-library dependency: the app
// has three read endpoints today, and the cache/retry/invalidation surface a
// library brings can be adopted later if the screen count justifies it.

export type AsyncState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: null; error: ApiError };

export function useAsync<T>(fetcher: () => Promise<T>, deps: readonly unknown[]) {
  const [state, setState] = useState<AsyncState<T>>({
    status: "loading",
    data: null,
    error: null,
  });

  // Guards against a resolved response from a previous slug landing after the
  // user has already navigated on, which would render the wrong show.
  const generation = useRef(0);

  const run = useCallback(() => {
    const mine = ++generation.current;
    setState({ status: "loading", data: null, error: null });
    fetcher()
      .then((data) => {
        if (generation.current !== mine) return;
        setState({ status: "ready", data, error: null });
      })
      .catch((err: unknown) => {
        if (generation.current !== mine) return;
        const error =
          err instanceof ApiError
            ? err
            : new ApiError("server_error", "Something went wrong.", 0);
        setState({ status: "error", data: null, error });
      });
    // fetcher is recreated per render by callers; deps is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(run, [run]);

  // A silent refresh: what is on screen stays, and only a success replaces
  // it — no spinner, no remounted list, and a failure changes nothing
  // (`retry` is the loud one: back to loading). Any run() that starts after
  // it — a retry, new deps — supersedes it, and a first load still in
  // flight is left to finish on its own.
  const reload = useCallback(() => {
    const base = generation.current;
    fetcher().then(
      (data) => {
        if (generation.current !== base) return;
        setState((prev) => (prev.status === "loading" ? prev : { status: "ready", data, error: null }));
      },
      () => {
        // Keep what the viewer has.
      },
    );
    // Same trigger as run().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, retry: run, reload };
}
