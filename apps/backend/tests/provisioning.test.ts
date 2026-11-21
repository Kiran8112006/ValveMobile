import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { paths } from '../src/store/types.js';
import type { DeviceDoc, UserDoc } from '../src/types/domain.js';
import {
  createTestContext,
  CUSTOMER_UID,
  seedStandardWorld,
} from './helpers.js';

const adminAuth = { authorization: 'Bearer admin-token' };
const customerAuth = { authorization: 'Bearer customer-token' };

async function setup() {
  const ctx = createTestContext();
  await seedStandardWorld(ctx.store);
  const app = await buildApp(ctx.deps);
  const registered = await app.inject({
    method: 'POST',
    url: '/api/admin/devices',
    headers: adminAuth,
    payload: {
      thingsBoardDeviceUuid: 'tb-pairing-1',
      deviceName: 'Pairing Test Valve',
      hardwareModel: 'ESP8266 NodeMCU',
    },
  });
  const body = registered.json();
  return { ctx, app, deviceId: body.device.deviceId as string, claimCode: body.claimCode as string };
}

describe('device pairing and Wi-Fi provisioning authorization', () => {
  it('authorises pairing with the one-time claim code', async () => {
    const { app, deviceId, claimCode } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/devices/pairing/challenge',
      headers: customerAuth,
      payload: { deviceId, claimCode },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.pairingToken).toBeTruthy();
    expect(body.deviceId).toBe(deviceId);
    expect(body.setupApPrefix).toMatch(/^VALVE-SETUP-/);
    expect(body.notice).toMatch(/never reach this server/i);
  });

  it('rejects an incorrect claim code', async () => {
    const { app, deviceId } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/devices/pairing/challenge',
      headers: customerAuth,
      payload: { deviceId, claimCode: 'WRONGCODE123456' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_claim_code');
  });

  it('binds the device to the authenticated customer after a valid challenge', async () => {
    const { ctx, app, deviceId, claimCode } = await setup();
    const challenge = await app.inject({
      method: 'POST',
      url: '/api/devices/pairing/challenge',
      headers: customerAuth,
      payload: { deviceId, claimCode },
    });
    const token = challenge.json().pairingToken as string;
    const assign = await app.inject({
      method: 'POST',
      url: '/api/devices/assign',
      headers: customerAuth,
      payload: { pairingToken: token },
    });
    expect(assign.statusCode).toBe(200);
    expect(assign.json().assigned).toBe(true);

    const user = await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID));
    expect(user?.deviceId).toBe(deviceId);
    const device = await ctx.store.get<DeviceDoc>(paths.device(deviceId));
    expect(device?.assignedUserId).toBe(CUSTOMER_UID);
    expect(device?.claimUsedAt).toBeInstanceOf(Date);
  });

  it('refuses to let a different account use the pairing token', async () => {
    const { app, deviceId, claimCode } = await setup();
    const challenge = await app.inject({
      method: 'POST',
      url: '/api/devices/pairing/challenge',
      headers: customerAuth,
      payload: { deviceId, claimCode },
    });
    const token = challenge.json().pairingToken as string;
    const assign = await app.inject({
      method: 'POST',
      url: '/api/devices/assign',
      headers: { authorization: 'Bearer other-customer-token' },
      payload: { pairingToken: token },
    });
    expect(assign.statusCode).toBe(403);
  });

  it('rejects a forged pairing token', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/devices/assign',
      headers: customerAuth,
      payload: { pairingToken: 'ZmFrZQ.deadbeef' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('reports device status to the paired customer', async () => {
    const { app, deviceId, claimCode } = await setup();
    const challenge = await app.inject({
      method: 'POST',
      url: '/api/devices/pairing/challenge',
      headers: customerAuth,
      payload: { deviceId, claimCode },
    });
    await app.inject({
      method: 'POST',
      url: '/api/devices/assign',
      headers: customerAuth,
      payload: { pairingToken: challenge.json().pairingToken },
    });
    const status = await app.inject({
      method: 'GET',
      url: '/api/devices/status',
      headers: customerAuth,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().device.deviceId).toBe(deviceId);
  });
});
