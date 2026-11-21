import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { paths } from '../src/store/types.js';
import type { DeviceDoc, DispensingSessionDoc, UserDoc } from '../src/types/domain.js';
import {
  createTestContext,
  CUSTOMER_UID,
  DEVICE_ID,
  seedDevice,
  seedSession,
  seedStandardWorld,
  TB_UUID,
} from './helpers.js';

const SECRET = 'tb-webhook-secret-1234567890';

async function setup(options: { seedSession?: boolean } = {}) {
  const ctx = createTestContext();
  await seedStandardWorld(ctx.store);
  if (options.seedSession !== false) {
    await seedSession(ctx.store, { authorizedMl: 10_000 });
    await ctx.store.merge(paths.device(DEVICE_ID), { activeSessionId: 'ses_test' });
  }
  const app = await buildApp(ctx.deps);
  return { ctx, app };
}

function consumption(overrides: Record<string, unknown> = {}) {
  return {
    originatorId: TB_UUID,
    eventType: 'consumption_event',
    sessionId: 'ses_test',
    eventId: 'evt-wh-0001',
    sequence: 1,
    quantityMl: 1000,
    valveOpenDurationMs: 1000,
    type: 'full_cycle',
    final: false,
    ...overrides,
  };
}

describe('ThingsBoard telemetry webhook', () => {
  it('rejects requests without the shared secret', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/thingsboard/telemetry',
      payload: consumption(),
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a wrong webhook secret', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/thingsboard/telemetry',
      headers: { 'x-valve-webhook-secret': 'wrong-secret-value' },
      payload: consumption(),
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects telemetry from an unregistered device', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/thingsboard/telemetry',
      headers: { 'x-valve-webhook-secret': SECRET },
      payload: consumption({ originatorId: 'unknown-uuid' }),
    });
    expect(response.statusCode).toBe(403);
  });

  it('updates device connectivity and broadcasts heartbeats', async () => {
    const { ctx, app } = await setup({ seedSession: false });
    await seedDevice(ctx.store, { status: 'offline', lastHeartbeat: null });
    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/thingsboard/telemetry',
      headers: { 'x-valve-webhook-secret': SECRET },
      payload: {
        originatorId: TB_UUID,
        eventType: 'heartbeat',
        valveState: 'off',
        relayState: 'off',
        wifiRssi: -62,
        firmwareVersion: '1.0.0',
      },
    });
    expect(response.statusCode).toBe(200);
    const device = await ctx.store.get<DeviceDoc>(paths.device(DEVICE_ID));
    expect(device?.status).toBe('online');
    expect(device?.lastHeartbeat).toBeInstanceOf(Date);
    expect(device?.wifiRssi).toBe(-62);
    expect(
      ctx.hub.messages.some(
        (entry) => entry.message.type === 'device' && entry.target === CUSTOMER_UID,
      ),
    ).toBe(true);
  });

  it('deducts a completed cycle, broadcasts and acknowledges the exact event', async () => {
    const { ctx, app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/thingsboard/telemetry',
      headers: { 'x-valve-webhook-secret': SECRET },
      payload: consumption(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      ok: true,
      duplicate: false,
      balanceMl: 9000,
      consumedMl: 1000,
      remainingAuthorizedMl: 9000,
    });

    const user = await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID));
    expect(user?.balanceMl).toBe(9000);
    const ack = ctx.tb.calls.find((call) => call.method === 'ackConsumptionEvent');
    expect(ack?.params).toMatchObject({
      eventId: 'evt-wh-0001',
      success: true,
      balanceAfterMl: 9000,
    });
    expect(ctx.hub.messages.some((entry) => entry.message.type === 'dispensing')).toBe(true);
    expect(ctx.hub.messages.some((entry) => entry.message.type === 'balance')).toBe(true);
  });

  it('acknowledges a duplicate without deducting twice', async () => {
    const { ctx, app } = await setup();
    const payload = consumption();
    await app.inject({
      method: 'POST',
      url: '/api/webhooks/thingsboard/telemetry',
      headers: { 'x-valve-webhook-secret': SECRET },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/webhooks/thingsboard/telemetry',
      headers: { 'x-valve-webhook-secret': SECRET },
      payload,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ duplicate: true, balanceMl: 9000 });
    const acks = ctx.tb.calls.filter((call) => call.method === 'ackConsumptionEvent');
    expect(acks).toHaveLength(2);
    const user = await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID));
    expect(user?.balanceMl).toBe(9000);
  });

  it('rejects a malformed quantity that does not match energized time', async () => {
    const { ctx, app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/thingsboard/telemetry',
      headers: { 'x-valve-webhook-secret': SECRET },
      payload: consumption({ quantityMl: 750, valveOpenDurationMs: 1000 }),
    });
    expect(response.statusCode).toBe(400);
    const user = await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID));
    expect(user?.balanceMl).toBe(10_000);
  });

  it('rejects out-of-order sequences', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/thingsboard/telemetry',
      headers: { 'x-valve-webhook-secret': SECRET },
      payload: consumption({ eventId: 'evt-wh-gap', sequence: 4 }),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('sequence_out_of_order');
  });

  it('rejects consumption for an unassigned device', async () => {
    const ctx = createTestContext();
    await seedDevice(ctx.store, { assignedUserId: null });
    const app = await buildApp(ctx.deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/thingsboard/telemetry',
      headers: { 'x-valve-webhook-secret': SECRET },
      payload: consumption(),
    });
    expect(response.statusCode).toBe(409);
  });

  it('completes the session when the final partial event is processed', async () => {
    const { ctx, app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/thingsboard/telemetry',
      headers: { 'x-valve-webhook-secret': SECRET },
      payload: consumption({
        eventId: 'evt-wh-final',
        quantityMl: 500,
        valveOpenDurationMs: 500,
        type: 'partial_cycle',
        final: true,
        stopReason: 'user_off',
      }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().sessionStatus).toBe('completed');
    const session = await ctx.store.get<DispensingSessionDoc>(paths.session('ses_test'));
    expect(session?.status).toBe('completed');
    expect(session?.stopReason).toBe('user_off');
  });

  it('rejects unsupported event types', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/thingsboard/telemetry',
      headers: { 'x-valve-webhook-secret': SECRET },
      payload: { originatorId: TB_UUID, eventType: 'something_else' },
    });
    expect(response.statusCode).toBe(400);
  });
});
