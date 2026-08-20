import { createContext, use, useCallback, type ReactNode } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { APP_BUILD } from "@/build";
import { ErrorState, GoldButton, Loading } from "@/components/ui";
import type { AppConfig } from "@/shared/api-types";
import { body, colors, display, SCREEN_PAD, space } from "@/theme";
import { api, API_BASE_URL } from "./client";
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
  const state = useAsync(useCallback(() => api.config(), []), []);

  if (state.status === "loading") return <Loading />;

  if (state.status === "error") {
    return (
      <ErrorState
        message="Couldn't reach Matio"
        hint={`${state.error.message}\n${API_BASE_URL}`}
        onRetry={state.retry}
      />
    );
  }

  // Force-upgrade. Deliberately a hard block with no dismiss: the reason to
  // raise minSupportedBuild is that this build is doing something wrong
  // (talking to a removed endpoint, mis-enforcing a gate), and a dismissible
  // nag would leave it doing that.
  if (APP_BUILD < state.data.minSupportedBuild) {
    return <UpdateRequired webUrl={state.data.urls.web} />;
  }

  return <ConfigContext value={state.data}>{children}</ConfigContext>;
}

function UpdateRequired({ webUrl }: { webUrl: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Update Matio</Text>
      <Text style={styles.copy}>
        This version is out of date and can no longer play. Please update to keep watching.
      </Text>
      <GoldButton
        label="Open matio.tv"
        onPress={() => void Linking.openURL(webUrl)}
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
