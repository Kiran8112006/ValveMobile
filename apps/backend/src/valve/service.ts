import type { AppDeps } from '../types/app.js';
import type {
  DeviceDoc,
  DispensingSessionDoc,
  UserDoc,
} from '../types/domain.js';
import { SESSION_UNRESOLVED } from '../types/domain.js';
import { publicDevice, publicSession } from '../types/realtime.js';
import { paths } from '../store/types.js';
import { errors } from '../utils/errors.js';
import { newId } from '../utils/ids.js';

export interface StartResult {
  session: DispensingSessionDoc;
  acknowledged: true;
}

export interface StopResult {
  confirmed: boolean;
  session: DispensingSessionDoc;
  message: string;
}

function isDeviceOnline(deps: AppDeps, device: DeviceDoc): boolean {
  if (device.status !== 'online') return false;
  if (!device.lastHeartbeat) return false;
  const age = deps.now().getTime() - device.lastHeartbeat.getTime();
  return age <= deps.config.thingsboard.offlineThresholdMs;
}

export class ValveService {
  constructor(private readonly deps: AppDeps) {}

  async start(user: UserDoc): Promise<StartResult> {
    const { store, config, now } = this.deps;
    if (!user.deviceId) {
      throw errors.conflict('no_device', 'Connect and pair your Valve device first.');
    }
    if (user.balanceMl < config.valve.minAuthorizedMl) {
      throw errors.conflict(
        'balance_too_low',
        `A minimum balance of ${config.valve.minAuthorizedMl} mL is required to start.`,
      );
    }

    const device = await store.get<DeviceDoc>(paths.device(user.deviceId));
    if (!device) throw errors.notFound('Assigned device was not found.');
    if (device.assignedUserId !== user.uid) {
      throw errors.forbidden('The assigned device belongs to another customer.');
    }
    if (!isDeviceOnline(this.deps, device)) {
      throw errors.conflict('device_offline', 'Device is offline. Cannot start dispensing.');
    }
    if (device.activeSessionId) {
      throw errors.conflict(
        'session_active',
        'A dispensing session is already active on this device.',
      );
    }

    const unresolved = await store.query<DispensingSessionDoc>('dispensingSessions', {
      filters: [
        { field: 'userId', op: '==', value: user.uid },
        { field: 'status', op: 'in', value: SESSION_UNRESOLVED },
      ],
      limit: 5,
    });
    if (unresolved.length > 0) {
      throw errors.conflict(
        'session_unresolved',
        'A previous session is still being reconciled. Try again shortly.',
        { sessionId: unresolved[0]?.sessionId },
      );
    }

    const sessionId = newId('ses');
    const commandId = newId('cmd');
    const at = now();

    const session = await store.runTransaction(async (tx) => {
      const freshUser = await tx.get<UserDoc>(paths.user(user.uid));
      if (!freshUser) throw errors.notFound('Customer profile not found.');
      if (freshUser.status !== 'active') throw errors.forbidden('Account is not active.');
      const freshDevice = await tx.get<DeviceDoc>(paths.device(user.deviceId as string));
      if (!freshDevice) throw errors.notFound('Assigned device was not found.');
      if (freshDevice.assignedUserId !== freshUser.uid) {
        throw errors.forbidden('The assigned device belongs to another customer.');
      }
      if (freshDevice.activeSessionId) {
        throw errors.conflict('session_active', 'A session already holds this device.');
      }
      const authorizedMl = Math.min(
        freshUser.balanceMl,
        config.valve.maxAuthorizedMlPerSession,
      );
      if (authorizedMl < config.valve.minAuthorizedMl) {
        throw errors.conflict('balance_too_low', 'Insufficient balance to start dispensing.');
      }

      const doc: DispensingSessionDoc = {
        sessionId,
        deviceId: freshDevice.deviceId,
        userId: freshUser.uid,
        status: 'pending',
        authorizedMl,
        consumedMl: 0,
        remainingAuthorizedMl: authorizedMl,
        lastProcessedSequence: 0,
        finalSequence: null,
        reconciled: false,
        startedAt: null,
        stoppedAt: null,
        stopReason: null,
        createdAt: at,
        updatedAt: at,
      };
      tx.set(paths.session(sessionId), { ...doc });
      tx.set(paths.device(freshDevice.deviceId), {
        ...freshDevice,
        activeSessionId: sessionId,
        updatedAt: at,
      });
      return doc;
    });

    let ack;
    try {
      ack = await this.deps.thingsboard.sendTwoWayRpc(
        device.thingsBoardDeviceUuid,
        'setValve',
        {
          state: 'on',
          sessionId,
          authorizedMl: session.authorizedMl,
          openDurationMs: config.valve.openDurationMs,
          closedGapMs: config.valve.closedGapMs,
          commandId,
        },
      );
    } catch (err) {
      await this.failPendingSession(session, 'device_rpc_failed');
      throw err;
    }

    const acknowledged =
      ack.success === true &&
      ack.sessionId === sessionId &&
      (ack.valveState === 'on' || ack.valveState === 'opening');

    if (!acknowledged) {
      await this.failPendingSession(session, 'device_no_ack');
      throw errors.upstream(
        'device_no_ack',
        'The device did not acknowledge the ON command. The valve was not reported open.',
      );
    }

    const active = await this.markActive(session.sessionId);
    const latestDevice = await this.deps.store.get<DeviceDoc>(paths.device(session.deviceId));
    if (latestDevice) {
      this.deps.hub.publishToUser(user.uid, {
        type: 'device',
        device: publicDevice(latestDevice),
      });
      this.deps.hub.publishToAdmins({ type: 'device', device: publicDevice(latestDevice) });
    }
    this.broadcastSession(active);
    return { session: active, acknowledged: true };
  }

