import { createContext, use, useCallback, useEffect, useRef, type ReactNode } from "react";
import { AppState, Linking, StyleSheet, Text, View } from "react-native";
import { APP_BUILD } from "@/build";
import { ErrorState, GoldButton, Loading } from "@/components/ui";
import { useT } from "@/i18n/locale";
import type { AppConfig } from "@/shared/api-types";
import { body, colors, display, SCREEN_PAD, space } from "@/theme";
import { api } from "./client";
import { errorHint } from "./error-hint";
import { useAsync } from "./use-async";

// AppConfig is fetched at launch and read everywhere. It carries the
// server's kill-switches, so nothing that depends on gating should render
// before it resolves — a screen that guesses the gate and is wrong is exactly
// the client/server disagreement the free pivot got bitten by.
//
// And it is kept fresh while the app stays in memory (#301). It used to be
// fetched once per process, so for as long as iOS kept the app alive (days,
// for a tester) a raised minSupportedBuild never reached a running bad
// build, a flipped PAYMENTS_ENABLED / REQUIRE_SIGNUP left this client showing
// other gates than /v1/playback-token enforces, and a launch with no network
// sat on «unreachable» until the viewer tapped Retry. So on every return to
// the foreground a config older than CONFIG_STALE_MS, or one that never
// arrived, is reloaded SILENTLY, the CatalogProvider way: what is on screen
// stays until the new answer lands, and a failure changes nothing. The route
// is DB-free, so five minutes costs the server nothing.
export const CONFIG_STALE_MS = 5 * 60_000;

const ConfigContext = createContext<AppConfig | null>(null);

export function useConfig(): AppConfig {
  const config = use(ConfigContext);
  if (!config) {
    throw new Error("useConfig() used outside <ConfigProvider>");
  }
  return config;
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const t = useT();

  // When the last answer arrived; 0 until one has. So the error screen, which
  // means no answer yet (a silent refresh never turns a config into an
  // error), is always stale, and every return to the app retries it. Stamped
  // on the ANSWER rather than on a changed object: an unchanged config keeps
  // its old object (below), and the clock must restart all the same.
  const loadedAt = useRef(0);
  // The config on screen. An answer that says the same thing hands this very
  // object back, so the memo deps of every useConfig() reader (the lock rules
  // in episode-feed.tsx and first-episode.ts read config.signupGate) stay put
  // instead of recomputing every five minutes.
  const shown = useRef<AppConfig | null>(null);
  // At most one request at a time. Two quick returns to the app, or one
  // during the launch request, share it instead of racing two answers into
  // setState in whatever order the network hands them back; the next return
  // after it settles asks again. Requests time out (client.ts), so a stuck one
  // cannot hold refreshing off for good.
  const inFlight = useRef<Promise<AppConfig> | null>(null);

  const fetchConfig = useCallback(() => {
    inFlight.current ??= api
      .config()
      .then((next) => {
        loadedAt.current = Date.now();
        if (!shown.current || !sameJson(shown.current, next)) shown.current = next;
        return shown.current;
      })
      .finally(() => {
        inFlight.current = null;
      });
    return inFlight.current;
  }, []);

  const state = useAsync(fetchConfig, []);
  const { reload } = state;

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && Date.now() - loadedAt.current >= CONFIG_STALE_MS) reload();
    });
    return () => subscription.remove();
  }, [reload]);

  if (state.status === "loading") return <Loading />;

  if (state.status === "error") {
    return (
      <ErrorState
        message={t.app.common.unreachable}
        hint={errorHint(t, state.error)}
        onRetry={state.retry}
      />
    );
  }

  // Force-upgrade. Deliberately a hard block with no dismiss: the reason to
  // raise minSupportedBuild is that this build is doing something wrong
  // (talking to a removed endpoint, mis-enforcing a gate), and a dismissible
  // nag would leave it doing that. Since the config refreshes on a return to
  // the app, a floor raised while this build is running swaps the WHOLE tree
  // for the wall at the next foreground, even mid-episode: the player and
  // the navigation stack unmount. On purpose. The build is retired because
  // it is wrong, and letting it finish the episode first is letting it stay
  // wrong.
  if (APP_BUILD < state.data.minSupportedBuild) {
    return <UpdateRequired />;
  }

  return <ConfigContext value={state.data}>{children}</ConfigContext>;
}

// Same JSON, same config. Key order takes part in the comparison, but both
// answers come from the same route, so it only moves with a server deploy,
// and then the cost is one re-render, never a stale gate.
function sameJson(a: AppConfig, b: AppConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Where an update comes from today: TestFlight (#292) — the app is not in the
// App Store yet. The TestFlight app by its scheme; where it is not installed
// openURL rejects, and Apple's TestFlight page (which offers it) opens
// instead. Once the app is published this becomes its store page (registry).
export const TESTFLIGHT_APP_URL = "itms-beta://";
export const TESTFLIGHT_WEB_URL = "https://testflight.apple.com/";

async function openUpdate() {
  try {
    await Linking.openURL(TESTFLIGHT_APP_URL);
  } catch {
    // A phone with no browser to take it has nothing better to offer.
    await Linking.openURL(TESTFLIGHT_WEB_URL).catch(() => undefined);
  }
}

function UpdateRequired() {
  const t = useT();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t.app.update.title}</Text>
      <Text style={styles.copy}>{t.app.update.body}</Text>
      <GoldButton
        label={t.app.update.cta}
        onPress={() => void openUpdate()}
        style={{ marginTop: space(6), alignSelf: "stretch" }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: SCREEN_PAD,
  },
  title: { ...display, color: colors.ink, fontSize: 28, textAlign: "center" },
  copy: {
    ...body,
    color: colors.inkMuted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginTop: space(3),
  },
});
