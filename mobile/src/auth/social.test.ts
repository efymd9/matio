import type { ExpoConfig } from "expo/config";
import { describe, expect, it } from "vitest";
import appConfig, { googleIosUrlScheme, googleSignInExtra } from "../../app.config";
import appJson from "../../app.json";
import {
  classifySocialResult,
  googleSignInConfigured,
  socialFailure,
  socialFailureCode,
  socialProviders,
} from "./social";

// #277 — the rules behind the Apple / Google buttons under the email form,
// and the app config that carries Google's client ids into a build. Pure:
// what the component does with the answers is in sign-in-form.test.tsx.

const BOTH = { apple: true, google: true };
const ios = { os: "ios", lever: BOTH, appleAvailable: true, googleConfigured: true };

describe("socialProviders — which buttons show, in which order", () => {
  it("shows nothing when the server says nothing, or says off", () => {
    expect(socialProviders({ ...ios, lever: undefined })).toEqual([]);
    expect(socialProviders({ ...ios, lever: { apple: false, google: false } })).toEqual([]);
  });

  it("shows nothing outside iOS — Android's flows are not built", () => {
    expect(socialProviders({ ...ios, os: "android" })).toEqual([]);
    expect(socialProviders({ ...ios, os: "web" })).toEqual([]);
  });

  it("`apple` alone is the Apple button alone", () => {
    expect(socialProviders({ ...ios, lever: { apple: true, google: false } })).toEqual(["apple"]);
  });

  it("`apple,google` with the client ids is both, Apple first", () => {
    expect(socialProviders(ios)).toEqual(["apple", "google"]);
  });

  it("no Google button in a build without the client ids", () => {
    expect(socialProviders({ ...ios, googleConfigured: false })).toEqual(["apple"]);
  });

  it("App Store 4.8: no Google on iOS without Apple — not by the lever, not on a device without Apple", () => {
    expect(socialProviders({ ...ios, lever: { apple: false, google: true } })).toEqual([]);
    expect(socialProviders({ ...ios, appleAvailable: false })).toEqual([]);
  });

  it("over every input on iOS: Google implies Apple, and Apple always comes first", () => {
    const bools = [false, true];
    for (const apple of bools)
      for (const google of bools)
        for (const appleAvailable of bools)
          for (const googleConfigured of bools) {
            const shown = socialProviders({
              os: "ios",
              lever: { apple, google },
              appleAvailable,
              googleConfigured,
            });
            if (shown.includes("google")) expect(shown).toEqual(["apple", "google"]);
            if (shown.length > 0) expect(shown[0]).toBe("apple");
            // The lever only narrows: nothing it did not name ever shows.
            if (!apple) expect(shown).not.toContain("apple");
            if (!google) expect(shown).not.toContain("google");
          }
  });
});

describe("googleSignInConfigured — both client ids, or no Google", () => {
  const WEB = "EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID";
  const IOS = "EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID";

  it("needs the web AND the iOS id, neither blank", () => {
    expect(googleSignInConfigured({ [WEB]: "w.apps.googleusercontent.com", [IOS]: "i.apps.googleusercontent.com" })).toBe(true);
    expect(googleSignInConfigured({ [WEB]: "w.apps.googleusercontent.com" })).toBe(false);
    expect(googleSignInConfigured({ [IOS]: "i.apps.googleusercontent.com" })).toBe(false);
    expect(googleSignInConfigured({ [WEB]: " ", [IOS]: "i.apps.googleusercontent.com" })).toBe(false);
    expect(googleSignInConfigured({ [WEB]: 1, [IOS]: true })).toBe(false);
    expect(googleSignInConfigured(undefined)).toBe(false);
    expect(googleSignInConfigured(null)).toBe(false);
  });
});

