import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** Constant-time string comparison that never throws on length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    // Still perform one comparison to keep timing roughly constant.
    const filler = Buffer.alloc(left.length);
    timingSafeEqual(left, filler);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

export function hmacBase64(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('base64');
}

export function verifyHmacHex(secret: string, payload: string, signature: string): boolean {
  if (!secret || !signature) return false;
  return safeEqual(hmacSha256Hex(secret, payload), signature.trim().toLowerCase());
}
