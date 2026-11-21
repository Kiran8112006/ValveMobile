import type { AppDeps } from '../types/app.js';
import type {
  DeviceDoc,
  DispensingEventDoc,
  DispensingEventType,
  DispensingSessionDoc,
  UserDoc,
} from '../types/domain.js';
import { paths } from '../store/types.js';
import { errors } from '../utils/errors.js';
import { newId } from '../utils/ids.js';

export interface DispensingEventInput {
  deviceId: string;
  thingsBoardDeviceUuid: string;
  sessionId: string;
  userId: string;
  eventId: string;
  sequence: number;
  quantityMl: number;
  valveOpenDurationMs: number;
  type: DispensingEventType;
  final: boolean;
  stopReason: string | null;
  bootId: string | null;
}

export interface AccountingResult {
  duplicate: boolean;
  eventId: string;
  userId: string;
  deviceId: string;
  sessionId: string;
  sequence: number;
  quantityMl: number;
  balanceMl: number;
  totalEstimatedDispensedMl: number;
  consumedMl: number;
  remainingAuthorizedMl: number;
  sessionStatus: DispensingSessionDoc['status'];
  sessionCompleted: boolean;
}

const EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{3,160}$/;

/**
 * Validate a telemetry event before any database work. Quantity is derived
 * from measured relay-energized milliseconds at a ratio of 1 mL per 1 ms
 * (1000 ms = 1000 mL = 1 L). The device reports actual time; this check keeps
 * a malformed or spoofed event from inventing water.
 */
export function validateEventInput(
  deps: AppDeps,
  input: DispensingEventInput,
): void {
  if (!EVENT_ID_PATTERN.test(input.eventId)) {
    throw errors.badRequest('invalid_event_id', 'Event ID format is invalid.');
  }
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw errors.badRequest('invalid_sequence', 'Sequence must be a positive integer.');
  }
  if (!Number.isInteger(input.quantityMl) || input.quantityMl <= 0) {
    throw errors.badRequest('invalid_quantity', 'Quantity must be a positive integer (mL).');
  }
  if (!Number.isInteger(input.valveOpenDurationMs) || input.valveOpenDurationMs <= 0) {
    throw errors.badRequest('invalid_duration', 'Valve open duration must be a positive integer.');
  }
  if (input.quantityMl !== input.valveOpenDurationMs) {
    throw errors.badRequest(
      'quantity_duration_mismatch',
      'Estimated quantity must equal measured relay-energized milliseconds.',
    );
  }
  const openDuration = deps.config.valve.openDurationMs;
  if (input.valveOpenDurationMs > openDuration + 250) {
    throw errors.badRequest(
      'duration_exceeds_cycle',
      `Valve open duration exceeds the configured cycle (${openDuration} ms).`,
    );
  }
  if (input.type === 'full_cycle' && input.valveOpenDurationMs < Math.floor(openDuration * 0.8)) {
    throw errors.badRequest(
      'invalid_full_cycle',
      'A full cycle must reflect approximately the configured open duration.',
    );
  }
  if (input.type === 'partial_cycle' && input.valveOpenDurationMs > openDuration) {
    throw errors.badRequest(
      'invalid_partial_cycle',
      'A partial cycle cannot exceed the configured open duration.',
    );
  }
}

/**
 * Apply one dispensing event exactly once, atomically.
 *
 * Reads happen before writes so this function is safe inside a Firestore
 * transaction. A duplicate event ID never deducts water twice.
 */
