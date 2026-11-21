import { MemoryStore } from '../src/store/memory.js';
import { paths } from '../src/store/types.js';
import type { AppConfig } from '../src/config/env.js';
import type { AuthTokenPayload, PaymentProvider, ProviderPayment, PaymentOrder, RealtimeHub, SocketLike, TokenVerifier } from '../src/types/deps.js';
import type { AppDeps } from '../src/types/app.js';
import type { DeviceDoc, Role, SessionStatus, UserDoc } from '../src/types/domain.js';
import type { RealtimeMessage } from '../src/types/realtime.js';
import { RecordingThingsBoardClient } from '../src/thingsboard/client.js';

export const TB_UUID = 'tb-device-uuid-0001';
export const DEVICE_ID = 'valve_test_01';
export const CUSTOMER_UID = 'cust-1';
export const ADMIN_UID = 'admin-1';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base: AppConfig = {
    env: 'test',
    port: 0,
    logLevel: 'silent',
    corsOrigins: ['http://localhost:8081'],
    firebase: { projectId: 'valve-test', serviceAccountPath: null },
    thingsboard: {
      baseUrl: 'https://tb.test',
      apiKey: 'tb-api-key',
      webhookSecret: 'tb-webhook-secret-1234567890',
      offlineThresholdMs: 45_000,
      rpcTimeoutMs: 2000,
    },
    razorpay: {
      keyId: 'rzp_test_key',
      keySecret: 'rzp_test_secret',
      webhookSecret: 'rzp_webhook_secret',
      mode: 'test',
    },
    pairing: {
      tokenSecret: 'pairing-secret-1234567890',
      challengeTtlMs: 600_000,
    },
    valve: {
      openDurationMs: 1000,
      closedGapMs: 100,
      maxAuthorizedMlPerSession: 100_000,
      minAuthorizedMl: 100,
    },
  };
  return {
    ...base,
    ...overrides,
    firebase: { ...base.firebase, ...(overrides.firebase ?? {}) },
    thingsboard: { ...base.thingsboard, ...(overrides.thingsboard ?? {}) },
    razorpay: { ...base.razorpay, ...(overrides.razorpay ?? {}) },
    pairing: { ...base.pairing, ...(overrides.pairing ?? {}) },
    valve: { ...base.valve, ...(overrides.valve ?? {}) },
  };
}

export class FakeVerifier implements TokenVerifier {
  readonly tokens = new Map<string, AuthTokenPayload>();

  constructor() {
    this.tokens.set('customer-token', {
      uid: CUSTOMER_UID,
      email: 'customer@example.com',
      admin: false,
      emailVerified: true,
    });
    this.tokens.set('admin-token', {
      uid: ADMIN_UID,
      email: 'admin@example.com',
      admin: true,
      emailVerified: true,
    });
    this.tokens.set('admin-claim-customer-token', {
      uid: CUSTOMER_UID,
      email: 'customer@example.com',
      admin: true,
      emailVerified: true,
    });
    this.tokens.set('other-customer-token', {
      uid: 'cust-2',
      email: 'other@example.com',
      admin: false,
      emailVerified: true,
    });
    this.tokens.set('disabled-token', {
      uid: 'disabled-1',
      email: 'disabled@example.com',
      admin: false,
      emailVerified: true,
    });
    this.tokens.set('no-profile-token', {
      uid: 'ghost-1',
      email: 'ghost@example.com',
      admin: false,
      emailVerified: true,
    });
  }

  async verify(idToken: string): Promise<AuthTokenPayload> {
    const payload = this.tokens.get(idToken);
    if (!payload) throw new Error('invalid token');
    return payload;
  }
}

export class CaptureHub implements RealtimeHub {
  readonly messages: Array<{ target: string; message: RealtimeMessage }> = [];
  readonly sockets = new Map<string, SocketLike>();

