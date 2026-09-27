import { Tabs } from "expo-router/js-tabs";
import { CatalogProvider } from "@/api/catalog-context";
import { GlassTabBar } from "@/components/glass-tab-bar";
import { useT } from "@/i18n/locale";
import { colors } from "@/theme";

// The four tabs of the native shell (#245): Home · Browse · Account ·
// Settings, drawn by the floating glass bar. A JS `Tabs` (not the native
// UITabBar) because the bar is a custom floating pill — style B on board 1;
// NativeTabs can only do style A.
//
// Titles come from the live dictionary so the bar re-labels itself the
// moment the language changes in Settings. Home and Browse read ONE catalog
// (api/catalog-context.tsx), held here for as long as the tabs live.
export default function TabsLayout() {
  const t = useT();
  return (
    <CatalogProvider>
      <Tabs
        tabBar={(props) => <GlassTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.bg },
        }}
      >
        <Tabs.Screen name="index" options={{ title: t.app.tabs.home }} />
        <Tabs.Screen name="browse" options={{ title: t.app.tabs.browse }} />
        <Tabs.Screen name="account" options={{ title: t.app.tabs.account }} />
        <Tabs.Screen name="settings" options={{ title: t.app.tabs.settings }} />
      </Tabs>
    </CatalogProvider>
  );
}

// A render crash in a tab, or in the bar itself, is the tab group's, not the
// app's (#308): expo-router wraps THIS layout in the boundary, so the
// fallback takes the group's place — the bar with it — while the root stack
// and any screen pushed over the tabs live on. The tab navigator's state
// goes with its unmount, so «Try again» remounts the group on Home, and so
// does «Back» (nothing is under the tabs: goBackOrHome replaces the group
// with a fresh one). See components/route-error.tsx.
export { RouteErrorBoundary as ErrorBoundary } from "@/components/route-error";
