import { requireNativeView } from "expo";
import type { ComponentType } from "react";

import type { RoutePickerViewProps } from "./RoutePickerView.types";

// iOS: the native AVRoutePickerView (ios/RoutePickerView.swift). Metro picks
// this file on iOS only; everywhere else RoutePickerView.tsx renders nothing.
const NativeRoutePicker: ComponentType<RoutePickerViewProps> = requireNativeView("MatioRoutePicker");

export function RoutePickerView(props: RoutePickerViewProps) {
  return <NativeRoutePicker {...props} />;
}
