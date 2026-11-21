import { randomUUID } from 'node:crypto';

export function newId(prefix?: string): string {
  const id = randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

/** Convert integer millilitres to a 2-decimal litre string (display only). */
export function mlToLitres(ml: number): string {
  return (ml / 1000).toFixed(2);
}

/** 1 second of energized valve time = 1 litre = 1000 mL. */
export const ML_PER_MS = 1;

export function mlForDuration(ms: number): number {
  return Math.round(ms * ML_PER_MS);
}
