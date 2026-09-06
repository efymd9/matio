import { Anton_400Regular, useFonts } from "@expo-google-fonts/anton";
import { Geist_400Regular, Geist_600SemiBold } from "@expo-google-fonts/geist";
import { GeistMono_400Regular } from "@expo-google-fonts/geist-mono";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ConfigProvider } from "@/api/config-context";
import { AuthProvider } from "@/auth/clerk";
import { LocaleProvider, useInitialLocale } from "@/i18n/locale";
import { colors } from "@/theme";

// Hold the splash until the brand faces are ready. Without this the first
// frame renders in the system font and visibly reflows into Anton — worse
// than a marginally longer splash.
SplashScreen.preventAutoHideAsync();

// Espresso everywhere: the navigator's own background shows during transitions,
// so it has to be branded too or every push flashes default black.
const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.bg,
    text: colors.ink,
    primary: colors.gold,
    border: colors.hairline,
  },
};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Anton_400Regular,
    Geist_400Regular,
    Geist_600SemiBold,
    GeistMono_400Regular,
  });
  // The stored language choice (or the device's) — held behind the splash
  // for the same reason as the fonts: a first frame in the wrong language
  // that then flips is worse than a few more milliseconds of splash.
  const initialLocale = useInitialLocale();

  // Render nothing while loading, but do NOT block forever on a font failure —
  // shipping a blank app because a typeface didn't decode is a worse outcome
  // than shipping one in the system font. (The locale read has its own
  // deadline and always resolves.)
  if ((!fontsLoaded && !fontError) || !initialLocale) return null;
  void SplashScreen.hideAsync();

  // SafeAreaProvider is declared explicitly rather than relying on whatever
  // expo-router wraps internally — useSafeAreaInsets() in the screens throws
  // without a provider, and that dependency should be visible here.
  return (
    <SafeAreaProvider>
      <ThemeProvider value={navTheme}>
        <StatusBar style="light" />
        {/* Locale outermost: every provider below renders copy (the config
            error state, the update wall) and reads it through useT(). */}
        <LocaleProvider initial={initialLocale}>
          {/* Auth outside Config: the token provider must be installed before
              any /v1 request goes out, or the first calls of a signed-in
              session silently look anonymous. */}
          <AuthProvider>
            <ConfigProvider>
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.bg },
                }}
              />
            </ConfigProvider>
          </AuthProvider>
        </LocaleProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
