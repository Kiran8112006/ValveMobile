/**
 * Domain model for Valve.
 *
 * All water quantities are integer millilitres (mL).
 * All money amounts are integer paise.
 * Timestamps are stored as Date objects via the Admin SDK (Firestore Timestamp).
 */

export type Role = 'customer' | 'admin';
export type UserStatus = 'active' | 'disabled';
export type DeviceStatus = 'unknown' | 'online' | 'offline';
export type ValveState = 'off' | 'opening' | 'closed' | 'unknown';
export type RelayState = 'on' | 'off' | 'unknown';
export type SessionStatus =
  | 'pending'
  | 'active'
  | 'stopping'
  | 'reconciling'
  | 'completed'
  | 'failed';
export type DispensingEventType = 'full_cycle' | 'partial_cycle';
export type TransactionType = 'recharge' | 'cash_credit' | 'consumption' | 'adjustment';
export type RechargeOrderStatus = 'created' | 'pending' | 'paid' | 'failed' | 'refunded';
export type PaymentStatus = 'created' | 'captured' | 'failed' | 'refunded';

export const SESSION_UNRESOLVED: SessionStatus[] = [
  'pending',
  'active',
  'stopping',
  'reconciling',
];

export interface UserDoc {
  uid: string;
  fullName: string;
  email: string;
  role: Role;
  status: UserStatus;
  balanceMl: number;
  totalEstimatedDispensedMl: number;
  deviceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeviceDoc {
  deviceId: string;
  thingsBoardDeviceUuid: string;
  deviceName: string;
  hardwareModel: string;
  assignedUserId: string | null;
  status: DeviceStatus;
  valveState: ValveState;
  lastHeartbeat: Date | null;
  firmwareVersion: string | null;
  relayState: RelayState;
  activeSessionId: string | null;
  wifiRssi: number | null;
  /** SHA-256 hex of the one-time claim code. Never the code itself. */
  claimCodeHash: string | null;
  claimUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DispensingSessionDoc {
  sessionId: string;
  deviceId: string;
  userId: string;
  status: SessionStatus;
  authorizedMl: number;
  consumedMl: number;
  remainingAuthorizedMl: number;
  lastProcessedSequence: number;
  finalSequence: number | null;
  reconciled: boolean;
  startedAt: Date | null;
  stoppedAt: Date | null;
  stopReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DispensingEventDoc {
  eventId: string;
  sessionId: string;
  deviceId: string;
  userId: string;
  sequence: number;
  quantityMl: number;
  type: DispensingEventType;
  valveOpenDurationMs: number;
  processedAt: Date;
  balanceAfterMl: number;
  status: 'processed';
  stopReason: string | null;
  bootId: string | null;
}

export interface TransactionDoc {
  transactionId: string;
  userId: string;
  type: TransactionType;
  deltaMl: number;
  balanceAfterMl: number;
  referenceId: string;
  description: string;
  createdAt: Date;
  createdBy: string;
}

export interface RechargeOrderDoc {
  orderId: string;
  userId: string;
  quantityMl: number;
  amountPaise: number;
  currency: 'INR';
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  status: RechargeOrderStatus;
  createdAt: Date;
  paidAt: Date | null;
  creditedAt: Date | null;
  failureReason: string | null;
}

export interface PaymentDoc {
  paymentId: string;
  userId: string;
  provider: 'razorpay';
  amountPaise: number;
  currency: 'INR';
  status: PaymentStatus;
  providerOrderId: string;
  providerPaymentId: string;
  verification: {
    signatureValid: boolean;
    statusFromProvider: string;
    captured: boolean;
    verifiedAt: Date;
    source: 'checkout' | 'webhook';
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLogDoc {
  logId: string;
  actorUid: string;
  actorEmail: string;
  action: string;
  targetUserId: string | null;
  targetDeviceId: string | null;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: Date;
}

export interface PricingDoc {
  pricePerLitrePaise: number;
  currency: 'INR';
  minimumRechargeLitres: number;
  maximumRechargeLitres: number;
  availableRechargePackages: number[];
  updatedAt: Date;
  updatedBy: string;
}
