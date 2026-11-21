import { auth } from './firebase';

const rawBase = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/+$/, '');

const CANDIDATE_BASES = Array.from(
  new Set(
    [
      rawBase,
      'http://localhost:8080',
      'http://192.168.29.187:8080',
      'http://10.0.2.2:8080',
    ].filter(Boolean),
  ),
);

let activeBase: string = CANDIDATE_BASES[0] ?? 'http://localhost:8080';

export function getApiBase(): string {
  return activeBase;
}

export const API_BASE = activeBase;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  idempotencyKey?: string;
  timeoutMs?: number;
}

async function currentToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = await currentToken();
  if (!token) {
    throw new ApiError(401, 'not_signed_in', 'You are not signed in.');
  }

  // Try the active base first, followed by fallbacks if network error occurs
  const basesToTry = [activeBase, ...CANDIDATE_BASES.filter((b) => b !== activeBase)];

  let lastError: Error | null = null;
  for (const base of basesToTry) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
    try {
      const response = await fetch(`${base}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      // Successfully reached the server
      activeBase = base;

      const text = await response.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }

      if (!response.ok) {
        const body = parsed as { error?: { code?: string; message?: string; details?: unknown } } | null;
        throw new ApiError(
          response.status,
          body?.error?.code ?? 'request_failed',
          body?.error?.message ?? `Request failed (${response.status}).`,
          body?.error?.details as Record<string, unknown> | undefined,
        );
      }
      return parsed as T;
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof ApiError) {
        // If it's an HTTP error (e.g. 400, 401, 403, 404, 500), server WAS reached! Don't retry other IPs.
        throw error;
      }
      lastError = error as Error;
      // Network failure on this IP; proceed to next candidate base
    }
  }

  if (lastError && lastError.name === 'AbortError') {
    throw new ApiError(0, 'timeout', 'The server did not respond in time.');
  }
  throw new ApiError(
    0,
    'network_error',
    'Cannot reach the Valve server. Check your internet connection or start the backend on your PC.',
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
