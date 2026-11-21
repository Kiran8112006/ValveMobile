Pod::Spec.new do |s|
  s.name           = 'ValveWifi'
  s.version        = '1.0.0'
  s.summary        = 'Wi-Fi provisioning helper for the Valve ESP8266 setup network'
  s.description    = 'Joins a device SoftAP using Android WifiNetworkSpecifier or iOS NEHotspotConfiguration.'
  s.author         = 'Valve'
  s.homepage       = 'https://example.invalid/valve'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.source_files   = 'ios/**/*.{h,m,swift}'
  s.dependency 'ExpoModulesCore'
end
