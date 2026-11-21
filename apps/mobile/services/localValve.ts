/**
 * Local Direct ESP8266 Valve Service
 *
 * Communicates directly with the ESP8266 when the phone is joined to the
 * 'Valve-Water-Dispenser' Wi-Fi access point at 192.168.4.1.
 * Does not require external internet or cloud backend.
 */

export const DIRECT_VALVE_URL = 'http://192.168.4.1';

export interface DirectStatus {
  ok: boolean;
  deviceId: string;
  valveState: 'on' | 'off';
  relayEnergized: boolean;
  sessionActive: boolean;
  sessionId: string;
  authorizedMl: number;
  consumedMl: number;
  balanceMl: number;
  totalDispensedMl: number;
  flowRateMlSec?: number;
  uptime?: number;
}

export interface DirectStartResult {
  ok: boolean;
  valveState: 'on';
  sessionId: string;
  authorizedMl: number;
  balanceMl: number;
}

export interface DirectStopResult {
  ok: boolean;
  valveState: 'off';
  sessionId: string;
  consumedMl: number;
  balanceMl: number;
  totalDispensedMl: number;
}

export interface DirectTopupResult {
  ok: boolean;
  balanceMl: number;
  addedMl: number;
}

/**
 * Probe whether the ESP8266 is reachable on 192.168.4.1.
 * Returns DirectStatus if connected, or null if not on the ESP8266 Wi-Fi.
 */
export async function checkDirectDevice(): Promise<DirectStatus | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(`${DIRECT_VALVE_URL}/api/status`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as DirectStatus;
    return data && data.ok ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Start dispensing water directly on the ESP8266.
 */
export async function startDirectValve(authorizedMl?: number): Promise<DirectStartResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${DIRECT_VALVE_URL}/api/valve/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(authorizedMl ? { authorizedMl } : {}),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error ?? 'Failed to open valve.');
    }
    return data as DirectStartResult;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stop dispensing water directly on the ESP8266.
 */
export async function stopDirectValve(): Promise<DirectStopResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${DIRECT_VALVE_URL}/api/valve/stop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error ?? 'Failed to close valve.');
    }
    return data as DirectStopResult;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Top up / add prepaid water credit directly on the ESP8266.
 */
export async function topupDirectBalance(amountMl: number = 50000): Promise<DirectTopupResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${DIRECT_VALVE_URL}/api/balance/topup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ amountMl }),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error ?? 'Failed to add balance.');
    }
    return data as DirectTopupResult;
  } finally {
    clearTimeout(timer);
  }
}
