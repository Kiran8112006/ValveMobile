import type { Firestore, Query } from 'firebase-admin/firestore';
import type { QueryOptions, Store, Tx } from './types.js';

/**
 * Firestore-backed store. All writes from the API go through the Admin SDK,
 * which bypasses Firestore security rules by design: rules stay default-deny
 * for clients and the backend is the only writer.
 */
export class FirestoreStore implements Store {
  constructor(private readonly db: Firestore) {}

  async get<T>(path: string): Promise<(T & { id: string }) | null> {
    const snapshot = await this.db.doc(path).get();
    if (!snapshot.exists) return null;
    return { id: snapshot.id, ...plain(snapshot.data() ?? {}) } as T & { id: string };
  }

  async set(path: string, data: Record<string, unknown>): Promise<void> {
    await this.db.doc(path).set(data);
  }

  async merge(path: string, data: Record<string, unknown>): Promise<void> {
    await this.db.doc(path).set(data, { merge: true });
  }

  async delete(path: string): Promise<void> {
    await this.db.doc(path).delete();
  }

  async query<T>(collection: string, options: QueryOptions = {}): Promise<Array<T & { id: string }>> {
    let query: Query = this.db.collection(collection);
    for (const filter of options.filters ?? []) {
      query = query.where(filter.field, filter.op, filter.value);
    }
    if (options.orderBy) {
      query = query.orderBy(options.orderBy.field, options.orderBy.direction);
    }
    if (options.limit != null) query = query.limit(options.limit);
    try {
      const snapshot = await query.get();
      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...plain(doc.data()),
      })) as Array<T & { id: string }>;
    } catch (err: any) {
      // If Firestore requires a composite index that does not yet exist, fallback to in-memory sorting
      if (err?.code === 9 || (typeof err?.message === 'string' && err.message.includes('requires an index'))) {
        let fallbackQuery: Query = this.db.collection(collection);
        for (const filter of options.filters ?? []) {
          fallbackQuery = fallbackQuery.where(filter.field, filter.op, filter.value);
        }
        const snapshot = await fallbackQuery.limit(Math.max(options.limit ?? 100, 100)).get();
        let docs = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...plain(doc.data()),
        })) as Array<T & { id: string }>;
        if (options.orderBy) {
          const { field, direction } = options.orderBy;
          docs.sort((a: any, b: any) => {
            const va = a[field] instanceof Date ? a[field].getTime() : (a[field] ?? 0);
            const vb = b[field] instanceof Date ? b[field].getTime() : (b[field] ?? 0);
            return direction === 'desc'
              ? (vb > va ? 1 : vb < va ? -1 : 0)
              : (va > vb ? 1 : va < vb ? -1 : 0);
          });
        }
        if (options.limit != null) {
          docs = docs.slice(0, options.limit);
        }
        return docs;
      }
      throw err;
    }
  }

  async runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async (transaction) => {
      const tx: Tx = {
        get: async <R>(path: string) => {
          const ref = this.db.doc(path);
          const snapshot = await transaction.get(ref);
          if (!snapshot.exists) return null;
          return { id: snapshot.id, ...plain(snapshot.data() ?? {}) } as R & { id: string };
        },
        set: (path, data) => {
          transaction.set(this.db.doc(path), data);
        },
        merge: (path, data) => {
          transaction.set(this.db.doc(path), data, { merge: true });
        },
        delete: (path) => {
          transaction.delete(this.db.doc(path));
        },
      };
      return fn(tx);
    });
  }
}

function plain(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = convert(entry);
  }
  return out;
}

function convert(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    const maybeTimestamp = value as { toDate?: () => Date };
    if (typeof maybeTimestamp.toDate === 'function') {
      return maybeTimestamp.toDate();
    }
    if (Array.isArray(value)) return value.map(convert);
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = convert(entry);
    }
    return out;
  }
  return value;
}
