import ExpoModulesCore
import UIKit

// The landscape player's AirPlay button (#451). One view, no functions: the
// route list is the system's, and what is chosen there is the system's too —
// the player follows it because react-native-video keeps
// `allowsExternalPlayback` on (mobile/src/watch/episode-feed.tsx).
public final class RoutePickerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MatioRoutePicker")

    View(RoutePickerView.self) {
      // The glyph while nothing is routed, and while a route is active.
      Prop("tintColor") { (view: RoutePickerView, color: UIColor?) in
        view.setTint(color)
      }

      Prop("activeTintColor") { (view: RoutePickerView, color: UIColor?) in
        view.setActiveTint(color)
      }

      // `{ presenting: true }` as the system's device list opens, `false`
      // as it closes — the chrome does not hide itself under the list.
      Events("onPresentingRoutesChange")
    }
  }
}
