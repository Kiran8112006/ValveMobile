import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DeviceDoc, DispensingEventType, SessionStatus, ValveState } from '../types/domain.js';
import { paths } from '../store/types.js';
import { errors } from '../utils/errors.js';
import { safeEqual } from '../utils/security.js';
import { processDispensingEvent } from '../metering/accounting.js';
import { publicDevice, publicSession } from '../types/realtime.js';
import type { DispensingSessionDoc } from '../types/domain.js';

const bodySchema = z
  .object({
    originatorId: z.string().min(1).optional(),
    thingsBoardDeviceUuid: z.string().min(1).optional(),
    deviceUuid: z.string().min(1).optional(),
    eventType: z.string().min(1),
    telemetry: z.record(z.unknown()).optional(),
  })
  .passthrough();

const consumptionSchema = z.object({
  sessionId: z.string().min(1).max(160),
  eventId: z.string().min(3).max(160),
  sequence: z.coerce.number().int().positive(),
  quantityMl: z.coerce.number().int().positive(),
  valveOpenDurationMs: z.coerce.number().int().positive(),
  type: z.enum(['full_cycle', 'partial_cycle']),
  final: z.coerce.boolean().optional(),
  stopReason: z.string().max(80).nullable().optional(),
  bootId: z.string().max(64).nullable().optional(),
});

const VALVE_STATES: ValveState[] = ['off', 'opening', 'closed', 'unknown'];

function mapValveState(value: unknown): ValveState {
  return typeof value === 'string' && (VALVE_STATES as string[]).includes(value)
    ? (value as ValveState)
    : 'unknown';
}

/**
 * ThingsBoard Rule Engine telemetry webhook.
 *
 * Security: shared secret header (constant-time compare), device identity
 * resolved from the trusted device record, user ID and balance never accepted
 * from the payload, event IDs idempotent, sequence strictly ordered.
 */
export async function thingsboardWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/webhooks/thingsboard/telemetry',
    { bodyLimit: 16 * 1024 },
    async (request, reply) => {
      const deps = app.deps;
      const provided = request.headers['x-valve-webhook-secret'];
      if (typeof provided !== 'string' || !safeEqual(provided, deps.config.thingsboard.webhookSecret)) {
        throw errors.unauthorized('Invalid webhook secret.');
      }

      const body = bodySchema.parse(request.body ?? {}) as z.infer<typeof bodySchema> & Record<string, unknown>;
      const flat: Record<string, unknown> = { ...body.telemetry, ...body };
      const uuidCandidate =
        (typeof body.originatorId === 'string' && body.originatorId) ||
        (typeof body.thingsBoardDeviceUuid === 'string' && body.thingsBoardDeviceUuid) ||
        (typeof body.deviceUuid === 'string' && body.deviceUuid) ||
        '';
      if (!uuidCandidate) {
        throw errors.badRequest('missing_device_identity', 'originatorId is required.');
      }

      const devices = await deps.store.query<DeviceDoc>('devices', {
        filters: [{ field: 'thingsBoardDeviceUuid', op: '==', value: uuidCandidate }],
        limit: 1,
      });
      const device = devices[0];
      if (!device) {
        throw errors.forbidden('Telemetry device is not registered.');
      }

      switch (body.eventType) {
        case 'consumption_event':
          return handleConsumption(app, device, flat, reply);
        case 'heartbeat':
        case 'state':
          return handleHeartbeat(app, device, flat);
        default:
          throw errors.badRequest('unsupported_event_type', `Unsupported eventType: ${body.eventType}`);
      }
    },
  );
}

async function handleHeartbeat(
  app: FastifyInstance,
  device: DeviceDoc,
  flat: Record<string, unknown>,
) {
  const deps = app.deps;
  const now = deps.now();
  const valveState = mapValveState(flat.valveState);
  const relayState =
    flat.relayState === 'on' || flat.relayState === true
      ? 'on'
      : flat.relayState === 'off' || flat.relayState === false
        ? 'off'
        : 'unknown';
  const wifiRssi =
    typeof flat.wifiRssi === 'number' && Number.isFinite(flat.wifiRssi)
      ? Math.round(flat.wifiRssi)
      : null;
  const firmwareVersion =
    typeof flat.firmwareVersion === 'string' ? flat.firmwareVersion.slice(0, 40) : null;

  await deps.store.merge(paths.device(device.deviceId), {
    status: 'online',
    lastHeartbeat: now,
    valveState,
    relayState,
    wifiRssi,
    firmwareVersion: firmwareVersion ?? device.firmwareVersion,
    updatedAt: now,
  });
  const updated: DeviceDoc = {
    ...device,
    status: 'online',
    lastHeartbeat: now,
    valveState,
    relayState,
    wifiRssi,
    firmwareVersion: firmwareVersion ?? device.firmwareVersion,
  };

  // A device that lost the cloud link during dispensing closes its valve and
  // reports the aborted session so the backend can reconcile it, even when no
  // water had flowed yet. No water is deducted here.
  const abortedSessionId =
    typeof flat.abortedSessionId === 'string' ? flat.abortedSessionId : '';
  if (abortedSessionId) {
    const session = await deps.store.get<DispensingSessionDoc>(
      paths.session(abortedSessionId),
    );
    if (
      session &&
      session.deviceId === device.deviceId &&
      session.status !== 'completed' &&
      session.status !== 'failed'
    ) {
      const reportedFinal = Number(flat.finalSequence);
      const finalSequence = Number.isInteger(reportedFinal)
        ? reportedFinal
        : session.finalSequence;
      const completed =
        finalSequence != null && session.lastProcessedSequence >= finalSequence;
      const reconciledSession: DispensingSessionDoc = {
        ...session,
        finalSequence,
        status: completed ? 'completed' : 'reconciling',
        reconciled: completed,
        stoppedAt: session.stoppedAt ?? now,
        stopReason:
          session.stopReason ??
          (typeof flat.stopReason === 'string' ? flat.stopReason : 'device_aborted'),
        updatedAt: now,
      };
      await deps.store.set(paths.session(session.sessionId), {
        ...reconciledSession,
      });
      if (completed) {
        await deps.store.merge(paths.device(device.deviceId), {
          activeSessionId: null,
          valveState: 'off',
          updatedAt: now,
        });
        updated.activeSessionId = null;
        updated.valveState = 'off';
      }
      const sessionMessage = {
        type: 'session' as const,
        session: publicSession(reconciledSession),
      };
      deps.hub.publishToUser(reconciledSession.userId, sessionMessage);
      deps.hub.publishToAdmins(sessionMessage);
    }
  }
  deps.hub.publishToAdmins({ type: 'device', device: publicDevice(updated) });
  if (device.assignedUserId) {
    deps.hub.publishToUser(device.assignedUserId, {
      type: 'device',
      device: publicDevice(updated),
    });
  }
  return { ok: true, deviceId: device.deviceId, status: 'online' };
}