export async function processDispensingEvent(
  deps: AppDeps,
  input: DispensingEventInput,
): Promise<AccountingResult> {
  validateEventInput(deps, input);
  const at = deps.now();

  return deps.store.runTransaction(async (tx) => {
    const device = await tx.get<DeviceDoc>(paths.device(input.deviceId));
    if (!device) throw errors.notFound('Unknown device.');
    if (device.thingsBoardDeviceUuid !== input.thingsBoardDeviceUuid) {
      throw errors.forbidden('Telemetry device identity does not match the device record.');
    }

    const session = await tx.get<DispensingSessionDoc>(paths.session(input.sessionId));
    if (!session) throw errors.notFound('Unknown dispensing session.');
    if (session.deviceId !== device.deviceId || session.userId !== input.userId) {
      throw errors.conflict(
        'session_mismatch',
        'Event does not belong to this device/session pairing.',
      );
    }

    const user = await tx.get<UserDoc>(paths.user(session.userId));
    if (!user) throw errors.notFound('Unknown customer for this session.');
    if (device.assignedUserId !== user.uid) {
      throw errors.forbidden('Device is not assigned to this customer.');
    }

    const existing = await tx.get<DispensingEventDoc>(paths.event(input.eventId));
    if (existing) {
      if (existing.sessionId !== session.sessionId) {
        throw errors.conflict('event_conflict', 'Event ID already used by another session.');
      }
      return {
        duplicate: true,
        eventId: input.eventId,
        userId: user.uid,
        deviceId: device.deviceId,
        sessionId: session.sessionId,
        sequence: existing.sequence,
        quantityMl: existing.quantityMl,
        balanceMl: user.balanceMl,
        totalEstimatedDispensedMl: user.totalEstimatedDispensedMl,
        consumedMl: session.consumedMl,
        remainingAuthorizedMl: session.remainingAuthorizedMl,
        sessionStatus: session.status,
        sessionCompleted: session.status === 'completed',
      };
    }

    if (session.status === 'completed' || session.status === 'failed') {
      throw errors.conflict(
        'session_closed',
        `Session is already ${session.status}; the event cannot be applied.`,
      );
    }

    const expectedSequence = session.lastProcessedSequence + 1;
    if (input.sequence !== expectedSequence) {
      throw errors.conflict(
        'sequence_out_of_order',
        `Expected sequence ${expectedSequence}, received ${input.sequence}.`,
        { expectedSequence },
      );
    }

    const remainingBefore = session.authorizedMl - session.consumedMl;
    if (remainingBefore <= 0) {
      throw errors.conflict('allowance_exhausted', 'Session allowance is already exhausted.');
    }
    if (input.quantityMl > remainingBefore) {
      throw errors.conflict(
        'allowance_exceeded',
        'Event quantity exceeds the remaining authorized allowance.',
        { remainingBefore },
      );
    }
    if (input.quantityMl > user.balanceMl) {
      throw errors.conflict('insufficient_balance', 'Customer balance cannot cover this event.');
    }

    const balanceAfter = user.balanceMl - input.quantityMl;
    const consumedMl = session.consumedMl + input.quantityMl;
    const remainingAuthorizedMl = session.authorizedMl - consumedMl;
    const sessionCompleted = input.final || remainingAuthorizedMl <= 0;
    const sessionStatus: DispensingSessionDoc['status'] = sessionCompleted
      ? 'completed'
      : session.status === 'pending'
        ? 'active'
        : session.status;

    tx.set(paths.user(user.uid), {
      ...user,
      balanceMl: balanceAfter,
      totalEstimatedDispensedMl: user.totalEstimatedDispensedMl + input.quantityMl,
      updatedAt: at,
    });

    tx.set(paths.session(session.sessionId), {
      ...session,
      status: sessionStatus,
      consumedMl,
      remainingAuthorizedMl,
      lastProcessedSequence: input.sequence,
      finalSequence: sessionCompleted
        ? Math.max(session.finalSequence ?? input.sequence, input.sequence)
        : session.finalSequence,
      reconciled: sessionCompleted,
      stoppedAt: sessionCompleted ? (session.stoppedAt ?? at) : session.stoppedAt,
      stopReason: sessionCompleted
        ? (input.stopReason ?? session.stopReason ?? 'allowance_exhausted')
        : session.stopReason,
      updatedAt: at,
    });

    if (sessionCompleted && device.activeSessionId === session.sessionId) {
      tx.set(paths.device(device.deviceId), {
        ...device,
        activeSessionId: null,
        valveState: 'off',
        updatedAt: at,
      });
    }

    const eventDoc: DispensingEventDoc = {
      eventId: input.eventId,
      sessionId: session.sessionId,
      deviceId: device.deviceId,
      userId: user.uid,
      sequence: input.sequence,
      quantityMl: input.quantityMl,
      type: input.type,
      valveOpenDurationMs: input.valveOpenDurationMs,
      processedAt: at,
      balanceAfterMl: balanceAfter,
      status: 'processed',
      stopReason: input.stopReason,
      bootId: input.bootId,
    };
    tx.set(paths.event(input.eventId), { ...eventDoc });

    const transactionId = newId('txn');
    tx.set(paths.transaction(transactionId), {
      transactionId,
      userId: user.uid,
      type: 'consumption',
      deltaMl: -input.quantityMl,
      balanceAfterMl: balanceAfter,
      referenceId: input.eventId,
      description: `Estimated water dispensed: ${input.quantityMl} mL (${input.type.replace('_', ' ')})`,
      createdAt: at,
      createdBy: 'device',
    });

    return {
      duplicate: false,
      eventId: input.eventId,
      userId: user.uid,
      deviceId: device.deviceId,
      sessionId: session.sessionId,
      sequence: input.sequence,
      quantityMl: input.quantityMl,
      balanceMl: balanceAfter,
      totalEstimatedDispensedMl: user.totalEstimatedDispensedMl + input.quantityMl,
      consumedMl,
      remainingAuthorizedMl,
      sessionStatus,
      sessionCompleted,
    };
  });
}