  register(uid: string, role: Role, socket: SocketLike): void {
    this.sockets.set(`${uid}:${role}`, socket);
    socket.send(JSON.stringify({ type: 'ready', serverTime: new Date().toISOString() }));
  }
  unregister(socket: SocketLike): void {
    for (const [key, value] of this.sockets) {
      if (value === socket) this.sockets.delete(key);
    }
  }
  publishToUser(uid: string, message: RealtimeMessage): void {
    this.messages.push({ target: uid, message });
  }
  publishToAdmins(message: RealtimeMessage): void {
    this.messages.push({ target: 'admins', message });
  }
  connectionCount(): number {
    return this.sockets.size;
  }
}

export class FakePayments implements PaymentProvider {
  readonly mode: 'test' | 'live' = 'test';
  private counter = 0;
  readonly orders = new Map<string, PaymentOrder>();
  readonly payments = new Map<string, ProviderPayment>();
  webhookSignature = 'valid-webhook-signature';
  failCreateOrder = false;

  async createOrder(input: { amountPaise: number; receipt: string }): Promise<PaymentOrder> {
    if (this.failCreateOrder) throw new Error('provider down');
    this.counter += 1;
    const order: PaymentOrder = {
      id: `order_test_${this.counter}`,
      amount: input.amountPaise,
      currency: 'INR',
      status: 'created',
    };
    this.orders.set(order.id, order);
    return order;
  }

  async fetchPayment(paymentId: string): Promise<ProviderPayment> {
    const payment = this.payments.get(paymentId);
    if (!payment) throw new Error('payment not found');
    return payment;
  }

