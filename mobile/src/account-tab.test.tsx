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

const signOut = vi.fn(async () => undefined);
vi.mock("@clerk/expo", () => ({
  useUser: () => ({ user: { primaryEmailAddress: { emailAddress: "member@example.com" } } }),
  useClerk: () => ({ signOut }),
}));
vi.mock("@/auth/clerk", () => ({
  CLERK_PUBLISHABLE_KEY: "pk_test_dummy",
  useOptionalAuth: () => ({ isLoaded: true, isSignedIn: true, stalled: false, retry: () => undefined }),
}));
// Paid mode, as live since 2026-09-09 — the mode the row used to show in.
vi.mock("@/api/config-context", () => ({
  useConfig: () => ({
    flags: { paymentsEnabled: true, downloadsEnabled: false, castEnabled: false },
    signupGate: { mode: "tiers" },
    urls: { web: "https://matio.tv" },
  }),
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/watch/use-continue-watching", () => ({ useContinueWatching: () => [] }));
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

import AccountScreen from "@/app/(tabs)/account";
import { LocaleProvider } from "@/i18n/locale";

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
  signOut.mockReset().mockResolvedValue(undefined);
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
