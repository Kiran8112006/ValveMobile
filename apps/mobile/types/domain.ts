export type Role = 'customer' | 'admin';
export type UserStatus = 'active' | 'disabled';
export type DeviceStatus = 'unknown' | 'online' | 'offline';
export type ValveState = 'off' | 'opening' | 'closed' | 'unknown';
export type SessionStatus =
  | 'pending'
  | 'active'
  | 'stopping'
  | 'reconciling'
  | 'completed'
  | 'failed';
export type TransactionType = 'recharge' | 'cash_credit' | 'consumption' | 'adjustment';

export interface Profile {
  uid: string;
  fullName: string;
  email: string;
  role: Role;
  status: UserStatus;
  balanceMl: number;
  balanceLitres: string;
  totalEstimatedDispensedMl: number;
  totalEstimatedDispensedLitres: string;
  deviceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Device {
  deviceId: string;
  deviceName: string;
  status: DeviceStatus;
  valveState: ValveState;
  relayState: 'on' | 'off' | 'unknown';
  lastHeartbeat: string | null;
  firmwareVersion: string | null;
  wifiRssi: number | null;
  assignedUserId: string | null;
  activeSessionId: string | null;
}

export interface DispensingSession {
  sessionId: string;
  deviceId: string;
  status: SessionStatus;
  authorizedMl: number;
  consumedMl: number;
  remainingAuthorizedMl: number;
  lastProcessedSequence: number;
  finalSequence: number | null;
  startedAt: string | null;
  stoppedAt: string | null;
  stopReason: string | null;
}

export interface PricingConfig {
  configured: boolean;
  paymentsEnabled?: boolean;
  pricePerLitrePaise?: number;
  pricePerLitreInr?: number;
  currency?: 'INR';
  minimumRechargeLitres?: number;
  maximumRechargeLitres?: number;
  availableRechargePackages?: number[];
  mode?: 'test' | 'live';
}

export interface Transaction {
  id: string;
  transactionId: string;
  userId: string;
  type: TransactionType;
  deltaMl: number;
  balanceAfterMl: number;
  referenceId: string;
  description: string;
  createdAt: string;
  createdBy: string;
}

export interface RechargeOrder {
  id: string;
  orderId: string;
  userId: string;
  quantityMl: number;
  amountPaise: number;
  currency: 'INR';
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  status: 'created' | 'pending' | 'paid' | 'failed' | 'refunded';
  createdAt: string;
  paidAt: string | null;
  creditedAt: string | null;
  failureReason?: string | null;
}

export interface PaymentRecord {
  id: string;
  paymentId: string;
  userId: string;
  amountPaise: number;
  currency: 'INR';
  status: 'created' | 'captured' | 'failed' | 'refunded';
  providerOrderId: string;
  providerPaymentId: string;
  createdAt: string;
}

export interface MeResponse {
  profile: Profile;
  role: Role;
  emailVerified: boolean;
  device: Device | null;
  session: DispensingSession | null;
  pricing: PricingConfig;
}

export interface CustomerOverview {
  profile: Profile;
  device: Device | null;
  session: DispensingSession | null;
  pricing: PricingConfig;
  recentTransactions: Transaction[];
  serverTime: string;
}

export interface CreateOrderResponse {
  orderId: string;
  razorpayOrderId: string;
  quantityMl: number;
  amountPaise: number;
  currency: 'INR';
  keyId: string;
  mode: 'test' | 'live';
  prefill: { name: string; email: string };
}

export interface AdminOverview {
  totals: {
    customers: number;
    activeCustomers: number;
    balanceMl: number;
    estimatedDispensedMl: number;
    onlineDevices: number;
    devices: number;
    paidRechargePaise: number;
    pendingPayments: number;
  };
  devices: Device[];
  recentEvents: Array<{
    eventId: string;
    userId: string;
    quantityMl: number;
    type: string;
    processedAt: string;
  }>;
  recentSessions: DispensingSession[];
  recentOrders: RechargeOrder[];
}

export interface RealtimeMessage {
  type: 'ready' | 'balance' | 'session' | 'dispensing' | 'device' | 'payment' | 'error';
  [key: string]: unknown;
}
