import AVKit
import ExpoModulesCore

// AVRoutePickerView — Apple's own AirPlay button — as a React Native view
// (#451). A tap opens the system's device list; picking an Apple TV or an
// AirPlay TV sends the player's video there, because react-native-video
// keeps `allowsExternalPlayback` on and `prioritizesVideoDevices` puts the
// TVs first.
//
// Size: the view is the hit area React Native lays out (44 × 44 pt, the
// picture-in-picture button's). AVRoutePickerView draws its glyph to its own
// frame, so stretched to 44 pt the glyph would dwarf the 20 pt symbols beside
// it; the picker is kept at GLYPH_SIDE in the middle, and every touch inside
// the hit area is handed to the picker's own control (hitTest below). A
// VoiceOver double tap lands there too: the element is this view (React
// Native's `accessible`, label from the app's dictionary), and with no
// accessibility action of ours iOS activates it with a tap at its centre.
final class RoutePickerView: ExpoView, @preconcurrency AVRoutePickerViewDelegate {
  private static let glyphSide: CGFloat = 24

  private let picker = AVRoutePickerView()
  let onPresentingRoutesChange = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    picker.backgroundColor = .clear
    picker.prioritizesVideoDevices = true
    picker.delegate = self
    addSubview(picker)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let side = min(Self.glyphSide, bounds.width, bounds.height)
    picker.frame = CGRect(
      x: (bounds.width - side) / 2,
      y: (bounds.height - side) / 2,
      width: side,
      height: side
    )
  }

  // The whole hit area is the button: a touch anywhere inside it goes to
  // whatever the picker itself would take a touch at its centre with.
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard isUserInteractionEnabled, !isHidden, alpha > 0.01, self.point(inside: point, with: event) else {
      return nil
    }
    let centre = CGPoint(x: picker.bounds.midX, y: picker.bounds.midY)
    return picker.hitTest(centre, with: event) ?? super.hitTest(point, with: event)
  }

  func setTint(_ color: UIColor?) {
    picker.tintColor = color
  }

  func setActiveTint(_ color: UIColor?) {
    picker.activeTintColor = color
  }

  // MARK: - AVRoutePickerViewDelegate

  func routePickerViewWillBeginPresentingRoutes(_ routePickerView: AVRoutePickerView) {
    onPresentingRoutesChange(["presenting": true])
  }

  func routePickerViewDidEndPresentingRoutes(_ routePickerView: AVRoutePickerView) {
    onPresentingRoutesChange(["presenting": false])
  }
}
