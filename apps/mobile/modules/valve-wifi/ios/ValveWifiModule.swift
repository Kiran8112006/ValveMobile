import ExpoModulesCore
import NetworkExtension

/**
 * iOS Wi-Fi helper using NEHotspotConfiguration.
 *
 * Requires the "Hotspot Configuration" capability
 * (com.apple.developer.networking.HotspotConfiguration) on the App ID and a
 * provisioning profile that includes it. Without the entitlement the system
 * returns an error, which is surfaced to the app rather than reported as a
 * success.
 */
public class ValveWifiModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ValveWifi")

    AsyncFunction("connectToNetwork") { (ssid: String, password: String, promise: Promise) in
      guard !ssid.isEmpty else {
        promise.reject("ERR_WIFI_SSID", "SSID is required.", nil)
        return
      }
      let configuration: NEHotspotConfiguration
      if password.isEmpty {
        configuration = NEHotspotConfiguration(ssid: ssid)
      } else {
        configuration = NEHotspotConfiguration(ssid: ssid, passphrase: password, isWEP: false)
      }
      configuration.joinOnce = false
      NEHotspotConfigurationManager.shared.apply(configuration) { error in
        if let error = error as NSError? {
          if error.domain == NEHotspotConfigurationErrorDomain,
             error.code == NEHotspotConfigurationError.alreadyAssociated.rawValue {
            promise.resolve(["connected": true, "ssid": ssid])
          } else {
            promise.reject("ERR_WIFI_CONNECT", error.localizedDescription, error)
          }
          return
        }
        promise.resolve(["connected": true, "ssid": ssid])
      }
    }

    AsyncFunction("disconnect") { (ssid: String?) in
      if let ssid = ssid, !ssid.isEmpty {
        NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: ssid)
      } else {
        NEHotspotConfigurationManager.shared.getConfiguredSSIDs { identifiers in
          for identifier in identifiers {
            NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: identifier)
          }
        }
      }
    }

    AsyncFunction("getCurrentSsid") { (promise: Promise) in
      NEHotspotNetwork.fetchCurrent { network in
        promise.resolve(network?.ssid)
      }
    }
  }
}
