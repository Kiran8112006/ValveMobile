import { describe, expect, it } from 'vitest';
import { processDispensingEvent, type DispensingEventInput } from '../src/metering/accounting.js';
import { ApiError } from '../src/utils/errors.js';
import { paths } from '../src/store/types.js';
import type { DispensingSessionDoc, UserDoc } from '../src/types/domain.js';
import {
  createTestContext,
  DEVICE_ID,
  CUSTOMER_UID,
  seedDevice,
  seedSession,
  seedStandardWorld,
  TB_UUID,
} from './helpers.js';

function event(overrides: Partial<DispensingEventInput> = {}): DispensingEventInput {
  return {
    deviceId: DEVICE_ID,
    thingsBoardDeviceUuid: TB_UUID,
    sessionId: 'ses_test',
    userId: CUSTOMER_UID,
    eventId: 'evt-0001',
    sequence: 1,
    quantityMl: 1000,
    valveOpenDurationMs: 1000,
    type: 'full_cycle',
    final: false,
    stopReason: null,
    bootId: 'boot-a',
    ...overrides,
  };
}

async function setup(balanceMl = 10_000, authorizedMl = 10_000) {
  const ctx = createTestContext();
  await seedStandardWorld(ctx.store, { balanceMl });
  await seedSession(ctx.store, { authorizedMl });
  await ctx.store.merge(paths.device(DEVICE_ID), { activeSessionId: 'ses_test' });
  return ctx;
}

