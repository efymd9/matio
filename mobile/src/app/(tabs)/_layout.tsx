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
