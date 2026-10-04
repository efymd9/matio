/** @vitest-environment jsdom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #292 — the signed-in Account tab:
//   item 2: no «Manage subscription» row. It opened matio.tv signed out in a
//           browser with its own cookies, and offered free members a
//           subscription they do not have; it returns when /v1 carries the
//           subscription status (registry).
//   item 8: «Sign out» asks first — getting back in costs an email round
//           trip — and a sign-out that fails (offline) says so.
// #309 — «Delete account» (App Store 5.1.1(v)): two confirmations, then the
//   server; only its success signs out and goes Home.
// The tab is rendered for real in jsdom on react-native-web; Clerk, the
// router and the system Alert are faked. (Not under app/ — a test file there
// would become an expo-router route.)

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

type AlertButton = { text: string; style?: string; onPress?: () => void };
const alerts = vi.hoisted(() => ({
  calls: [] as Array<{ title: string; message?: string; buttons?: AlertButton[] }>,
}));
vi.mock("react-native", async (importOriginal) => {
  const rn = await importOriginal<typeof import("react-native")>();
  return {
    ...rn,
    Alert: {
      alert: (title: string, message?: string, buttons?: AlertButton[]) => {
        alerts.calls.push({ title, message, buttons });
      },
    },
  };
});

// Every step of the deletion, in the order it happened: the request, the
// local sign-out, the navigation.
const h = vi.hoisted(() => ({
  steps: [] as string[],
  signedIn: true,
}));
const signOut = vi.fn(async () => {
  h.steps.push("signOut");
});
// The client's own hook (#398): a request carrying the session's Bearer is
// about to leave. A case whose request never went out (no token, an anonymous
// 401) simply does not call it.
type DeleteOptions = { onSentWithToken?: () => void };
const deleteAccount = vi.fn(async (options?: DeleteOptions) => {
  h.steps.push("api.deleteAccount");
  options?.onSentWithToken?.();
  return { ok: true as const };
});
// Clerk's word on the session, asked only after a failed deletion (#336):
// a live session unless a case says otherwise.
const getToken = vi.fn(async (_options?: { skipCache?: boolean }): Promise<string | null> => {
  h.steps.push("getToken");
  return "jwt_dummy";
});
const router = {
  push: vi.fn(),
  replace: vi.fn((href: string) => {
    h.steps.push(`replace ${href}`);
  }),
};
vi.mock("@clerk/expo", () => ({
  useUser: () => ({ user: { primaryEmailAddress: { emailAddress: "member@example.com" } } }),
  useClerk: () => ({ signOut }),
  useAuth: () => ({ getToken }),
}));
vi.mock("@/auth/clerk", () => ({
  CLERK_PUBLISHABLE_KEY: "pk_test_dummy",
  useOptionalAuth: () => ({
    isLoaded: true,
    isSignedIn: h.signedIn,
    stalled: false,
    retry: () => undefined,
  }),
}));
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    api: { ...actual.api, deleteAccount: (options?: DeleteOptions) => deleteAccount(options) },
  };
});
// The signed-out tab's email → code form has its own suite.
vi.mock("@/components/sign-in-form", () => ({ SignInForm: () => null }));
// Paid mode, as live since 2026-09-09 — the mode the row used to show in.
vi.mock("@/api/config-context", () => ({
  useConfig: () => ({
    flags: { paymentsEnabled: true, downloadsEnabled: false, castEnabled: false },
    signupGate: { mode: "tiers" },
    urls: { web: "https://matio.tv" },
  }),
}));
vi.mock("expo-router", () => ({ useRouter: () => router }));
vi.mock("@/watch/use-continue-watching", () => ({
  useContinueWatching: () => ({ items: [], reload: async () => undefined }),
}));
vi.mock("@/components/glass-tab-bar", () => ({ useTabBarClearance: () => 0 }));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000000",
}));
vi.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: ReactNode }) => children ?? null,
}));
vi.mock("expo-glass-effect", () => ({
  GlassView: ({ children }: { children?: ReactNode }) => children ?? null,
  isLiquidGlassAvailable: () => false,
}));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("expo-symbols", () => ({ SymbolView: () => null }));

import { ApiError } from "@/api/client";
import AccountScreen from "@/app/(tabs)/account";
import { LocaleProvider } from "@/i18n/locale";
import { AA_TEXT, contrastRatio, paintedBackground, parseColor } from "@/testing/contrast";
import { colors } from "@/theme";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const text = () => container.textContent ?? "";

function render(locale: "en" | "es" = "en") {
  act(() =>
    root.render(
      <LocaleProvider initial={locale}>
        <AccountScreen />
      </LocaleProvider>,
    ),
  );
}

function press(label: string) {
  const node = Array.from(container.querySelectorAll("*")).find(
    (el) => el.children.length === 0 && el.textContent === label,
  );
  if (!node) throw new Error(`no element labelled ${label}`);
  act(() => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

// A button of the last dialog, pressed as the system would.
async function choose(label: string) {
  const button = alerts.calls.at(-1)?.buttons?.find((b) => b.text === label);
  if (!button) throw new Error(`no dialog button ${label}`);
  await act(async () => {
    button.onPress?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  alerts.calls.length = 0;
  h.steps.length = 0;
  h.signedIn = true;
  signOut.mockReset().mockImplementation(async () => {
    h.steps.push("signOut");
  });
  deleteAccount.mockReset().mockImplementation(async (options?: DeleteOptions) => {
    h.steps.push("api.deleteAccount");
    options?.onSentWithToken?.();
    return { ok: true as const };
  });
  getToken.mockReset().mockImplementation(async () => {
    h.steps.push("getToken");
    return "jwt_dummy";
  });
  router.replace.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Account tab — «Manage subscription» (#292 item 2)", () => {
  it("is not offered while /v1 cannot say who is a subscriber", () => {
    render();

    expect(text()).toContain("member@example.com");
    expect(text()).not.toContain("Manage subscription");
    expect(text()).not.toContain("matio.tv");
  });
});

describe("Account tab — «Sign out» asks first (#292 item 8)", () => {
  it("a tap opens the system confirmation and signs nobody out by itself", () => {
    render();
    press("Sign out");

    expect(alerts.calls).toHaveLength(1);
    const [dialog] = alerts.calls;
    expect(dialog.title).toBe("Sign out?");
    expect(dialog.message).toBe("To sign back in, we'll email you a code.");
    expect(dialog.buttons?.map((b) => [b.text, b.style])).toEqual([
      ["Cancel", "cancel"],
      ["Sign out", "destructive"],
    ]);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("«Cancel» keeps the session", async () => {
    render();
    press("Sign out");
    await choose("Cancel");

    expect(signOut).not.toHaveBeenCalled();
    expect(alerts.calls).toHaveLength(1);
  });

  it("confirming signs out", async () => {
    render();
    press("Sign out");
    await choose("Sign out");

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(alerts.calls).toHaveLength(1);
  });

  it("a sign-out that fails (offline) is said, not swallowed", async () => {
    signOut.mockRejectedValueOnce(new Error("Network request failed"));
    render();
    press("Sign out");
    await choose("Sign out");

    expect(alerts.calls).toHaveLength(2);
    expect(alerts.calls[1].title).toBe("Couldn't sign out");
    expect(alerts.calls[1].message).toBe("Check your connection and try again.");
    expect(JSON.stringify(alerts.calls)).not.toContain("Network request failed");
  });

  it("asks in Spanish too", () => {
    render("es");
    press("Cerrar sesión");

    expect(alerts.calls[0].title).toBe("¿Cerrar sesión?");
    expect(alerts.calls[0].buttons?.map((b) => b.text)).toEqual(["Cancelar", "Cerrar sesión"]);
  });
});

describe("Account tab — «Delete account» (#309)", () => {
  const deleteRow = () => container.querySelector('[aria-label="Delete account"]');

  it("is a labelled button under «Sign out» for a signed-in viewer", () => {
    render();

    const row = deleteRow();
    expect(row).not.toBeNull();
    expect(row?.getAttribute("role")).toBe("button");
    expect(text().indexOf("Sign out")).toBeLessThan(text().indexOf("Delete account"));
  });

  it("is not offered to a signed-out viewer — there is no account to delete", () => {
    h.signedIn = false;
    render();

    expect(deleteRow()).toBeNull();
    expect(text()).not.toContain("Delete account");
  });

  it("a tap asks first — what is erased and that a subscription stops at the end of its period", () => {
    render();
    press("Delete account");

    expect(alerts.calls).toHaveLength(1);
    const [dialog] = alerts.calls;
    expect(dialog.title).toBe("Delete your account?");
    expect(dialog.message).toContain("cancelled at the end of the current billing period");
    expect(dialog.message).toContain("won't be charged again");
    expect(dialog.buttons?.map((b) => [b.text, b.style])).toEqual([
      ["Cancel", "cancel"],
      ["Delete account", "destructive"],
    ]);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("«Cancel» on the first question does nothing", async () => {
    render();
    press("Delete account");
    await choose("Cancel");

    expect(alerts.calls).toHaveLength(1);
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("the second question says it is permanent — and «Cancel» there does nothing either", async () => {
    render();
    press("Delete account");
    await choose("Delete account");

    expect(alerts.calls).toHaveLength(2);
    const final = alerts.calls[1];
    expect(final.title).toBe("This can't be undone");
    expect(final.message).toContain("deleted for good");
    expect(final.buttons?.map((b) => [b.text, b.style])).toEqual([
      ["Cancel", "cancel"],
      ["Delete permanently", "destructive"],
    ]);

    await choose("Cancel");
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("both confirmations: the server deletes, THEN the app signs out, THEN it goes Home", async () => {
    render();
    press("Delete account");
    await choose("Delete account");
    await choose("Delete permanently");

    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(h.steps).toEqual(["api.deleteAccount", "signOut", "replace /"]);
    expect(alerts.calls).toHaveLength(2); // no failure dialog
  });

  it("a deletion that fails says so and keeps the session — no sign-out, no navigation", async () => {
    deleteAccount.mockRejectedValueOnce(
      Object.assign(new Error("Request failed (500)."), { code: "server_error", status: 500 }),
    );
    render();
    press("Delete account");
    await choose("Delete account");
    await choose("Delete permanently");

    expect(alerts.calls).toHaveLength(3);
    expect(alerts.calls[2].title).toBe("Couldn't delete your account");
    expect(alerts.calls[2].message).toBe("Check your connection and try again.");
    expect(JSON.stringify(alerts.calls)).not.toContain("Request failed");
    expect(signOut).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    // …and the row can simply be tapped again: the server's halves are idempotent.
    press("Delete account");
    expect(alerts.calls).toHaveLength(4);
  });

  it("while the request is out the row says so and cannot start a second deletion", async () => {
    let finish: (value: { ok: true }) => void = () => undefined;
    deleteAccount.mockImplementationOnce(
      () => new Promise<{ ok: true }>((resolve) => (finish = resolve)),
    );
    render();
    press("Delete account");
    await choose("Delete account");
    await choose("Delete permanently");

    expect(text()).toContain("Please wait…");
    expect(deleteRow()).toBeNull(); // no longer a button
    await act(async () => {
      finish({ ok: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/");
  });

  it("a local sign-out that fails after the account is gone still goes Home, without a failure dialog", async () => {
    signOut.mockRejectedValueOnce(new Error("Network request failed"));
    render();
    press("Delete account");
    await choose("Delete account");
    await choose("Delete permanently");

    expect(router.replace).toHaveBeenCalledWith("/");
    expect(alerts.calls).toHaveLength(2);
  });

  it("asks in Spanish too", async () => {
    render("es");
    press("Eliminar cuenta");

    expect(alerts.calls[0].title).toBe("¿Eliminar tu cuenta?");
    expect(alerts.calls[0].message).toContain("se cancelará al final del periodo");
    expect(alerts.calls[0].buttons?.map((b) => b.text)).toEqual(["Cancelar", "Eliminar cuenta"]);
    await choose("Eliminar cuenta");
    expect(alerts.calls[1].title).toBe("Esta acción no se puede deshacer");
    expect(alerts.calls[1].buttons?.map((b) => b.text)).toEqual([
      "Cancelar",
      "Eliminar definitivamente",
    ]);
  });
});

// #336 (d) — a failed request is not proof the deletion failed: the server may
// have finished while its answer was lost (the 45s deadline, a dropped
// connection), or a retry went out with no token because Clerk had no session
// left (401). The tab asks Clerk about the session before it says anything.
describe("Account tab — a failed deletion asks Clerk about the session first (#336)", () => {
  const timedOut = () => new ApiError("network", "The request timed out.", 0);

  async function confirmDeletion() {
    render();
    press("Delete account");
    await choose("Delete account");
    await choose("Delete permanently");
  }

  function expectHonestFailure() {
    expect(alerts.calls).toHaveLength(3);
    expect(alerts.calls[2].title).toBe("Couldn't delete your account");
    expect(alerts.calls[2].message).toBe("Check your connection and try again.");
    expect(signOut).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  }

  // A request that went out carrying the session, then failed the way `fail`
  // says — what the client does on a timeout or a connection dropped after
  // sending.
  const sentThen = (fail: () => Error) => async (options?: DeleteOptions) => {
    h.steps.push("api.deleteAccount");
    options?.onSentWithToken?.();
    throw fail();
  };

  it("the request went out, then a timeout, and Clerk has no session any more → the account is gone: sign out and go Home, as on success", async () => {
    deleteAccount.mockImplementationOnce(sentThen(timedOut));
    getToken.mockImplementationOnce(async () => {
      h.steps.push("getToken");
      return null;
    });

    await confirmDeletion();

    expect(getToken).toHaveBeenCalledWith({ skipCache: true });
    expect(h.steps).toEqual(["api.deleteAccount", "getToken", "signOut", "replace /"]);
    expect(alerts.calls).toHaveLength(2); // no failure dialog
  });

  it("the request went out, the connection dropped, and Clerk refuses the session itself (401) → gone: sign out and go Home", async () => {
    deleteAccount.mockImplementationOnce(
      sentThen(() => new ApiError("network", "Couldn't reach Matio.", 0)),
    );
    getToken.mockRejectedValueOnce(
      Object.assign(new Error("Unauthorized"), { name: "ClerkAPIResponseError", status: 401 }),
    );

    await confirmDeletion();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/");
    expect(alerts.calls).toHaveLength(2);
  });

  it("a retry that went out with no token (401) after an earlier tap's request was sent → gone: sign out and go Home", async () => {
    // First tap: sent, timed out, the session still alive — the honest failure.
    deleteAccount.mockImplementationOnce(sentThen(timedOut));
    await confirmDeletion();
    expect(alerts.calls.at(-1)?.title).toBe("Couldn't delete your account");
    expect(signOut).not.toHaveBeenCalled();

    // Second tap: the server had finished — Clerk has no session to give, the
    // retry goes out anonymously into a 401.
    deleteAccount.mockRejectedValueOnce(
      new ApiError("unauthorized", "Sign in to delete your account.", 401),
    );
    getToken.mockResolvedValueOnce(null);
    press("Delete account");
    await choose("Delete account");
    await choose("Delete permanently");

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/");
    expect(alerts.calls).toHaveLength(5); // 2 + failure + 2 — nothing after the retry
  });

  it("a timeout while the session is still alive → the honest failure as before, no sign-out", async () => {
    deleteAccount.mockRejectedValueOnce(timedOut());

    await confirmDeletion();

    expect(getToken).toHaveBeenCalledWith({ skipCache: true });
    expectHonestFailure();
  });

  it("Clerk unreachable too (offline — no HTTP status) is not an answer → the honest failure, no sign-out", async () => {
    deleteAccount.mockRejectedValueOnce(timedOut());
    getToken.mockRejectedValueOnce(
      Object.assign(new Error("Network request failed while offline"), {
        name: "ClerkRuntimeError",
        code: "network_error",
      }),
    );

    await confirmDeletion();

    expectHonestFailure();
  });

  it("Clerk failing with another status (5xx) is not an answer either → the honest failure", async () => {
    deleteAccount.mockRejectedValueOnce(timedOut());
    getToken.mockRejectedValueOnce(
      Object.assign(new Error("Service Unavailable"), { name: "ClerkAPIResponseError", status: 503 }),
    );

    await confirmDeletion();

    expectHonestFailure();
  });

  it("Clerk never answering → «Please wait» while it is asked, then the honest failure — silence is not «deleted»", async () => {
    deleteAccount.mockRejectedValueOnce(timedOut());
    getToken.mockImplementationOnce(() => new Promise<string | null>(() => undefined));
    render();
    press("Delete account");
    await choose("Delete account");

    vi.useFakeTimers();
    try {
      const final = alerts.calls.at(-1)?.buttons?.find((b) => b.text === "Delete permanently");
      await act(async () => {
        final?.onPress?.();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(getToken).toHaveBeenCalledTimes(1);
      expect(text()).toContain("Please wait…");
      expect(alerts.calls).toHaveLength(2);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
    } finally {
      vi.useRealTimers();
    }

    expectHonestFailure();
    expect(text()).not.toContain("Please wait…");
  });
});

// #398 — a dead session proves the account is gone only after a deletion
// request that carried the session went out. A session can end on its own —
// revoked from another device, at the end of its lifetime — while this tab is
// still mounted; then nothing that could erase anything was ever sent, and
// the old «gone → sign out + Home» told the viewer their account was deleted
// while it and all its data survived.
describe("Account tab — a session that ended before anything was sent is not a deletion (#398)", () => {
  async function confirmDeletion(locale: "en" | "es" = "en") {
    render(locale);
    press(locale === "en" ? "Delete account" : "Eliminar cuenta");
    await choose(locale === "en" ? "Delete account" : "Eliminar cuenta");
    await choose(locale === "en" ? "Delete permanently" : "Eliminar definitivamente");
  }

  it("refused with a 401 before anything was sent, and Clerk has no session → «your session has ended», signed out, never sent Home as if deleted", async () => {
    // Clerk answered "nobody is signed in" to the client's own lookup, so the
    // request went out with no Bearer — the hook never fired.
    deleteAccount.mockImplementationOnce(async () => {
      h.steps.push("api.deleteAccount");
      throw new ApiError("unauthorized", "Sign in to delete your account.", 401);
    });
    getToken.mockImplementationOnce(async () => {
      h.steps.push("getToken");
      return null;
    });

    await confirmDeletion();

    expect(h.steps).toEqual(["api.deleteAccount", "getToken", "signOut"]);
    expect(router.replace).not.toHaveBeenCalled();
    expect(alerts.calls).toHaveLength(3);
    expect(alerts.calls[2].title).toBe("Your session has ended");
    expect(alerts.calls[2].message).toBe("Your account was not deleted. Sign in again to delete it.");
    expect(JSON.stringify(alerts.calls)).not.toContain("Sign in to delete your account.");
  });

  it("failed before any fetch (Clerk gave no token in time) and Clerk then refuses the session (401) → the same «session has ended»", async () => {
    deleteAccount.mockRejectedValueOnce(
      new ApiError("network", "Couldn't confirm who is signed in.", 0),
    );
    getToken.mockRejectedValueOnce(
      Object.assign(new Error("Unauthorized"), { name: "ClerkAPIResponseError", status: 401 }),
    );

    await confirmDeletion();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    expect(alerts.calls.at(-1)?.title).toBe("Your session has ended");
  });

  it("says it in Spanish too", async () => {
    deleteAccount.mockRejectedValueOnce(
      new ApiError("unauthorized", "Sign in to delete your account.", 401),
    );
    getToken.mockResolvedValueOnce(null);

    await confirmDeletion("es");

    expect(alerts.calls.at(-1)?.title).toBe("Tu sesión ha terminado");
    expect(alerts.calls.at(-1)?.message).toBe(
      "Tu cuenta no se ha eliminado. Vuelve a iniciar sesión para eliminarla.",
    );
  });

  it("a local sign-out that fails there still says so, and leaves the row pressable", async () => {
    deleteAccount.mockRejectedValueOnce(
      new ApiError("unauthorized", "Sign in to delete your account.", 401),
    );
    getToken.mockResolvedValueOnce(null);
    signOut.mockRejectedValueOnce(new Error("Network request failed"));

    await confirmDeletion();

    expect(alerts.calls.at(-1)?.title).toBe("Your session has ended");
    expect(router.replace).not.toHaveBeenCalled();
    expect(text()).not.toContain("Please wait…");
    press("Delete account");
    expect(alerts.calls.at(-1)?.title).toBe("Delete your account?");
  });
});

// #314 — a danger row's label was rust: 3.0:1 on the card, under AA's 4.5.
// It is cream now; the rust moved to a tick in front of it, so the two rows
// still stand apart from the rest of the tab.
describe("Account tab — the danger rows read at AA contrast (#314)", () => {
  it("«Sign out» and «Delete account» are cream on their card, each behind a rust tick", () => {
    render();

    for (const label of ["Sign out", "Delete account"]) {
      const node = Array.from(container.querySelectorAll("*")).find(
        (el) => el.children.length === 0 && el.textContent === label,
      );
      if (!node) throw new Error(`no element labelled ${label}`);
      const { color } = getComputedStyle(node);
      expect(parseColor(color)).toEqual(parseColor(colors.ink));
      const card = paintedBackground(node);
      expect(card).not.toBeNull();
      expect(parseColor(card as string)).toEqual(parseColor(colors.card));
      expect(contrastRatio(color, card as string)).toBeGreaterThanOrEqual(AA_TEXT);

      // The non-text cue, inside the same row.
      const row = node.closest('[role="button"]');
      const tick = row?.querySelector('[data-testid="danger-tick"]');
      expect(tick).not.toBeNull();
      expect(parseColor(getComputedStyle(tick as Element).backgroundColor)).toEqual(
        parseColor(colors.rust),
      );
    }
    // Only the danger rows carry it.
    expect(container.querySelectorAll('[data-testid="danger-tick"]')).toHaveLength(2);
  });
});
