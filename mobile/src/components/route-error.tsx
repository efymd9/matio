import { useRouter, type ErrorBoundaryProps } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { ErrorState } from "@/components/ui";
import { useT } from "@/i18n/locale";
import { goBackOrHome } from "@/navigation";
import { captureCrash } from "@/observability";
import { colors } from "@/theme";

// What a render crash shows instead of closing the app (#308). A route file
// that exports `ErrorBoundary` is wrapped by expo-router in its own boundary
// (`Try`, build/views/Try.js): an exception thrown while rendering that route
// — or anything under it — replaces the route's tree with this screen, and
// `retry` clears the error and mounts the route afresh. Without one, a render
// exception anywhere in the app is RCTFatal: the app closes (0.1.0 (4), the
// Account tab, #247).
//
// The copy is the web's route-error kicker and title (app/error.tsx) — the
// same situation, already in both languages. Its body is not used: «we've
// logged it» is true only in a build with a Sentry DSN (#317).

// Both boundaries render this, so it is the one place the error tracker
// (#317) hooks in — with the web's privacy contract: `error` is never shown
// and never logged here, because its message can carry whatever the code
// that threw had in hand. It goes to Sentry only (a no-op without a DSN),
// through the scrubbers in src/observability.ts — once per caught crash: the
// effect runs when a boundary mounts this screen, and a re-render of it
// reports nothing new («Try again» that crashes again is a new catch).
function CrashScreen({ error, retry, onBack }: ErrorBoundaryProps & { onBack?: () => void }) {
  useEffect(() => {
    captureCrash(error);
  }, [error]);
  const t = useT();
  return (
    <ErrorState
      message={t.appError.kicker}
      hint={t.appError.title}
      onRetry={() => void retry()}
      onBack={onBack}
    />
  );
}

// A screen's crash — re-exported as `ErrorBoundary` by the tab group's
// layout, the show page, the player and sign-in. The root stack stays, and
// so does whatever is under the screen: «Back» leads there, or Home when
// there is nothing (the tab group itself); «Try again» mounts it afresh.
//
// The player: the boundary unmounts the crashed screen's tree, and its
// orientation lock hands portrait back on unmount (useOrientationLock), so
// this screen is upright — and so is the one «Back» returns to.
export function RouteErrorBoundary(props: ErrorBoundaryProps) {
  const router = useRouter();
  return <CrashScreen {...props} onBack={() => goBackOrHome(router)} />;
}

// The last resort, for a crash in the root layout itself — the providers,
// the stack. It renders in place of all of it: outside the locale provider
// (useT answers in DEFAULT_LOCALE there, from the context's own default),
// outside the navigator's themed background (hence the espresso here), and
// with nothing to go back to — so «Try again» only.
export function RootErrorBoundary(props: ErrorBoundaryProps) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <CrashScreen {...props} />
    </View>
  );
}
