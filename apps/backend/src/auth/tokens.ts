import { getAuth } from 'firebase-admin/auth';
import type { AuthTokenPayload, TokenVerifier } from '../types/deps.js';

/**
 * Verifies Firebase ID tokens, including revocation. Never trust a uid or role
 * supplied in a request body: the only source of identity is this verifier.
 */
export class FirebaseTokenVerifier implements TokenVerifier {
  async verify(idToken: string): Promise<AuthTokenPayload> {
    const decoded = await getAuth().verifyIdToken(idToken, true);
    return {
      uid: decoded.uid,
      email: typeof decoded.email === 'string' ? decoded.email : null,
      admin: decoded.admin === true || decoded.role === 'admin',
      emailVerified: decoded.email_verified === true,
    };
  }
}
