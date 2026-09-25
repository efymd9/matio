import { Anton_400Regular, useFonts } from "@expo-google-fonts/anton";
import { Geist_400Regular, Geist_600SemiBold } from "@expo-google-fonts/geist";
import { GeistMono_400Regular } from "@expo-google-fonts/geist-mono";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ConfigProvider } from "@/api/config-context";
import { AuthProvider } from "@/auth/clerk";
import { LocaleProvider, useInitialLocale } from "@/i18n/locale";
import { lockOrientation, PORTRAIT_LOCK } from "@/orientation";
import { loadAutoplayNext } from "@/prefs/autoplay";
import { colors } from "@/theme";

// Hold the splash until the brand faces are ready. Without this the first
// frame renders in the system font and visibly reflows into Anton — worse
// than a marginally longer splash.
SplashScreen.preventAutoHideAsync();

// The «Play next episode automatically» setting, read from the keychain now,
// alongside the language the splash waits for — so the cache is primed
// before Settings ever mounts and its switch renders the stored value rather
// than «on» flipping to «off» on the first open after a launch.
void loadAutoplayNext();

// The tabs sit under every other screen of the root stack, even when the app
// starts ON one of them — a cold start from a matio:// link to a show, an
// episode or sign-in (and push notifications, #98). Without the anchor that
// screen is the stack's only one: back, «Not now» and the swipe go nowhere.
export const unstable_settings = { anchor: "(tabs)" };

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

  // Portrait is the app's orientation (#252): `app.json` allows every
  // orientation so the landscape player can take one, and this lock — once,
  // at launch — is what keeps the tabs, the show page and sign-in upright.
  // The watch screen locks landscape for a horizontal show and hands portrait
  // back on unmount (`useOrientationLock`).
  useEffect(() => {
    lockOrientation(PORTRAIT_LOCK);
  }, []);

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
              {/* The root stack (#245): the tab group is one screen of it,
                  and the show page, the player and sign-in are its siblings
                  — pushed OVER the tabs, so none of them ever has the tab
                  bar. That is the "bar hidden on the show page" decision,
                  by construction rather than by a per-screen style. */}
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.bg },
                }}
              >
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="show/[slug]" />
                <Stack.Screen name="watch/[episodeId]" />
                <Stack.Screen name="sign-in" />
              </Stack>
            </ConfigProvider>
          </AuthProvider>
        </LocaleProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