  async stop(user: UserDoc): Promise<StopResult> {
    const { store, now } = this.deps;
    if (!user.deviceId) throw errors.conflict('no_device', 'No device is paired.');
    const device = await store.get<DeviceDoc>(paths.device(user.deviceId));
    if (!device) throw errors.notFound('Assigned device was not found.');
    const sessionId = device.activeSessionId;
    if (!sessionId) {
      throw errors.conflict('no_active_session', 'There is no active dispensing session.');
    }
    const session = await store.get<DispensingSessionDoc>(paths.session(sessionId));
    if (!session) throw errors.notFound('Active session was not found.');

    const stopping = await store.runTransaction(async (tx) => {
      const fresh = await tx.get<DispensingSessionDoc>(paths.session(sessionId));
      if (!fresh) throw errors.notFound('Active session was not found.');
      if (fresh.status === 'completed' || fresh.status === 'failed') return fresh;
      const next: DispensingSessionDoc = {
        ...fresh,
        status: 'stopping',
        stoppedAt: fresh.stoppedAt ?? now(),
        stopReason: fresh.stopReason ?? 'user_off',
        updatedAt: now(),
      };
      tx.set(paths.session(sessionId), { ...next });
      return next;
    });
    this.broadcastSession(stopping);

    const commandId = newId('cmd');
    let ack;
    try {
      ack = await this.deps.thingsboard.sendTwoWayRpc(
        device.thingsBoardDeviceUuid,
        'setValve',
        { state: 'off', sessionId, commandId, reason: 'user_off' },
      );
    } catch {
      return {
        confirmed: false,
        session: stopping,
        message:
          'OFF was requested but the device did not acknowledge. The valve fails closed when cloud connectivity is lost; state is unconfirmed.',
      };
    }

    if (ack.success !== true || ack.valveState !== 'off') {
      return {
        confirmed: false,
        session: stopping,
        message: 'The device did not confirm the OFF command. State is unconfirmed.',
      };
    }

    const finalSequence =
      typeof ack.finalSequence === 'number' && Number.isInteger(ack.finalSequence)
        ? ack.finalSequence
        : null;

    const updated = await store.runTransaction(async (tx) => {
      const fresh = await tx.get<DispensingSessionDoc>(paths.session(sessionId));
      if (!fresh) throw errors.notFound('Active session was not found.');
      if (fresh.status === 'completed') return fresh;
      const completed =
        finalSequence != null && fresh.lastProcessedSequence >= finalSequence;
      const next: DispensingSessionDoc = {
        ...fresh,
        finalSequence: finalSequence ?? fresh.finalSequence,
        status: completed ? 'completed' : 'reconciling',
        reconciled: completed,
        stoppedAt: fresh.stoppedAt ?? now(),
        updatedAt: now(),
      };
      tx.set(paths.session(sessionId), { ...next });
      if (completed) {
        const dev = await tx.get<DeviceDoc>(paths.device(fresh.deviceId));
        if (dev && dev.activeSessionId === fresh.sessionId) {
          tx.set(paths.device(dev.deviceId), {
            ...dev,
            activeSessionId: null,
            valveState: 'off',
            updatedAt: now(),
          });
        }
      }
      return next;
    });

    this.broadcastSession(updated);
    return {
      confirmed: true,
      session: updated,
      message:
        updated.status === 'completed'
          ? 'Valve closed and session reconciled.'
          : 'Valve closed. Final dispensing events are being reconciled.',
    };
  }

