import type { RoutePickerViewProps } from "./RoutePickerView.types";

// Android, web and the tests: there is no native view here (the module is
// iOS-only — expo-module.config.json), so nothing is drawn. Android's own
// cast path is Chromecast, which the app does not have (docs/registry.md).
export function RoutePickerView(_props: RoutePickerViewProps) {
  return null;
}
