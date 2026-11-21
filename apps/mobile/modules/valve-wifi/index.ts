import { requireNativeModule } from 'expo-modules-core';

interface ValveWifiNativeModule {
  connectToNetwork(ssid: string, password: string): Promise<{ connected: boolean; ssid?: string }>;
  disconnect(ssid?: string): Promise<void>;
  getCurrentSsid(): Promise<string | null>;
}

/**
 * Local Expo module. Requires a development build; it is unavailable in Expo Go.
 * On Android the OS may show a "stay connected?" dialog because the ESP8266 AP
 * has no internet access. On iOS the Hotspot Configuration entitlement and a
 * matching provisioning profile are required.
 */
const nativeModule = requireNativeModule<ValveWifiNativeModule>('ValveWifi');

export async function connectToNetwork(
  ssid: string,
  password: string,
): Promise<{ connected: boolean; ssid?: string }> {
  return nativeModule.connectToNetwork(ssid, password);
}

export async function disconnectFromNetwork(ssid?: string): Promise<void> {
  return nativeModule.disconnect(ssid);
}

export async function getCurrentSsid(): Promise<string | null> {
  return nativeModule.getCurrentSsid();
}
