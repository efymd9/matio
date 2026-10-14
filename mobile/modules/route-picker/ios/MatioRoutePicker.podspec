# The app's own AirPlay route picker (#451) — a local Expo module, found by
# expo-modules-autolinking in mobile/modules/ (its default nativeModulesDir),
# so no npm package and no line in package.json. The shape is Expo's own
# local-module template (create-expo-module --local, SDK 57).
Pod::Spec.new do |s|
  s.name           = 'MatioRoutePicker'
  s.version        = '1.0.0'
  s.summary        = 'AVRoutePickerView as a React Native view (Matio).'
  s.description    = 'The AirPlay button of the Matio landscape player: AVRoutePickerView behind the Expo Modules API.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
