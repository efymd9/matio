import type { useRouter } from "expo-router";

type BackRouter = Pick<ReturnType<typeof useRouter>, "back" | "canGoBack" | "replace">;

// «Back» for a screen of the root stack: the previous screen, or Home when
// there is none. The root layout anchors the stack on the tabs
// (`unstable_settings` in app/_layout.tsx), so a cold start from a matio://
// link — and a push notification later (#98) — normally has Home under it
// already; this is the belt for the case where it does not, where a bare
// back() does nothing and the screen would have no way out.
export function goBackOrHome(router: BackRouter): void {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}
