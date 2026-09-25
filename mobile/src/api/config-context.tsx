import { createContext, use, useCallback, type ReactNode } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { APP_BUILD } from "@/build";
import { ErrorState, GoldButton, Loading } from "@/components/ui";
import { useT } from "@/i18n/locale";
import type { AppConfig } from "@/shared/api-types";
import { body, colors, display, SCREEN_PAD, space } from "@/theme";
import { api } from "./client";
import { errorHint } from "./error-hint";
import { useAsync } from "./use-async";

// AppConfig is fetched once at launch and read everywhere. It carries the
// server's kill-switches, so nothing that depends on gating should render
// before it resolves — a screen that guesses the gate and is wrong is exactly
// the client/server disagreement the free pivot got bitten by.

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
  const state = useAsync(useCallback(() => api.config(), []), []);

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
  // nag would leave it doing that.
  if (APP_BUILD < state.data.minSupportedBuild) {
    return <UpdateRequired />;
  }

  return <ConfigContext value={state.data}>{children}</ConfigContext>;
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
