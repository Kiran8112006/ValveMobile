export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const errors = {
  unauthorized: (message = 'Authentication required.') =>
    new ApiError(401, 'unauthorized', message),
  forbidden: (message = 'You are not allowed to perform this action.') =>
    new ApiError(403, 'forbidden', message),
  notFound: (message = 'Resource not found.') => new ApiError(404, 'not_found', message),
  conflict: (code: string, message: string, details?: Record<string, unknown>) =>
    new ApiError(409, code, message, details),
  badRequest: (code: string, message: string, details?: Record<string, unknown>) =>
    new ApiError(400, code, message, details),
  tooMany: (message = 'Too many requests.') => new ApiError(429, 'rate_limited', message),
  upstream: (code: string, message: string, details?: Record<string, unknown>) =>
    new ApiError(502, code, message, details),
  unavailable: (code: string, message: string) => new ApiError(503, code, message),
};

/** Firestore transaction conflicts are retried by the SDK; surface them as 409. */
export function isTransactionConflict(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 10
  );
}
