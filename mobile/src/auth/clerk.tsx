import { ClerkProvider, useAuth, useClerk } from "@clerk/expo";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { setAuthTokenProvider } from "@/api/client";

// Clerk wiring for the app, against the SAME production Clerk instance as the
// web app — one user pool, no second identity system. Sign-in is passwordless
// email-code, which is already the canonical credential for accounts created by
// the web's guest-checkout flow.

export const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

// Clerk persists the session JWT here. SecureStore (keychain / EncryptedSharedPreferences)
// rather than AsyncStorage: this is a bearer credential.
const tokenCache = {
  async getToken(key: string) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      // A failed cache write costs the user a re-login, nothing more.
    }
  },
};

// Hands Clerk's getToken to the plain fetch client, which can't use hooks.
function AuthBridge({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();

  useEffect(() => {
    setAuthTokenProvider(() => getToken());
    return () => setAuthTokenProvider(null);
  }, [getToken]);

  return children;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Without a key, run signed-out rather than crashing. ClerkProvider throws on
  // a missing publishableKey, which would make a misconfigured build a blank
  // screen instead of a browsable catalog — and the whole catalog is readable
  // signed-out anyway.
  if (!CLERK_PUBLISHABLE_KEY) {
    if (__DEV__) {
      console.warn(
        "[matio] EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is unset — running signed-out. " +
          "Sign-in and member episodes will be unavailable.",
      );
    }
    return children;
  }

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <AuthBridge>{children}</AuthBridge>
    </ClerkProvider>
  );
}

// How long a screen waits for Clerk before it stops pretending (#253). On a
// working network Clerk answers in well under a second; eight seconds without
// an answer is a load that is not going to finish, not a slow one.
export const AUTH_STALL_TIMEOUT_MS = 8_000;

export type OptionalAuth = {
  isLoaded: boolean;
  isSignedIn: boolean;
  // Clerk was asked to load and will not answer: it reported an error, or
  // AUTH_STALL_TIMEOUT_MS passed with isLoaded still false. Never true once
  // isLoaded is — a screen branches on `!isLoaded && stalled`.
  stalled: boolean;
  // Ask Clerk to load again and start a fresh wait. Safe to call at any time;
  // a no-op without a key.
  retry: () => void;
};

const UNCONFIGURED: OptionalAuth = {
  isLoaded: true,
  isSignedIn: false,
  stalled: false,
  retry: () => {},
};

// Auth state that works whether or not ClerkProvider is mounted, so screens
// don't each need to handle the unconfigured case.
export function useOptionalAuth(): OptionalAuth {
  if (!CLERK_PUBLISHABLE_KEY) return UNCONFIGURED;
  // Safe: CLERK_PUBLISHABLE_KEY is a module constant, so this branch is stable
  // for the process lifetime and the hook order never changes between renders.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useClerkAuth();
}

// @clerk/react's provider keeps `useAuth().isLoaded` false for as long as
// clerk-js has not loaded — and when its load() REJECTS (the production
// instance answering 400 native_api_disabled, #251; no network; an outage)
// nothing ever flips it, so a screen gated on isLoaded alone spins forever.
// That was the Account tab of 0.1.0 (5).
//
// Two signals, whichever comes first:
//   - Clerk's own status. `useClerk().status` is "error" once load() rejected
//     (IsomorphicClerk emits it from the catch), and the provider re-renders
//     every consumer on the change. That is the fast path — the 400 lands in
//     under a second.
//   - the timeout, for a load that neither resolves nor rejects (a request
//     hanging on a dead network).
//
// Each retry is an attempt of its own: the timer re-arms, and the status
// GETTER is trusted only for the first attempt — Clerk never re-emits
// "loading" on a reload, so after a retry the retained value is still the
// previous attempt's "error"; a failed retry is caught by the status
// LISTENER instead (the catch emits "error" again) or, failing that, by the
// timer.
function useClerkAuth(): OptionalAuth {
  const { isLoaded, isSignedIn } = useAuth();
  const clerk = useClerk();
  const [attempt, setAttempt] = useState(0);
  const [failedAttempt, setFailedAttempt] = useState<number | null>(null);

  useEffect(() => {
    if (isLoaded) return;
    const fail = () => setFailedAttempt(attempt);
    const onStatus = (status: string) => {
      if (status === "error") fail();
    };
    clerk.on("status", onStatus);
    const timer = setTimeout(fail, AUTH_STALL_TIMEOUT_MS);
    return () => {
      clerk.off("status", onStatus);
      clearTimeout(timer);
    };
  }, [clerk, isLoaded, attempt]);

  const retry = useCallback(() => {
    // @clerk/react exposes no public "load again". The provider's own headless
    // load path is IsomorphicClerk.loadHeadlessClerk() (what its constructor
    // runs — checked in @clerk/react 6.16.0 dist): with clerk-js not loaded it
    // calls clerk.load() once more with the provider's options and emits
    // status / replays the queued listeners exactly like a first load. A
    // provider remount would NOT do this — getOrCreateInstance() runs in the
    // new provider's render, before the old one's cleanup clears the
    // singleton, so a remount is handed the same stuck instance. Internal
    // API, hence feature-detected: without it a retry is only a fresh wait.
    const reload = (clerk as unknown as { loadHeadlessClerk?: () => void }).loadHeadlessClerk;
    if (typeof reload === "function") reload.call(clerk);
    setAttempt((n) => n + 1);
  }, [clerk]);

  const failed = failedAttempt === attempt || (attempt === 0 && clerk.status === "error");

  return {
    isLoaded,
    isSignedIn: isSignedIn === true,
    stalled: !isLoaded && failed,
    retry,
  };
}