  async reconcile(): Promise<number> {
    const { store, now } = this.deps;
    const pending = await store.query<DispensingSessionDoc>('dispensingSessions', {
      filters: [{ field: 'status', op: 'in', value: ['active', 'stopping', 'reconciling'] }],
      limit: 100,
    });
    let completedCount = 0;
    for (const session of pending) {
      const finished =
        (session.finalSequence != null &&
          session.lastProcessedSequence >= session.finalSequence) ||
        session.remainingAuthorizedMl <= 0;
      if (!finished) continue;
      const updated = await store.runTransaction(async (tx) => {
        const fresh = await tx.get<DispensingSessionDoc>(paths.session(session.sessionId));
        if (!fresh || fresh.status === 'completed' || fresh.status === 'failed') return fresh;
        const next: DispensingSessionDoc = {
          ...fresh,
          status: 'completed',
          reconciled: true,
          finalSequence:
            fresh.finalSequence ?? Math.max(fresh.lastProcessedSequence, 1),
          stoppedAt: fresh.stoppedAt ?? now(),
          stopReason: fresh.stopReason ?? 'allowance_exhausted',
          updatedAt: now(),
        };
        tx.set(paths.session(fresh.sessionId), { ...next });
        const dev = await tx.get<DeviceDoc>(paths.device(fresh.deviceId));
        if (dev && dev.activeSessionId === fresh.sessionId) {
          tx.set(paths.device(dev.deviceId), {
            ...dev,
            activeSessionId: null,
            valveState: 'off',
            updatedAt: now(),
          });
        }
        return next;
      });
      if (updated && updated.status === 'completed') {
        completedCount += 1;
        this.broadcastSession(updated);
      }
    }
    return completedCount;
  }

  async emergencyOff(deviceId: string, actorUid: string): Promise<{
    confirmed: boolean;
    device: DeviceDoc;
    sessionId: string | null;
    message: string;
  }> {
    const { store, now } = this.deps;
    const device = await store.get<DeviceDoc>(paths.device(deviceId));
    if (!device) throw errors.notFound('Device not found.');
    const sessionId = device.activeSessionId;
    let ack;
    try {
      ack = await this.deps.thingsboard.sendTwoWayRpc(
        device.thingsBoardDeviceUuid,
        'setValve',
        {
          state: 'off',
          sessionId: sessionId ?? '',
          commandId: newId('cmd'),
          reason: `admin_emergency_off:${actorUid}`,
        },
      );
    } catch (err) {
      return {
        confirmed: false,
        device,
        sessionId,
        message: `Remote OFF could not be delivered: ${(err as Error).message}. Last known state is shown.`,
      };
    }

    const confirmed = ack.success === true && ack.valveState === 'off';
    if (sessionId) {
      const session = await store.get<DispensingSessionDoc>(paths.session(sessionId));
      if (session && session.status !== 'completed' && session.status !== 'failed') {
        await store.merge(paths.session(sessionId), {
          status: confirmed ? 'reconciling' : 'stopping',
          stopReason: 'emergency_admin_off',
          stoppedAt: session.stoppedAt ?? now(),
          finalSequence:
            typeof ack.finalSequence === 'number' ? ack.finalSequence : session.finalSequence,
          updatedAt: now(),
        });
      }
    }
    const fresh = await store.get<DeviceDoc>(paths.device(deviceId));
    const resultDevice = fresh ?? device;
    this.deps.hub.publishToAdmins({ type: 'device', device: publicDevice(resultDevice) });
    if (resultDevice.assignedUserId) {
      this.deps.hub.publishToUser(resultDevice.assignedUserId, {
        type: 'device',
        device: publicDevice(resultDevice),
      });
    }
    return {
      confirmed,
      device: resultDevice,
      sessionId,
      message: confirmed
        ? 'Emergency OFF confirmed by the device.'
        : 'Emergency OFF was sent but not confirmed by the device.',
    };
  }

