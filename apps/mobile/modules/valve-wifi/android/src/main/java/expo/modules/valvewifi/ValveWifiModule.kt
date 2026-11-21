package expo.modules.valvewifi

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiConfiguration
import android.net.wifi.WifiManager
import android.net.wifi.WifiNetworkSpecifier
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Minimal, maintained Wi-Fi helper for ESP8266 SoftAP provisioning.
 *
 * Android 10+: WifiNetworkSpecifier + requestNetwork, then bindProcessToNetwork
 * so the local HTTP request to 192.168.4.1 leaves the phone over the ESP8266
 * setup network instead of mobile data. The system shows a "keep connected?"
 * dialog because the setup AP has no internet — that is expected.
 *
 * Android 7–9: legacy WifiManager.addNetwork fallback.
 *
 * The OS can refuse the connection (permission, Wi-Fi off, user cancellation).
 * In that case the promise rejects and the app must not claim success.
 */
class ValveWifiModule : Module() {
  private var networkCallback: ConnectivityManager.NetworkCallback? = null
  private var boundNetwork: Network? = null
  private var legacyNetworkId: Int = -1

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is unavailable" }

  override fun definition() = ModuleDefinition {
    Name("ValveWifi")

    AsyncFunction("connectToNetwork") { ssid: String, password: String, promise: Promise ->
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          connectModern(ssid, password, promise)
        } else {
          connectLegacy(ssid, password, promise)
        }
      } catch (error: Exception) {
        promise.reject("ERR_WIFI_CONNECT", error.message ?: "Could not start Wi-Fi connection", error)
      }
    }

    AsyncFunction("disconnect") {
      releaseConnection()
    }

    AsyncFunction("getCurrentSsid") { ->
      val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      @Suppress("DEPRECATION")
      val info = wifiManager.connectionInfo ?: return@AsyncFunction null
      @Suppress("DEPRECATION")
      val ssid = info.ssid ?: return@AsyncFunction null
      if (ssid == "<unknown ssid>" || ssid.isEmpty()) null else ssid.trim('"')
    }
  }

  private fun connectModern(ssid: String, password: String, promise: Promise) {
    releaseConnection()
    val connectivityManager =
      context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    val specifierBuilder = WifiNetworkSpecifier.Builder().setSsid(ssid)
    if (password.isNotEmpty()) {
      specifierBuilder.setWpa2Passphrase(password)
    }
    val request = NetworkRequest.Builder()
      .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
      .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
      .setNetworkSpecifier(specifierBuilder.build())
      .build()

    var settled = false
    val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        if (settled) return
        settled = true
        boundNetwork = network
        connectivityManager.bindProcessToNetwork(network)
        promise.resolve(mapOf("connected" to true, "ssid" to ssid))
      }

      override fun onUnavailable() {
        if (settled) return
        settled = true
        releaseConnection()
        promise.reject("ERR_WIFI_UNAVAILABLE", "The phone could not join $ssid. Confirm the setup network and password, and that Wi-Fi is enabled.", null)
      }

      override fun onLost(network: Network) {
        if (boundNetwork == network) {
          connectivityManager.bindProcessToNetwork(null)
          boundNetwork = null
        }
      }
    }

    networkCallback = callback
    connectivityManager.requestNetwork(request, callback, 45_000)
  }

  @Suppress("DEPRECATION")
  private fun connectLegacy(ssid: String, password: String, promise: Promise) {
    val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    val configuration = WifiConfiguration()
    configuration.SSID = "\"$ssid\""
    configuration.preSharedKey = if (password.isEmpty()) null else "\"$password\""
    val networkId = wifiManager.addNetwork(configuration)
    if (networkId < 0) {
      promise.reject("ERR_WIFI_ADD", "Android rejected the Wi-Fi configuration.", null)
      return
    }
    legacyNetworkId = networkId
    val enabled = wifiManager.enableNetwork(networkId, true)
    if (!enabled) {
      promise.reject("ERR_WIFI_ENABLE", "Android could not enable the Wi-Fi network.", null)
      return
    }
    promise.resolve(mapOf("connected" to true, "ssid" to ssid))
  }

  private fun releaseConnection() {
    val connectivityManager =
      context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    networkCallback?.let { callback ->
      try {
        connectivityManager.unregisterNetworkCallback(callback)
      } catch (_: Exception) {
      }
    }
    networkCallback = null
    if (boundNetwork != null) {
      connectivityManager.bindProcessToNetwork(null)
      boundNetwork = null
    }
    if (legacyNetworkId >= 0) {
      val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      @Suppress("DEPRECATION")
      wifiManager.disableNetwork(legacyNetworkId)
      legacyNetworkId = -1
    }
  }
}