describe("classifySocialResult — what a finished flow meant", () => {
  const before = { signInId: "sia_email", signUpId: "sua_email" };

  it("a session is a sign-in, whichever resource made it", () => {
    expect(classifySocialResult({ createdSessionId: "sess_1", before })).toBe("signedIn");
  });

  it("a closed sheet touches nothing — cancelled, even beside the email form's half-made sign-up", () => {
    // The email form's own sign-up waits in missing_requirements until its
    // code is verified; the hook hands it back unchanged on a cancel.
    expect(
      classifySocialResult({
        createdSessionId: null,
        before,
        signIn: { id: "sia_email", status: "needs_first_factor" },
        signUp: { id: "sua_email", status: "missing_requirements" },
      }),
    ).toBe("cancelled");
    expect(classifySocialResult({ createdSessionId: null, before: { signInId: undefined, signUpId: undefined } })).toBe(
      "cancelled",
    );
  });

  it("a new sign-up still missing a field (an Apple ID that shared no email) is incomplete", () => {
    expect(
      classifySocialResult({
        createdSessionId: null,
        before,
        signUp: { id: "sua_apple", status: "missing_requirements" },
      }),
    ).toBe("incomplete");
  });

  it("anything else that moved without a session is a failure, never silence", () => {
    expect(
      classifySocialResult({
        createdSessionId: null,
        before,
        signIn: { id: "sia_google", status: "needs_second_factor" },
      }),
    ).toBe("failed");
    expect(
      classifySocialResult({
        createdSessionId: null,
        before,
        signUp: { id: "sua_google", status: "abandoned" },
      }),
    ).toBe("failed");
  });
});

describe("socialFailure — a thrown failure, by its code alone", () => {
  it("sorts Clerk's network and rate-limit codes, and everything else as other", () => {
    expect(socialFailure({ code: "network_error", message: "Clerk: Network request failed" })).toBe("network");
    expect(
      socialFailure({ code: "api_response_error", errors: [{ code: "too_many_requests", message: "Too many" }] }),
    ).toBe("rate_limited");
    expect(socialFailure({ code: "ERR_REQUEST_FAILED", message: "The authorization attempt failed" })).toBe("other");
    expect(socialFailure({ code: "GOOGLE_SIGN_IN_ERROR", message: "..." })).toBe("other");
    expect(socialFailure(new Error("boom"))).toBe("other");
    expect(socialFailure("boom")).toBe("other");
    expect(socialFailure(null)).toBe("other");
  });

  it("reads the code and never the message — a message can carry the provider's account data", () => {
    expect(socialFailureCode({ message: "person@example.com is already linked" })).toBeUndefined();
    expect(socialFailureCode({ errors: [{ code: "external_account_exists", message: "person@example.com" }] })).toBe(
      "external_account_exists",
    );
  });
});

describe("app.config.ts — Google's ids from the build's environment into `extra`", () => {
  const IOS_ID = "123-abc.apps.googleusercontent.com";
  const WEB_ID = "456-def.apps.googleusercontent.com";

  it("derives the reversed iOS client id Google Sign-In needs as a URL scheme", () => {
    expect(googleIosUrlScheme(IOS_ID)).toBe("com.googleusercontent.apps.123-abc");
    expect(googleIosUrlScheme(` ${IOS_ID} `)).toBe("com.googleusercontent.apps.123-abc");
    expect(googleIosUrlScheme("not-a-client-id")).toBeUndefined();
    expect(googleIosUrlScheme(".apps.googleusercontent.com")).toBeUndefined();
  });

  it("carries only what is set — an unconfigured build has no empty ids", () => {
    expect(googleSignInExtra({})).toEqual({});
    expect(googleSignInExtra({ EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID: "  " })).toEqual({});
    expect(
      googleSignInExtra({
        EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID: WEB_ID,
        EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID: IOS_ID,
      }),
    ).toEqual({
      EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID: WEB_ID,
      EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID: IOS_ID,
      EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME: "com.googleusercontent.apps.123-abc",
    });
  });

  it("an explicit URL scheme wins over the derived one", () => {
    expect(
      googleSignInExtra({
        EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID: IOS_ID,
        EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME: "com.googleusercontent.apps.custom",
      }).EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME,
    ).toBe("com.googleusercontent.apps.custom");
  });

  it("keeps app.json whole and only adds to `extra`", () => {
    const config = appConfig({
      // app.json as Expo reads it (JSON widens its string unions).
      config: appJson.expo as Partial<ExpoConfig>,
      projectRoot: ".",
      staticConfigPath: "app.json",
      packageJsonPath: "package.json",
    });
    expect(config.name).toBe("Matio");
    expect(config.ios?.usesAppleSignIn).toBe(true);
    expect(config.plugins).toEqual(appJson.expo.plugins);
    expect(config.extra?.eas).toEqual(appJson.expo.extra.eas);
  });
});
