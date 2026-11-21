import type { DispensingSessionDoc, DeviceDoc, RechargeOrderDoc } from './domain.js';

export type RealtimeMessage =
  | {
      type: 'ready';
      serverTime: string;
    }
  | {
      type: 'balance';
      balanceMl: number;
      totalEstimatedDispensedMl: number;
      updatedAt: string;
    }
  | {
      type: 'session';
      session: PublicSession | null;
    }
  | {
      type: 'dispensing';
      eventId: string;
      sessionId: string | null;
      quantityMl: number;
      consumedMl: number;
      remainingAuthorizedMl: number;
      balanceMl: number;
      sequence: number;
      at: string;
    }
  | {
      type: 'device';
      device: PublicDevice;
    }
  | {
      type: 'payment';
      order: PublicOrder;
    }
  | {
      type: 'error';
      code: string;
      message: string;
    };

export interface PublicSession {
  sessionId: string;
  deviceId: string;
  status: DispensingSessionDoc['status'];
  authorizedMl: number;
  consumedMl: number;
  remainingAuthorizedMl: number;
  lastProcessedSequence: number;
  finalSequence: number | null;
  startedAt: string | null;
  stoppedAt: string | null;
  stopReason: string | null;
}

export interface PublicDevice {
  deviceId: string;
  deviceName: string;
  status: DeviceDoc['status'];
  valveState: DeviceDoc['valveState'];
  relayState: DeviceDoc['relayState'];
  lastHeartbeat: string | null;
  firmwareVersion: string | null;
  wifiRssi: number | null;
  assignedUserId: string | null;
  activeSessionId: string | null;
}

export interface PublicOrder {
  orderId: string;
  userId: string;
  quantityMl: number;
  amountPaise: number;
  status: RechargeOrderDoc['status'];
  createdAt: string;
  paidAt: string | null;
  creditedAt: string | null;
}

export function publicSession(session: DispensingSessionDoc): PublicSession {
  return {
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    status: session.status,
    authorizedMl: session.authorizedMl,
    consumedMl: session.consumedMl,
    remainingAuthorizedMl: session.remainingAuthorizedMl,
    lastProcessedSequence: session.lastProcessedSequence,
    finalSequence: session.finalSequence,
    startedAt: session.startedAt ? session.startedAt.toISOString() : null,
    stoppedAt: session.stoppedAt ? session.stoppedAt.toISOString() : null,
    stopReason: session.stopReason,
  };
}

export function publicDevice(device: DeviceDoc): PublicDevice {
  return {
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    status: device.status,
    valveState: device.valveState,
    relayState: device.relayState,
    lastHeartbeat: device.lastHeartbeat ? device.lastHeartbeat.toISOString() : null,
    firmwareVersion: device.firmwareVersion,
    wifiRssi: device.wifiRssi,
    assignedUserId: device.assignedUserId,
    activeSessionId: device.activeSessionId,
  };
}

export function publicOrder(order: RechargeOrderDoc): PublicOrder {
  return {
    orderId: order.orderId,
    userId: order.userId,
    quantityMl: order.quantityMl,
    amountPaise: order.amountPaise,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    creditedAt: order.creditedAt ? order.creditedAt.toISOString() : null,
  };
}
