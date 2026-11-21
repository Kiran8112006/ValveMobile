import type { ZodType } from 'zod';
import { errors } from './errors.js';

export function parseBody<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
      .join('; ');
    throw errors.badRequest('validation_error', message);
  }
  return result.data;
}