describe('estimated water accounting', () => {
  it('starts customers at zero balance (default registration model)', async () => {
    const ctx = createTestContext();
    await seedStandardWorld(ctx.store, { balanceMl: 0 });
    const user = await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID));
    expect(user?.balanceMl).toBe(0);
  });

  it('deducts exactly 1000 mL for one completed one-second cycle', async () => {
    const ctx = await setup();
    const result = await processDispensingEvent(ctx.deps, event());
    expect(result.duplicate).toBe(false);
    expect(result.quantityMl).toBe(1000);
    expect(result.balanceMl).toBe(9000);
    expect(result.consumedMl).toBe(1000);
    expect(result.remainingAuthorizedMl).toBe(9000);

    const user = await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID));
    expect(user?.balanceMl).toBe(9000);
    expect(user?.totalEstimatedDispensedMl).toBe(1000);
    const ledger = await ctx.store.query('transactions', {
      filters: [{ field: 'userId', op: '==', value: CUSTOMER_UID }],
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ type: 'consumption', deltaMl: -1000, balanceAfterMl: 9000 });
  });

  it('deducts proportional millilitres for interrupted partial cycles', async () => {
    const ctx = await setup();
    const result = await processDispensingEvent(
      ctx.deps,
      event({
        eventId: 'evt-partial-250',
        quantityMl: 250,
        valveOpenDurationMs: 250,
        type: 'partial_cycle',
        final: true,
        stopReason: 'user_off',
      }),
    );
    expect(result.balanceMl).toBe(9750);
    expect(result.sessionCompleted).toBe(true);
    const session = await ctx.store.get<DispensingSessionDoc>(paths.session('ses_test'));
    expect(session?.consumedMl).toBe(250);
    expect(session?.status).toBe('completed');
    const device = await ctx.store.get<{ activeSessionId: string | null }>(
      paths.device(DEVICE_ID),
    );
    expect(device?.activeSessionId).toBeNull();
  });

  it('supports multiple sequential cycles up to the allowance', async () => {
    const ctx = await setup(5000, 3000);
    await processDispensingEvent(ctx.deps, event({ eventId: 'evt-a', sequence: 1 }));
    await processDispensingEvent(
      ctx.deps,
      event({ eventId: 'evt-b', sequence: 2 }),
    );
    const third = await processDispensingEvent(
      ctx.deps,
      event({ eventId: 'evt-c', sequence: 3 }),
    );
    expect(third.balanceMl).toBe(2000);
    expect(third.sessionCompleted).toBe(true);
    expect(third.remainingAuthorizedMl).toBe(0);
  });

  it('never allows a negative balance', async () => {
    const ctx = await setup(500, 10_000);
    await expect(processDispensingEvent(ctx.deps, event())).rejects.toMatchObject({
      code: 'insufficient_balance',
    });
    const user = await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID));
    expect(user?.balanceMl).toBe(500);
  });

  it('rejects events above the remaining session allowance', async () => {
    const ctx = await setup(10_000, 500);
    await expect(processDispensingEvent(ctx.deps, event())).rejects.toMatchObject({
      code: 'allowance_exceeded',
    });
  });

  it('never deducts twice for a duplicate event ID', async () => {
    const ctx = await setup();
    const first = await processDispensingEvent(ctx.deps, event());
    const duplicate = await processDispensingEvent(ctx.deps, event());
    expect(first.balanceMl).toBe(9000);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.balanceMl).toBe(9000);
    const user = await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID));
    expect(user?.balanceMl).toBe(9000);
  });

  it('is safe when the same event is processed concurrently', async () => {
    const ctx = await setup();
    const results = await Promise.all([
      processDispensingEvent(ctx.deps, event()),
      processDispensingEvent(ctx.deps, event()),
    ]);
    expect(results.filter((entry) => entry.duplicate === true)).toHaveLength(1);
    const user = await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID));
    expect(user?.balanceMl).toBe(9000);
  });

  it('rejects an out-of-order sequence without deducting', async () => {
    const ctx = await setup();
    await expect(
      processDispensingEvent(ctx.deps, event({ eventId: 'evt-seq-2', sequence: 2 })),
    ).rejects.toMatchObject({ code: 'sequence_out_of_order' });
    const user = await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID));
    expect(user?.balanceMl).toBe(10_000);
  });

  it('rejects a quantity that does not equal measured energized time', async () => {
    const ctx = await setup();
    await expect(
      processDispensingEvent(
        ctx.deps,
        event({ quantityMl: 500, valveOpenDurationMs: 1000, type: 'full_cycle' }),
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('rejects a device/user pairing that does not match the trusted record', async () => {
    const ctx = createTestContext();
    await seedStandardWorld(ctx.store);
    await seedSession(ctx.store, { userId: 'cust-2' });
    await expect(processDispensingEvent(ctx.deps, event())).rejects.toMatchObject({
      code: 'session_mismatch',
    });
  });

  it('rejects telemetry from a device whose UUID does not match', async () => {
    const ctx = await setup();
    await expect(
      processDispensingEvent(ctx.deps, event({ thingsBoardDeviceUuid: 'tb-other' })),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects events for a session that is already closed', async () => {
    const ctx = createTestContext();
    await seedStandardWorld(ctx.store);
    await seedSession(ctx.store, { status: 'completed', lastProcessedSequence: 4 });
    await expect(
      processDispensingEvent(ctx.deps, event({ eventId: 'evt-late', sequence: 5 })),
    ).rejects.toMatchObject({ code: 'session_closed' });
  });

  it('marks the session completed when the final event arrives', async () => {
    const ctx = await setup(10_000, 10_000);
    const result = await processDispensingEvent(
      ctx.deps,
      event({ eventId: 'evt-final', quantityMl: 500, valveOpenDurationMs: 500, type: 'partial_cycle', final: true, stopReason: 'user_off' }),
    );
    expect(result.sessionCompleted).toBe(true);
    expect(result.sessionStatus).toBe('completed');
    const session = await ctx.store.get<DispensingSessionDoc>(paths.session('ses_test'));
    expect(session?.reconciled).toBe(true);
    expect(session?.stopReason).toBe('user_off');
  });

  it('keeps an event from being reused by a different session', async () => {
    const ctx = await setup();
    await processDispensingEvent(ctx.deps, event());
    await seedSession(ctx.store, { sessionId: 'ses_other', lastProcessedSequence: 0 });
    await expect(
      processDispensingEvent(
        ctx.deps,
        event({ sessionId: 'ses_other', eventId: 'evt-0001' }),
      ),
    ).rejects.toMatchObject({ code: 'event_conflict' });
  });

  it('does not allow a device to be reassigned mid-accounting', async () => {
    const ctx = createTestContext();
    await seedStandardWorld(ctx.store);
    await seedSession(ctx.store);
    await seedDevice(ctx.store, { assignedUserId: 'cust-2' });
    await expect(processDispensingEvent(ctx.deps, event())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
