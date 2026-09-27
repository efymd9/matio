import * as SecureStore from "expo-secure-store";

// Keychain options for the two items the app reads while it may be running
// behind a locked screen: Clerk's client JWT (auth/clerk.tsx) and the device
// id (api/device.ts). Background audio and PiP keep playing after the lock,
// and the hourly token refresh, the next-episode prefetch and the progress
// saves all need both — under the keychain's default, WHEN_UNLOCKED, they
// become unreadable about a minute after the screen locks.
//
// AFTER_FIRST_UNLOCK: readable once the phone has been unlocked once since
// boot (the stock @clerk/expo token cache makes the same choice). iOS only;
// Android's store has no such class and ignores the option.
//
// A function rather than a module constant: the constant comes from the native
// module, and reading it only when the keychain is actually touched keeps the
// modules that import this loadable wherever the keychain is not.
export function keychainOptions(): SecureStore.SecureStoreOptions {
  return { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
}
