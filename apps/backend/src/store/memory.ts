import type {
  QueryFilter,
  QueryOptions,
  Store,
  StoredDoc,
  Tx,
} from './types.js';

interface DocumentData {
  [key: string]: unknown;
}

/**
 * Deterministic in-memory store used by automated tests (and by nothing else).
 * Transactions are serialized with a promise mutex and rolled back on error,
 * which mirrors Firestore's all-or-nothing semantics closely enough to test
 * the accounting invariants.
 */
export class MemoryStore implements Store {
  private docs = new Map<string, DocumentData>();
  private lock: Promise<void> = Promise.resolve();

  constructor(seed: Record<string, DocumentData> = {}) {
    for (const [path, data] of Object.entries(seed)) {
      this.docs.set(path, structuredClone(data));
    }
  }

  async get<T>(path: string): Promise<(T & { id: string }) | null> {
    const data = this.docs.get(path);
    if (!data) return null;
    return { id: path.split('/').pop() ?? path, ...structuredClone(data) } as T & {
      id: string;
    };
  }

  async set(path: string, data: Record<string, unknown>): Promise<void> {
    this.docs.set(path, structuredClone(data));
  }

  async merge(path: string, data: Record<string, unknown>): Promise<void> {
    const existing = this.docs.get(path) ?? {};
    this.docs.set(path, { ...structuredClone(existing), ...structuredClone(data) });
  }

  async delete(path: string): Promise<void> {
    this.docs.delete(path);
  }

  async query<T>(collection: string, options: QueryOptions = {}): Promise<Array<T & { id: string }>> {
    const prefix = `${collection}/`;
    const results: Array<T & { id: string }> = [];
    for (const [path, raw] of this.docs.entries()) {
      if (!path.startsWith(prefix)) continue;
      const id = path.slice(prefix.length);
      if (id.includes('/')) continue;
      const data = structuredClone(raw);
      if (!matchesFilters(data, options.filters ?? [])) continue;
      results.push({ id, ...data } as T & { id: string });
    }
    if (options.orderBy) {
      const { field, direction } = options.orderBy;
      results.sort((a, b) => {
        const left = sortValue((a as Record<string, unknown>)[field]);
        const right = sortValue((b as Record<string, unknown>)[field]);
        if (left < right) return direction === 'asc' ? -1 : 1;
        if (left > right) return direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    if (options.limit != null) return results.slice(0, options.limit);
    return results;
  }

  async runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const previous = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const snapshot = new Map<string, DocumentData>();
    for (const [path, data] of this.docs.entries()) {
      snapshot.set(path, structuredClone(data));
    }
    const tx: Tx = {
      get: async <R>(path: string) => {
        const data = snapshot.get(path);
        if (!data) return null;
        return { id: path.split('/').pop() ?? path, ...structuredClone(data) } as R & {
          id: string;
        };
      },
      set: (path, data) => {
        snapshot.set(path, structuredClone(data));
      },
      merge: (path, data) => {
        const existing = snapshot.get(path) ?? {};
        snapshot.set(path, { ...structuredClone(existing), ...structuredClone(data) });
      },
      delete: (path) => {
        snapshot.delete(path);
      },
    };
    try {
      const result = await fn(tx);
      this.docs = snapshot;
      return result;
    } finally {
      release();
    }
  }

  /** Test helper: inspect a stored document without exposing it publicly. */
  peek(path: string): DocumentData | undefined {
    return this.docs.get(path);
  }
}

function matchesFilters(data: DocumentData, filters: QueryFilter[]): boolean {
  return filters.every((filter) => {
    const value = data[filter.field];
    switch (filter.op) {
      case '==':
        return value === filter.value;
      case '!=':
        return value !== filter.value;
      case 'in':
        return Array.isArray(filter.value) && filter.value.includes(value);
      case 'array-contains':
        return Array.isArray(value) && value.includes(filter.value);
      default:
        return false;
    }
  });
}

function sortValue(value: unknown): number | string {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  return 0;
}

export type { StoredDoc };
