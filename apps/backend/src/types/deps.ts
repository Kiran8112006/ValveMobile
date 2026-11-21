import type { Role } from '../types/domain.js';
import type { RealtimeMessage } from '../types/realtime.js';

export interface AuthTokenPayload {
  uid: string;
  email: string | null;
  /** True only when the Firebase custom claim `admin === true` is present. */
  admin: boolean;
  emailVerified: boolean;
}

export interface TokenVerifier {
  verify(idToken: string): Promise<AuthTokenPayload>;
}

export interface RpcResult {
  success: boolean;
  [key: string]: unknown;
}

export interface ThingsBoardClient {
  /** Two-way RPC; resolves with the device response, rejects on transport failure. */
  sendTwoWayRpc(
    deviceUuid: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<RpcResult>;
}

export interface PaymentOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export interface ProviderPayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  captured: boolean;
}

export interface PaymentProvider {
  mode: 'test' | 'live';
  createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<PaymentOrder>;
  fetchPayment(paymentId: string): Promise<ProviderPayment>;
  verifyCheckoutSignature(input: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean;
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
}

export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
}

export interface RealtimeHub {
  register(uid: string, role: Role, socket: SocketLike): void;
  unregister(socket: SocketLike): void;
  publishToUser(uid: string, message: RealtimeMessage): void;
  publishToAdmins(message: RealtimeMessage): void;
  connectionCount(): number;
}
