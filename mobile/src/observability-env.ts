import Constants from "expo-constants";
import { APP_BUILD } from "@/build";
import type { ObservabilityEnv } from "@/observability";

// What the error tracker starts with (#317). A module of its own so that
// ./observability.ts — which every route's crash screen imports — stays free
// of native modules: only the root layout reads the environment.

/**
 * Read the one way Expo can inline it: `EXPO_PUBLIC_*` is replaced at BUNDLE
 * time, and only on literal member access — handing `process.env` around
 * gives the bundle an empty object and the DSN silently vanishes (the web's
 * #81, in the app's spelling).
 */
export function readObservabilityEnv(): ObservabilityEnv {
  return {
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    appEnv: process.env.EXPO_PUBLIC_APP_ENV,
    isDev: __DEV__,
    version: Constants.expoConfig?.version,
    build: APP_BUILD,
  };
}
