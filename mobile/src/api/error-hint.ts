import type { AppT } from "@/i18n/locale";
import { API_BASE_URL, type ApiError } from "./client";

// The hint line under a load or playback failure, written for the viewer in
// their language: a server the phone could not reach (or that timed out)
// reads as a connection problem, anything else as the screen's own generic
// line. Never the ApiError's English message, a server's sentence («Your
// preview has ended.») or the API's address — those still help whoever runs
// a dev build, so a dev build appends them.
export function errorHint(
  t: AppT,
  error: ApiError,
  fallback: string = t.seriesEndOverlay.errorGeneric,
): string {
  const hint = error.code === "network" ? t.app.account.stalledBody : fallback;
  return __DEV__ ? `${hint}\n${error.message}\n${API_BASE_URL}` : hint;
}
