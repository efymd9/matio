import { ClerkProvider, useAuth, useClerk, type TokenCache } from "@clerk/expo";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { setAuthTokenProvider } from "@/api/client";
import { keychainOptions } from "@/keychain";

// Clerk wiring for the app, against the SAME production Clerk instance as the
// web app — one user pool, no second identity system. Sign-in is passwordless
// email-code, which is already the canonical credential for accounts created by
// the web's guest-checkout flow.

export const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

// Clerk persists the client JWT here. SecureStore (keychain / EncryptedSharedPreferences)
// rather than AsyncStorage: this is a bearer credential.
//
// Hand-rolled rather than @clerk/expo's own `tokenCache`, which deletes the
// item when a read fails — and a read fails for a transient reason (a locked
// phone, a keychain hiccup), so the stock cache would sign the viewer out for
// good over a moment's unavailability. Here a failed read is only "no JWT
// this time".
//
// Keychain class AFTER_FIRST_UNLOCK (../keychain.ts): Clerk reads this JWT
// before every request it makes, and it keeps making them behind a locked
// screen — the hourly member-token refresh and the next-episode prefetch of a
// background or PiP episode. Under the default class the read fails a minute
// after the lock, those requests go out anonymous and the episode walls.
//
// A save deletes before it writes: a keychain update keeps the item's
// original class, so a plain overwrite would leave a JWT written by an older
// build WHEN_UNLOCKED forever; delete + add re-creates it with the class
// above. That opens a moment with no item at all — and a read landing in it
// would send Clerk a request with no client JWT, which Clerk answers with a
// brand-new, signed-out client. So every operation on a key runs after the
// one before it: a read waits for a save in flight to finish.
const queues = new Map<string, Promise<unknown>>();

function inTurn<T>(key: string, op: () => Promise<T>): Promise<T> {
  const turn = (queues.get(key) ?? Promise.resolve()).then(op);
  const settled = turn.catch(() => undefined);
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return turn;
}

const tokenCache: TokenCache = {
  async getToken(key: string) {
    try {
      return await inTurn(key, () => SecureStore.getItemAsync(key, keychainOptions()));
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      await inTurn(key, async () => {
        await SecureStore.deleteItemAsync(key, keychainOptions());
        await SecureStore.setItemAsync(key, value, keychainOptions());
      });
    } catch {
      // A failed cache write costs the user a re-login, nothing more.
    }
  },
  // Clerk calls this when the stored JWT has to go (a native sign-out, a
  // changed publishable key). Without it the item outlived both.
  async clearToken(key: string) {
    try {
      await inTurn(key, () => SecureStore.deleteItemAsync(key, keychainOptions()));
    } catch {
      // A JWT left behind is overwritten by the next one Clerk hands back.
    }
  },
};

// Hands Clerk's getToken to the plain fetch client, which can't use hooks.
//
// A Clerk whose load failed (#251/#253, no network at launch, an outage) never
// produces a session, but its getToken() waits for a load that is not coming —
// so every request would sit out the client's 3s pre-flight deadline for an
// answer that is already known: nobody is signed in. `clerk.status` is a live
// getter, read at call time.
function AuthBridge({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const clerk = useClerk();

  useEffect(() => {
    setAuthTokenProvider(() => (clerk.status === "error" ? Promise.resolve(null) : getToken()));
    return () => setAuthTokenProvider(null);
  }, [clerk, getToken]);

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
