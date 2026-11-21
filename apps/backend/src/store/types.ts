/**
 * Storage abstraction.
 *
 * Production uses Firestore (Admin SDK). Tests use the in-memory store so the
 * accounting logic and route behaviour can be verified without credentials.
 * Every multi-document accounting change must run inside `runTransaction`.
 */

export type FilterOp = '==' | '!=' | 'in' | 'array-contains';

export interface QueryFilter {
  field: string;
  op: FilterOp;
  value: unknown;
}

export interface QueryOptions {
  filters?: QueryFilter[];
  orderBy?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
}

export interface StoredDoc {
  id: string;
  [key: string]: unknown;
}

export interface Tx {
  get<T>(path: string): Promise<(T & { id: string }) | null>;
  set(path: string, data: Record<string, unknown>): void;
  merge(path: string, data: Record<string, unknown>): void;
  delete(path: string): void;
}

export interface Store {
  get<T>(path: string): Promise<(T & { id: string }) | null>;
  set(path: string, data: Record<string, unknown>): Promise<void>;
  merge(path: string, data: Record<string, unknown>): Promise<void>;
  delete(path: string): Promise<void>;
  query<T>(collection: string, options?: QueryOptions): Promise<Array<T & { id: string }>>;
  runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export const paths = {
  user: (uid: string) => `users/${uid}`,
  device: (deviceId: string) => `devices/${deviceId}`,
  session: (sessionId: string) => `dispensingSessions/${sessionId}`,
  event: (eventId: string) => `dispensingEvents/${eventId}`,
  transaction: (transactionId: string) => `transactions/${transactionId}`,
  rechargeOrder: (orderId: string) => `rechargeOrders/${orderId}`,
  rechargeOrderByProvider: (razorpayOrderId: string) =>
    `rechargeOrders/${razorpayOrderId}`,
  payment: (paymentId: string) => `payments/${paymentId}`,
  auditLog: (logId: string) => `auditLogs/${logId}`,
  pricing: () => 'appConfig/pricing',
} as const;
