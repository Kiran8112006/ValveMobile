import type { AppDeps } from '../types/app.js';
import type { DeviceDoc, UserDoc } from '../types/domain.js';
import { publicDevice } from '../types/realtime.js';
import { paths } from '../store/types.js';
import { errors } from '../utils/errors.js';
import { newId } from '../utils/ids.js';
import {
  hmacSha256Hex,
  safeEqual,
  sha256Hex,
} from '../utils/security.js';

export interface PairingChallenge {
  pairingToken: string;
  expiresAt: string;
  deviceId: string;
  deviceName: string;
  setupApPrefix: string;
  instructions: string[];
}

interface PairingTokenPayload {
  deviceId: string;
  uid: string;
  exp: number;
}

function sign(payload: PairingTokenPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = hmacSha256Hex(secret, body);
  return `${body}.${signature}`;
}

function verifyToken(token: string, secret: string): PairingTokenPayload {
  const [body, signature] = token.split('.');
  if (!body || !signature) throw errors.badRequest('invalid_pairing_token', 'Malformed pairing token.');
  if (!safeEqual(hmacSha256Hex(secret, body), signature)) {
    throw errors.badRequest('invalid_pairing_token', 'Pairing token signature is invalid.');
  }
  let payload: PairingTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as PairingTokenPayload;
  } catch {
    throw errors.badRequest('invalid_pairing_token', 'Pairing token payload is invalid.');
  }
  if (payload.exp < Date.now()) {
    throw errors.badRequest('pairing_token_expired', 'Pairing token has expired.');
  }
  return payload;
}

/**
 * Authorize a pairing attempt. The claim code is printed on the device label
 * and only its SHA-256 hash is stored in Firestore. Wi-Fi credentials are never
 * involved in this exchange and never reach the backend.
 */
export async function createPairingChallenge(
  deps: AppDeps,
  uid: string,
  deviceId: string,
  claimCode: string,
): Promise<PairingChallenge> {
  const device = await deps.store.get<DeviceDoc>(paths.device(deviceId));
  if (!device) throw errors.notFound('Device not found.');
  if (device.assignedUserId && device.assignedUserId !== uid) {
    throw errors.conflict('device_assigned', 'This device is already paired to another account.');
  }
  if (!device.claimCodeHash) {
    throw errors.conflict(
      'claim_not_available',
      'This device was not issued a claim code. Ask an administrator to assign it.',
    );
  }
  if (device.claimUsedAt && device.assignedUserId !== uid) {
    throw errors.conflict('claim_used', 'This device claim code has already been used.');
  }
  if (!safeEqual(sha256Hex(claimCode.trim()), device.claimCodeHash)) {
    throw errors.badRequest('invalid_claim_code', 'Claim code is incorrect.');
  }

  const expiresAt = new Date(Date.now() + deps.config.pairing.challengeTtlMs);
  const token = sign(
    { deviceId: device.deviceId, uid, exp: expiresAt.getTime() },
    deps.config.pairing.tokenSecret,
  );
  return {
    pairingToken: token,
    expiresAt: expiresAt.toISOString(),
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    setupApPrefix: `Valve-ESP8266-${device.deviceId.slice(-4).toUpperCase()}`,
    instructions: [
      'Switch the device into setup mode (hold the pairing button for 3 seconds or power-cycle an unprovisioned device).',
      'On your phone, join the Valve-ESP8266-XXXX network printed on the device label.',
      'Enter your home Wi-Fi or hotspot name and password. They are sent only to the ESP8266.',
      'The device reboots, joins your network and appears online here after its first heartbeat.',
    ],
  };
}

/** Assign the device to the authenticated customer after a valid challenge. */
export async function claimDevice(
  deps: AppDeps,
  uid: string,
  pairingToken: string,
): Promise<{ device: DeviceDoc; previousDeviceId: string | null }> {
  const payload = verifyToken(pairingToken, deps.config.pairing.tokenSecret);
  if (payload.uid !== uid) {
    throw errors.forbidden('Pairing token belongs to a different account.');
  }
  const at = deps.now();
  return deps.store.runTransaction(async (tx) => {
    const device = await tx.get<DeviceDoc>(paths.device(payload.deviceId));
    if (!device) throw errors.notFound('Device not found.');
    if (device.assignedUserId && device.assignedUserId !== uid) {
      throw errors.conflict('device_assigned', 'Device is paired to another account.');
    }
    const user = await tx.get<UserDoc>(paths.user(uid));
    if (!user) throw errors.notFound('Customer profile not found.');
    if (user.status !== 'active') throw errors.forbidden('Account is not active.');

    const previousDeviceId = user.deviceId;
    if (previousDeviceId && previousDeviceId !== device.deviceId) {
      const previous = await tx.get<DeviceDoc>(paths.device(previousDeviceId));
      if (previous && previous.assignedUserId === uid) {
        tx.set(paths.device(previous.deviceId), {
          ...previous,
          assignedUserId: null,
          activeSessionId: null,
          updatedAt: at,
        });
      }
    }

    tx.set(paths.user(uid), {
      ...user,
      deviceId: device.deviceId,
      updatedAt: at,
    });
    tx.set(paths.device(device.deviceId), {
      ...device,
      assignedUserId: uid,
      claimUsedAt: device.claimUsedAt ?? at,
      updatedAt: at,
    });
    return {
      device: { ...device, assignedUserId: uid },
      previousDeviceId,
    };
  });
}

export async function getDeviceForUser(
  deps: AppDeps,
  user: UserDoc,
): Promise<DeviceDoc | null> {
  if (!user.deviceId) return null;
  const device = await deps.store.get<DeviceDoc>(paths.device(user.deviceId));
  if (!device) return null;
  if (!isHeartbeatFresh(deps, device)) {
    return { ...device, status: 'offline' };
  }
  return device;
}

export function isHeartbeatFresh(deps: AppDeps, device: DeviceDoc): boolean {
  if (!device.lastHeartbeat) return false;
  return (
    deps.now().getTime() - device.lastHeartbeat.getTime() <=
    deps.config.thingsboard.offlineThresholdMs
  );
}

/** Mark stale devices offline in Firestore and notify connected sessions. */
export async function refreshDeviceStatuses(deps: AppDeps): Promise<void> {
  const devices = await deps.store.query<DeviceDoc>('devices', {
    filters: [{ field: 'status', op: '==', value: 'online' }],
    limit: 200,
  });
  for (const device of devices) {
    if (isHeartbeatFresh(deps, device)) continue;
    const now = deps.now();
    await deps.store.merge(paths.device(device.deviceId), {
      status: 'offline',
      valveState: 'unknown',
      updatedAt: now,
    });
    const updated: DeviceDoc = {
      ...device,
      status: 'offline',
      valveState: 'unknown',
    };
    deps.hub.publishToAdmins({ type: 'device', device: publicDevice(updated) });
    if (device.assignedUserId) {
      deps.hub.publishToUser(device.assignedUserId, {
        type: 'device',
        device: publicDevice(updated),
      });
    }
  }
}

export function newDeviceId(): string {
  return newId('valve');
}

export function hashClaimCode(code: string): string {
  return sha256Hex(code.trim());
}

export function generateClaimCode(): string {
  // 10 groups of unambiguous characters, generated by crypto randomness.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}