  verifyCheckoutSignature(input: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean {
    return input.signature === `sig_${input.orderId}_${input.paymentId}`;
  }

  verifyWebhookSignature(_rawBody: string, signature: string): boolean {
    return signature === this.webhookSignature;
  }

  addCapturedPayment(orderId: string): ProviderPayment {
    const order = this.orders.get(orderId);
    if (!order) throw new Error('order not found');
    const payment: ProviderPayment = {
      id: `pay_test_${this.counter}_${Date.now()}`,
      order_id: orderId,
      amount: order.amount,
      currency: 'INR',
      status: 'captured',
      captured: true,
    };
    this.payments.set(payment.id, payment);
    return payment;
  }
}

export interface TestContext {
  deps: AppDeps;
  store: MemoryStore;
  verifier: FakeVerifier;
  hub: CaptureHub;
  tb: RecordingThingsBoardClient;
  payments: FakePayments;
}

export interface TbResponderOptions {
  ackOn?: boolean;
  acknowledgedSessionId?: string;
  offFinalSequence?: number | null;
}

export function createTestContext(options: TbResponderOptions = {}): TestContext {
  const store = new MemoryStore();
  const verifier = new FakeVerifier();
  const hub = new CaptureHub();
  const payments = new FakePayments();
  const ackOn = options.ackOn ?? true;
  const tb = new RecordingThingsBoardClient((method, params) => {
    if (method === 'setValve' && params.state === 'on') {
      if (!ackOn) return { success: false };
      return {
        success: true,
        valveState: 'on',
        sessionId: options.acknowledgedSessionId ?? params.sessionId,
      };
    }
    if (method === 'setValve' && params.state === 'off') {
      return {
        success: true,
        valveState: 'off',
        finalSequence:
          options.offFinalSequence === null ? undefined : (options.offFinalSequence ?? 0),
        pendingEventCount: 0,
      };
    }
    if (method === 'ackConsumptionEvent') return { success: true };
    return { success: false, error: 'unsupported method' };
  });

  const deps: AppDeps = {
    config: testConfig(),
    store,
    verifier,
    thingsboard: tb,
    payments,
    hub,
    now: () => new Date(),
  };
  return { deps, store, verifier, hub, tb, payments };
}

export async function seedUser(
  store: MemoryStore,
  overrides: Partial<UserDoc> & { uid?: string } = {},
): Promise<UserDoc> {
  const now = new Date();
  const user: UserDoc = {
    uid: overrides.uid ?? CUSTOMER_UID,
    fullName: overrides.fullName ?? 'Test Customer',
    email: overrides.email ?? 'customer@example.com',
    role: overrides.role ?? 'customer',
    status: overrides.status ?? 'active',
    balanceMl: overrides.balanceMl ?? 10_000,
    totalEstimatedDispensedMl: overrides.totalEstimatedDispensedMl ?? 0,
    deviceId: overrides.deviceId === undefined ? DEVICE_ID : overrides.deviceId,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
  await store.set(paths.user(user.uid), { ...user });
  return user;
}

export async function seedDevice(
  store: MemoryStore,
  overrides: Partial<DeviceDoc> & { deviceId?: string } = {},
): Promise<DeviceDoc> {
  const now = new Date();
  const device: DeviceDoc = {
    deviceId: overrides.deviceId ?? DEVICE_ID,
    thingsBoardDeviceUuid: overrides.thingsBoardDeviceUuid ?? TB_UUID,
    deviceName: overrides.deviceName ?? 'Kitchen Valve',
    hardwareModel: overrides.hardwareModel ?? 'ESP8266 NodeMCU',
    assignedUserId: overrides.assignedUserId === undefined ? CUSTOMER_UID : overrides.assignedUserId,
    status: overrides.status ?? 'online',
    valveState: overrides.valveState ?? 'off',
    lastHeartbeat: overrides.lastHeartbeat === undefined ? now : overrides.lastHeartbeat,
    firmwareVersion: overrides.firmwareVersion ?? '1.0.0',
    relayState: overrides.relayState ?? 'off',
    activeSessionId: overrides.activeSessionId ?? null,
    wifiRssi: overrides.wifiRssi ?? -55,
    claimCodeHash: overrides.claimCodeHash ?? null,
    claimUsedAt: overrides.claimUsedAt ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
  await store.set(paths.device(device.deviceId), { ...device });
  return device;
}

export async function seedAdmin(store: MemoryStore): Promise<UserDoc> {
  return seedUser(store, {
    uid: ADMIN_UID,
    fullName: 'Admin User',
    email: 'admin@example.com',
    role: 'admin',
    deviceId: null,
    balanceMl: 0,
  });
}

export async function seedStandardWorld(
  store: MemoryStore,
  options: { balanceMl?: number; deviceStatus?: DeviceDoc['status'] } = {},
): Promise<void> {
  await seedUser(store, { balanceMl: options.balanceMl ?? 10_000 });
  await seedDevice(store, { status: options.deviceStatus ?? 'online' });
  await seedAdmin(store);
  await seedUser(store, {
    uid: 'disabled-1',
    email: 'disabled@example.com',
    status: 'disabled',
    deviceId: null,
    balanceMl: 1000,
  });
  await seedUser(store, {
    uid: 'cust-2',
    fullName: 'Other Customer',
    email: 'other@example.com',
    deviceId: null,
    balanceMl: 1000,
  });
}

export async function seedSession(
  store: MemoryStore,
  overrides: {
    sessionId?: string;
    deviceId?: string;
    userId?: string;
    status?: SessionStatus;
    authorizedMl?: number;
    consumedMl?: number;
    lastProcessedSequence?: number;
  } = {},
): Promise<void> {
  const authorizedMl = overrides.authorizedMl ?? 10_000;
  const consumedMl = overrides.consumedMl ?? 0;
  await store.set(`dispensingSessions/${overrides.sessionId ?? 'ses_test'}`, {
    sessionId: overrides.sessionId ?? 'ses_test',
    deviceId: overrides.deviceId ?? DEVICE_ID,
    userId: overrides.userId ?? CUSTOMER_UID,
    status: overrides.status ?? 'active',
    authorizedMl,
    consumedMl,
    remainingAuthorizedMl: authorizedMl - consumedMl,
    lastProcessedSequence: overrides.lastProcessedSequence ?? 0,
    finalSequence: null,
    reconciled: false,
    startedAt: new Date(),
    stoppedAt: null,
    stopReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}