  async currentSession(user: UserDoc): Promise<DispensingSessionDoc | null> {
    const { store } = this.deps;
    if (user.deviceId) {
      const device = await store.get<DeviceDoc>(paths.device(user.deviceId));
      if (device?.activeSessionId) {
        const session = await store.get<DispensingSessionDoc>(
          paths.session(device.activeSessionId),
        );
        if (session) return session;
      }
    }
    const unresolved = await store.query<DispensingSessionDoc>('dispensingSessions', {
      filters: [
        { field: 'userId', op: '==', value: user.uid },
        { field: 'status', op: 'in', value: SESSION_UNRESOLVED },
      ],
      orderBy: { field: 'createdAt', direction: 'desc' },
      limit: 1,
    });
    return unresolved[0] ?? null;
  }

  private broadcastSession(session: DispensingSessionDoc): void {
    const message = { type: 'session' as const, session: publicSession(session) };
    this.deps.hub.publishToUser(session.userId, message);
    this.deps.hub.publishToAdmins(message);
  }

  private async markActive(sessionId: string): Promise<DispensingSessionDoc> {
    const { store, now } = this.deps;
    return store.runTransaction(async (tx) => {
      const fresh = await tx.get<DispensingSessionDoc>(paths.session(sessionId));
      if (!fresh) throw errors.notFound('Session not found.');
      const next: DispensingSessionDoc = {
        ...fresh,
        status: 'active',
        startedAt: fresh.startedAt ?? now(),
        updatedAt: now(),
      };
      tx.set(paths.session(sessionId), { ...next });
      const dev = await tx.get<DeviceDoc>(paths.device(fresh.deviceId));
      if (dev) {
        tx.set(paths.device(dev.deviceId), {
          ...dev,
          valveState: 'opening',
          updatedAt: now(),
        });
      }
      return next;
    });
  }

  private async failPendingSession(
    session: DispensingSessionDoc,
    reason: string,
  ): Promise<void> {
    const { store, now } = this.deps;
    await store.runTransaction(async (tx) => {
      const fresh = await tx.get<DispensingSessionDoc>(paths.session(session.sessionId));
      if (fresh && fresh.status === 'pending') {
        tx.set(paths.session(session.sessionId), {
          ...fresh,
          status: 'failed',
          stopReason: reason,
          stoppedAt: now(),
          reconciled: true,
          updatedAt: now(),
        });
      }
      const dev = await tx.get<DeviceDoc>(paths.device(session.deviceId));
      if (dev && dev.activeSessionId === session.sessionId) {
        tx.set(paths.device(dev.deviceId), {
          ...dev,
          activeSessionId: null,
          valveState: 'unknown',
          updatedAt: now(),
        });
      }
    });
    const dev = await store.get<DeviceDoc>(paths.device(session.deviceId));
    if (dev) {
      this.deps.hub.publishToUser(session.userId, {
        type: 'device',
        device: publicDevice(dev),
      });
      this.deps.hub.publishToAdmins({ type: 'device', device: publicDevice(dev) });
    }
    this.broadcastSession({
      ...session,
      status: 'failed',
      stopReason: reason,
      stoppedAt: now(),
    });
  }
}
