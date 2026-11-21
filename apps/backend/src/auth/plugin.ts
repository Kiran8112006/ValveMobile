import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from '../types/app.js';
import type { Role, UserDoc } from '../types/domain.js';
import { errors } from '../utils/errors.js';
import { paths } from '../store/types.js';

export interface AuthContext {
  uid: string;
  email: string | null;
  role: Role;
  emailVerified: boolean;
  profile: UserDoc;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    authUser: AuthContext | null;
    rawBody: string | null;
  }
}

export async function registerAuth(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.decorateRequest('authUser', null);
  app.decorateRequest('rawBody', null);
  app.decorate('deps', deps);

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw errors.unauthorized('Missing bearer token.');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) throw errors.unauthorized('Missing bearer token.');

    let payload;
    try {
      payload = await deps.verifier.verify(token);
    } catch {
      throw errors.unauthorized('Invalid or expired authentication token.');
    }

    const profile = await deps.store.get<UserDoc>(paths.user(payload.uid));
    if (!profile) {
      throw errors.unauthorized('No Valve profile exists for this account.');
    }
    if (profile.status !== 'active') {
      throw errors.forbidden('This account is disabled. Contact an administrator.');
    }

    // Admin access requires BOTH the custom claim and the trusted Firestore role.
    const role: Role = payload.admin && profile.role === 'admin' ? 'admin' : 'customer';
    request.authUser = {
      uid: payload.uid,
      email: payload.email ?? profile.email,
      role,
      emailVerified: payload.emailVerified,
      profile,
    };
    reply.header('Cache-Control', 'no-store');
  });

  app.decorate('requireAdmin', async (request: FastifyRequest) => {
    if (!request.authUser) throw errors.unauthorized();
    if (request.authUser.role !== 'admin') {
      throw errors.forbidden('Administrator access required.');
    }
  });
}

export function authUser(request: FastifyRequest): AuthContext {
  if (!request.authUser) throw errors.unauthorized();
  return request.authUser;
}
