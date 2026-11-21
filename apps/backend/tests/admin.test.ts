import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { paths } from '../src/store/types.js';
import type { DeviceDoc, TransactionDoc, UserDoc } from '../src/types/domain.js';
import {
  createTestContext,
  CUSTOMER_UID,
  DEVICE_ID,
  seedAdmin,
  seedDevice,
  seedStandardWorld,
} from './helpers.js';

const adminAuth = { authorization: 'Bearer admin-token' };

async function setup() {
  const ctx = createTestContext();
  await seedStandardWorld(ctx.store);
  await seedAdmin(ctx.store);
  const app = await buildApp(ctx.deps);
  return { ctx, app };
}

describe('admin operations', () => {
  it('summarises customers, balances, devices and dispensing', async () => {
    const { ctx, app } = await setup();
    await ctx.store.merge(paths.user(CUSTOMER_UID), { totalEstimatedDispensedMl: 2500 });
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/overview',
      headers: adminAuth,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.totals.customers).toBeGreaterThanOrEqual(3);
    expect(body.totals.balanceMl).toBeGreaterThanOrEqual(10_000);
    expect(body.totals.estimatedDispensedMl).toBeGreaterThanOrEqual(2500);
    expect(body.totals.onlineDevices).toBe(1);
  });

  it('credits water once per idempotency key', async () => {
    const { ctx, app } = await setup();
    const payload = { quantityMl: 5000, reason: 'cash payment' };
    const first = await app.inject({
      method: 'POST',
      url: `/api/admin/customers/${CUSTOMER_UID}/credit`,
      headers: { ...adminAuth, 'idempotency-key': 'cash-credit-0001' },
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ credited: true, balanceMl: 15_000 });

    const second = await app.inject({
      method: 'POST',
      url: `/api/admin/customers/${CUSTOMER_UID}/credit`,
      headers: { ...adminAuth, 'idempotency-key': 'cash-credit-0001' },
      payload,
    });
    expect(second.json()).toMatchObject({ credited: false, duplicate: true, balanceMl: 15_000 });

    const user = await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID));
    expect(user?.balanceMl).toBe(15_000);
    const ledger = await ctx.store.query<TransactionDoc>('transactions', {
      filters: [{ field: 'userId', op: '==', value: CUSTOMER_UID }],
    });
    expect(ledger.filter((entry) => entry.type === 'cash_credit')).toHaveLength(1);
  });

  it('requires an idempotency key for cash credit', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/customers/${CUSTOMER_UID}/credit`,
      headers: adminAuth,
      payload: { quantityMl: 1000 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('idempotency_key_required');
  });

  it('disables a customer account', async () => {
    const { ctx, app } = await setup();
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/customers/${CUSTOMER_UID}/status`,
      headers: adminAuth,
      payload: { status: 'disabled' },
    });
    expect(response.statusCode).toBe(200);
    const user = await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID));
    expect(user?.status).toBe('disabled');

    const blocked = await app.inject({
      method: 'GET',
      url: '/api/valve/status',
      headers: { authorization: 'Bearer customer-token' },
    });
    expect(blocked.statusCode).toBe(403);
  });

  it('assigns a device to a customer', async () => {
    const { ctx, app } = await setup();
    await seedDevice(ctx.store, {
      deviceId: 'valve_second',
      thingsBoardDeviceUuid: 'tb-second',
      assignedUserId: null,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/device/assign',
      headers: adminAuth,
      payload: { deviceId: 'valve_second', uid: CUSTOMER_UID },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().device.assignedUserId).toBe(CUSTOMER_UID);
    const user = await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID));
    expect(user?.deviceId).toBe('valve_second');
    const oldDevice = await ctx.store.get<DeviceDoc>(paths.device(DEVICE_ID));
    expect(oldDevice?.assignedUserId).toBeNull();
  });

  it('updates pricing with validation and records an audit log', async () => {
    const { ctx, app } = await setup();
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/admin/pricing',
      headers: adminAuth,
      payload: {
        pricePerLitrePaise: 750,
        minimumRechargeLitres: 5,
        maximumRechargeLitres: 200,
        availableRechargePackages: [10, 25, 50],
      },
    });
    expect(response.statusCode).toBe(200);
    const pricing = await ctx.store.get(paths.pricing());
    expect(pricing).toMatchObject({ pricePerLitrePaise: 750, maximumRechargeLitres: 200 });

    const invalid = await app.inject({
      method: 'PATCH',
      url: '/api/admin/pricing',
      headers: adminAuth,
      payload: {
        pricePerLitrePaise: 750,
        minimumRechargeLitres: 10,
        maximumRechargeLitres: 20,
        availableRechargePackages: [50],
      },
    });
    expect(invalid.statusCode).toBe(400);

    const audit = await app.inject({
      method: 'GET',
      url: '/api/admin/audit',
      headers: adminAuth,
    });
    expect(audit.json().logs.some((log: { action: string }) => log.action === 'pricing.update')).toBe(
      true,
    );
  });

  it('registers a device and returns a one-time claim code', async () => {
    const { ctx, app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/devices',
      headers: adminAuth,
      payload: {
        thingsBoardDeviceUuid: 'tb-new-device-1',
        deviceName: 'Garage Valve',
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.claimCode).toMatch(/^[A-Z2-9]{16}$/);
    expect(body.label.qrPayload).toContain('valve://pair');
    const device = await ctx.store.get<DeviceDoc>(paths.device(body.device.deviceId));
    expect(device?.claimCodeHash).toBeTruthy();
    expect(device?.claimCodeHash).not.toBe(body.claimCode);
  });

  it('refuses to assign a device with an active session', async () => {
    const { ctx, app } = await setup();
    await ctx.store.merge(paths.device(DEVICE_ID), { activeSessionId: 'ses_active' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/device/assign',
      headers: adminAuth,
      payload: { deviceId: DEVICE_ID, uid: 'cust-2' },
    });
    expect(response.statusCode).toBe(409);
  });
});
