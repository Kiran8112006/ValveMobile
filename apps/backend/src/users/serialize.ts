import type { DeviceDoc, UserDoc } from '../types/domain.js';
import { publicDevice } from '../types/realtime.js';

export function serializeUser(user: UserDoc) {
  return {
    uid: user.uid,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    status: user.status,
    balanceMl: user.balanceMl,
    balanceLitres: (user.balanceMl / 1000).toFixed(2),
    totalEstimatedDispensedMl: user.totalEstimatedDispensedMl,
    totalEstimatedDispensedLitres: (user.totalEstimatedDispensedMl / 1000).toFixed(2),
    deviceId: user.deviceId,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function serializeDevice(device: DeviceDoc) {
  return publicDevice(device);
}
