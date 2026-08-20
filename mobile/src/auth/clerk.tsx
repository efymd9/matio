import { ClerkProvider, useAuth } from "@clerk/expo";
import * as SecureStore from "expo-secure-store";
import { useEffect, type ReactNode } from "react";
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

// Auth state that works whether or not ClerkProvider is mounted, so screens
// don't each need to handle the unconfigured case.
export function useOptionalAuth(): { isLoaded: boolean; isSignedIn: boolean } {
  if (!CLERK_PUBLISHABLE_KEY) {
    return { isLoaded: true, isSignedIn: false };
  }
  // Safe: CLERK_PUBLISHABLE_KEY is a module constant, so this branch is stable
  // for the process lifetime and the hook order never changes between renders.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { isLoaded, isSignedIn } = useAuth();
  return { isLoaded, isSignedIn: isSignedIn === true };
}