async function handleConsumption(
  app: FastifyInstance,
  device: DeviceDoc,
  flat: Record<string, unknown>,
  reply: import('fastify').FastifyReply,
) {
  const deps = app.deps;
  if (!device.assignedUserId) {
    throw errors.conflict('device_unassigned', 'Device is not assigned to a customer.');
  }
  const parsed = consumptionSchema.safeParse(flat);
  if (!parsed.success) {
    throw errors.badRequest(
      'invalid_consumption_event',
      parsed.error.issues.map((issue) => issue.message).join('; '),
    );
  }
  const data = parsed.data;

  const result = await processDispensingEvent(deps, {
    deviceId: device.deviceId,
    thingsBoardDeviceUuid: device.thingsBoardDeviceUuid,
    sessionId: data.sessionId,
    userId: device.assignedUserId,
    eventId: data.eventId,
    sequence: data.sequence,
    quantityMl: data.quantityMl,
    valveOpenDurationMs: data.valveOpenDurationMs,
    type: data.type as DispensingEventType,
    final: data.final === true,
    stopReason: data.stopReason ?? null,
    bootId: data.bootId ?? null,
  });

  const at = deps.now();
  deps.hub.publishToUser(result.userId, {
    type: 'dispensing',
    eventId: result.eventId,
    sessionId: result.sessionId,
    quantityMl: result.quantityMl,
    consumedMl: result.consumedMl,
    remainingAuthorizedMl: result.remainingAuthorizedMl,
    balanceMl: result.balanceMl,
    sequence: result.sequence,
    at: at.toISOString(),
  });
  deps.hub.publishToUser(result.userId, {
    type: 'balance',
    balanceMl: result.balanceMl,
    totalEstimatedDispensedMl: result.totalEstimatedDispensedMl,
    updatedAt: at.toISOString(),
  });

  const session = await deps.store.get<DispensingSessionDoc>(paths.session(result.sessionId));
  if (session) {
    const message = { type: 'session' as const, session: publicSession(session) };
    deps.hub.publishToUser(result.userId, message);
    deps.hub.publishToAdmins(message);
  }
  deps.hub.publishToAdmins({
    type: 'dispensing',
    eventId: result.eventId,
    sessionId: result.sessionId,
    quantityMl: result.quantityMl,
    consumedMl: result.consumedMl,
    remainingAuthorizedMl: result.remainingAuthorizedMl,
    balanceMl: result.balanceMl,
    sequence: result.sequence,
    at: at.toISOString(),
  });

  // Acknowledge only after the Firestore transaction has committed. If this
  // RPC fails the device keeps the event queued and retries with the same ID;
  // the duplicate path re-sends this acknowledgement without deducting again.
  try {
    await deps.thingsboard.sendTwoWayRpc(device.thingsBoardDeviceUuid, 'ackConsumptionEvent', {
      eventId: result.eventId,
      sessionId: result.sessionId,
      sequence: result.sequence,
      success: true,
      duplicate: result.duplicate,
      balanceAfterMl: result.balanceMl,
      sessionCompleted: result.sessionCompleted,
    });
  } catch (err) {
    app.log.warn(
      { deviceId: device.deviceId, eventId: result.eventId, err: (err as Error).message },
      'Event committed but device acknowledgement RPC failed',
    );
  }

  reply.code(200);
  return {
    ok: true,
    duplicate: result.duplicate,
    eventId: result.eventId,
    sessionId: result.sessionId,
    sequence: result.sequence,
    balanceMl: result.balanceMl,
    consumedMl: result.consumedMl,
    remainingAuthorizedMl: result.remainingAuthorizedMl,
    sessionStatus: result.sessionStatus as SessionStatus,
  };
}
