import { describe, expect, it } from 'vitest';
import { ValveService } from '../src/valve/service.js';
import { paths } from '../src/store/types.js';
import type { DeviceDoc, DispensingSessionDoc, UserDoc } from '../src/types/domain.js';
import {
  createTestContext,
  CUSTOMER_UID,
  DEVICE_ID,
  seedDevice,
  seedSession,
  seedStandardWorld,
  seedUser,
} from './helpers.js';

async function world() {
  const ctx = createTestContext();
  await seedStandardWorld(ctx.store);
  const user = (await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID))) as UserDoc;
  return { ctx, user };
}

describe('dispensing session lifecycle', () => {
  it('authorizes, sends an ON RPC and only then marks the session active', async () => {
    const { ctx, user } = await world();
    const service = new ValveService(ctx.deps);
    const result = await service.start(user);

    expect(result.session.status).toBe('active');
    expect(result.session.authorizedMl).toBe(10_000);
    expect(result.session.startedAt).not.toBeNull();
    expect(ctx.tb.calls).toHaveLength(1);
    expect(ctx.tb.calls[0]?.method).toBe('setValve');
    expect(ctx.tb.calls[0]?.params).toMatchObject({
      state: 'on',
      sessionId: result.session.sessionId,
      authorizedMl: 10_000,
      openDurationMs: 1000,
      closedGapMs: 100,
    });

    const device = await ctx.store.get<DeviceDoc>(paths.device(DEVICE_ID));
    expect(device?.activeSessionId).toBe(result.session.sessionId);
    expect(device?.valveState).toBe('opening');
    expect(ctx.hub.messages.some((entry) => entry.message.type === 'session')).toBe(true);
  });

  it('caps the authorized quantity at the configured session maximum', async () => {
    const ctx = createTestContext();
    ctx.deps.config.valve.maxAuthorizedMlPerSession = 5000;
    await seedStandardWorld(ctx.store, { balanceMl: 20_000 });
    const user = (await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID))) as UserDoc;
    const result = await new ValveService(ctx.deps).start(user);
    expect(result.session.authorizedMl).toBe(5000);
  });

  it('refuses to start without a paired device', async () => {
    const ctx = createTestContext();
    await seedUser(ctx.store, { deviceId: null });
    const user = (await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID))) as UserDoc;
    await expect(new ValveService(ctx.deps).start(user)).rejects.toMatchObject({
      code: 'no_device',
    });
  });

  it('refuses to start while the device is offline', async () => {
    const ctx = createTestContext();
    await seedStandardWorld(ctx.store, { deviceStatus: 'offline' });
    const user = (await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID))) as UserDoc;
    await expect(new ValveService(ctx.deps).start(user)).rejects.toMatchObject({
      code: 'device_offline',
    });
  });

  it('refuses to start while a previous session is unreconciled', async () => {
    const { ctx, user } = await world();
    await seedSession(ctx.store, { status: 'stopping', lastProcessedSequence: 1 });
    await expect(new ValveService(ctx.deps).start(user)).rejects.toMatchObject({
      code: 'session_unresolved',
    });
  });

  it('does not mark a session active when the device does not acknowledge', async () => {
    const ctx = createTestContext({ ackOn: false });
    await seedStandardWorld(ctx.store);
    const user = (await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID))) as UserDoc;
    await expect(new ValveService(ctx.deps).start(user)).rejects.toMatchObject({
      code: 'device_no_ack',
    });
    const sessions = await ctx.store.query<DispensingSessionDoc>('dispensingSessions', {
      filters: [{ field: 'userId', op: '==', value: CUSTOMER_UID }],
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.status).toBe('failed');
    const device = await ctx.store.get<DeviceDoc>(paths.device(DEVICE_ID));
    expect(device?.activeSessionId).toBeNull();
  });

  it('rejects an acknowledgement for a different session', async () => {
    const ctx = createTestContext({ acknowledgedSessionId: 'ses_wrong' });
    await seedStandardWorld(ctx.store);
    const user = (await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID))) as UserDoc;
    await expect(new ValveService(ctx.deps).start(user)).rejects.toMatchObject({
      code: 'device_no_ack',
    });
  });

  it('stops the valve, records the final sequence and completes reconciliation', async () => {
    const { ctx, user } = await world();
    const service = new ValveService(ctx.deps);
    const started = await service.start(user);
    const stopped = await service.stop(user);

    expect(stopped.confirmed).toBe(true);
    expect(ctx.tb.calls.at(-1)?.params).toMatchObject({
      state: 'off',
      sessionId: started.session.sessionId,
    });
    expect(stopped.session.status).toBe('completed');
    const device = await ctx.store.get<DeviceDoc>(paths.device(DEVICE_ID));
    expect(device?.activeSessionId).toBeNull();
    expect(device?.valveState).toBe('off');
  });

  it('reports unconfirmed OFF when the device does not acknowledge', async () => {
    const { ctx, user } = await world();
    const service = new ValveService(ctx.deps);
    await service.start(user);
    ctx.deps.thingsboard = {
      sendTwoWayRpc: async () => ({ success: false }),
    };
    const stopped = await service.stop(user);
    expect(stopped.confirmed).toBe(false);
    expect(stopped.message).toMatch(/unconfirmed/i);
  });

  it('reconciles a stopping session whose final event has arrived', async () => {
    const { ctx } = await world();
    await seedSession(ctx.store, {
      status: 'stopping',
      authorizedMl: 5000,
      consumedMl: 2000,
      lastProcessedSequence: 2,
    });
    await ctx.store.merge(paths.session('ses_test'), { finalSequence: 2 });
    await ctx.store.merge(paths.device(DEVICE_ID), { activeSessionId: 'ses_test' });
    const completed = await new ValveService(ctx.deps).reconcile();
    expect(completed).toBe(1);
    const session = await ctx.store.get<DispensingSessionDoc>(paths.session('ses_test'));
    expect(session?.status).toBe('completed');
    const device = await ctx.store.get<DeviceDoc>(paths.device(DEVICE_ID));
    expect(device?.activeSessionId).toBeNull();
  });

  it('can issue emergency OFF without regard to balance', async () => {
    const ctx = createTestContext();
    await seedStandardWorld(ctx.store, { balanceMl: 0, deviceStatus: 'online' });
    await seedSession(ctx.store, { status: 'active' });
    await ctx.store.merge(paths.device(DEVICE_ID), { activeSessionId: 'ses_test' });
    const result = await new ValveService(ctx.deps).emergencyOff(DEVICE_ID, 'admin-1');
    expect(result.confirmed).toBe(true);
    expect(ctx.tb.calls.at(-1)?.params).toMatchObject({ state: 'off' });
    const session = await ctx.store.get<DispensingSessionDoc>(paths.session('ses_test'));
    expect(session?.stopReason).toBe('emergency_admin_off');
  });

  it('reports failure honestly when an offline device cannot be stopped', async () => {
    const ctx = createTestContext();
    await seedStandardWorld(ctx.store);
    await seedDevice(ctx.store, { status: 'offline', lastHeartbeat: new Date(0) });
    ctx.deps.thingsboard = {
      sendTwoWayRpc: async () => {
        throw new Error('device not connected');
      },
    };
    const result = await new ValveService(ctx.deps).emergencyOff(DEVICE_ID, 'admin-1');
    expect(result.confirmed).toBe(false);
    expect(result.message).toMatch(/not be delivered/i);
  });

  it('does not permit a customer to start a device assigned to someone else', async () => {
    const ctx = createTestContext();
    await seedUser(ctx.store, { balanceMl: 5000 });
    await seedDevice(ctx.store, { assignedUserId: 'cust-2' });
    const user = (await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID))) as UserDoc;
    await expect(new ValveService(ctx.deps).start(user)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
