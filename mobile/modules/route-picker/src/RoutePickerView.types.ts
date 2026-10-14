import type { ColorValue, NativeSyntheticEvent, ViewProps } from "react-native";

export type PresentingRoutesChange = { presenting: boolean };

export type RoutePickerViewProps = ViewProps & {
  // The AirPlay glyph while nothing is routed…
  tintColor?: ColorValue;
  // …and while the video is on a TV.
  activeTintColor?: ColorValue;
  // The system's device list opening (`presenting: true`) and closing.
  onPresentingRoutesChange?: (event: NativeSyntheticEvent<PresentingRoutesChange>) => void;
};
