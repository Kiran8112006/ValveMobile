import { connectToNetwork, disconnectFromNetwork } from '../modules/valve-wifi';

export interface PairingLabel {
  deviceId: string;
  claimCode: string;
  apSsid: string;
  apPassword: string;
  pairingToken: string;
}

/** QR/label payload:
 *   valve://pair?deviceId=...&claimCode=...&apSsid=Valve-ESP8266-XXXX&apPassword=...&pairingToken=...
 *
 * Only deviceId + claimCode are required; the access-point details can be typed
 * from the device label. Wi-Fi credentials never leave the phone except for the
 * direct local request to the ESP8266.
 */
export function parsePairingPayload(raw: string): Partial<PairingLabel> | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'valve:' || url.hostname !== 'pair') return null;
    const deviceId = url.searchParams.get('deviceId') ?? '';
    const claimCode = url.searchParams.get('claimCode') ?? '';
    if (!deviceId || !claimCode) return null;
    return {
      deviceId,
      claimCode,
      apSsid: url.searchParams.get('apSsid') ?? '',
      apPassword: url.searchParams.get('apPassword') ?? '',
      pairingToken: url.searchParams.get('pairingToken') ?? '',
    };
  } catch {
    return null;
  }
}

export function defaultSetupSsid(deviceId: string): string {
  const suffix = deviceId.slice(-4).toUpperCase();
  return `Valve-ESP8266-${suffix}`;
}

export async function joinDeviceSetupNetwork(
  ssid: string,
  password: string,
): Promise<{ connected: boolean; ssid?: string }> {
  if (!ssid) throw new Error('Enter the device setup network name printed on the label.');
  return connectToNetwork(ssid, password);
}

export async function leaveDeviceSetupNetwork(ssid?: string): Promise<void> {
  try {
    await disconnectFromNetwork(ssid);
  } catch {
    /* best effort */
  }
}

const DEVICE_SETUP_URL = 'http://192.168.4.1';

export async function provisionDevice(input: {
  ssid: string;
  password: string;
  pairingToken: string;
}): Promise<{ ok: boolean; message: string }> {
  if (!input.ssid) throw new Error('Enter the Wi-Fi network name.');
  if (!input.pairingToken) throw new Error('Enter the pairing token printed on the device label.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${DEVICE_SETUP_URL}/provision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Pairing-Token': input.pairingToken,
      },
      body: JSON.stringify({ ssid: input.ssid, password: input.password }),
      signal: controller.signal,
    });
    const text = await response.text();
    let body: { ok?: boolean; error?: string; message?: string } = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    if (!response.ok || body.ok !== true) {
      throw new Error(
        body.message ?? body.error ?? 'The device rejected the Wi-Fi details. Check the network name and password.',
      );
    }
    return { ok: true, message: body.message ?? 'Wi-Fi saved.' };
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error('The device did not answer. Rejoin the setup network and try again.');
    }
    if (error instanceof TypeError) {
      throw new Error(
        'Could not reach the device at 192.168.4.1. Make sure the phone is still joined to the VALVE-ESP8266 network.',
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}