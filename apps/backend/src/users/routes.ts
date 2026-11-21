import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { UserDoc } from '../types/domain.js';
import { paths, type QueryFilter } from '../store/types.js';
import { errors } from '../utils/errors.js';
import { parseBody } from '../utils/validate.js';
import { serializeUser } from './serialize.js';
import { getDeviceForUser } from '../devices/service.js';
import { getPricing } from '../recharge/pricing.js';
import { ValveService } from '../valve/service.js';
import { publicSession } from '../types/realtime.js';
import { authUser } from '../auth/plugin.js';

const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters.').max(80),
});

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/register-profile', async (request) => {
    const deps = app.deps;
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw errors.unauthorized('Missing bearer token.');
    }
    let payload;
    try {
      payload = await deps.verifier.verify(header.slice(7).trim());
    } catch {
      throw errors.unauthorized('Invalid or expired authentication token.');
    }
    const email = payload.email;
    if (!email) {
      throw errors.badRequest(
        'email_required',
        'This account has no email address. Register with email and password.',
      );
    }
    const body = parseBody(registerSchema, request.body ?? {});

    const existing = await deps.store.get<UserDoc>(paths.user(payload.uid));
    if (existing) {
      return { created: false, profile: serializeUser(existing) };
    }

    const now = deps.now();
    const profile: UserDoc = {
      uid: payload.uid,
      fullName: body.fullName,
      email,
      role: 'customer',
      status: 'active',
      balanceMl: 0,
      totalEstimatedDispensedMl: 0,
      deviceId: null,
      createdAt: now,
      updatedAt: now,
    };
    await deps.store.set(paths.user(profile.uid), { ...profile });
    return { created: true, profile: serializeUser(profile) };
  });

  app.get('/api/auth/me', { preHandler: [app.authenticate] }, async (request) => {
    const deps = app.deps;
    const user = authUser(request);
    const device = await getDeviceForUser(deps, user.profile);
    const session = await new ValveService(deps).currentSession(user.profile);
    const pricing = await getPricing(deps);
    return {
      profile: serializeUser(user.profile),
      role: user.role,
      emailVerified: user.emailVerified,
      device,
      session: session ? publicSession(session) : null,
      pricing: pricing
        ? {
            pricePerLitrePaise: pricing.pricePerLitrePaise,
            pricePerLitreInr: pricing.pricePerLitrePaise / 100,
            currency: pricing.currency,
            minimumRechargeLitres: pricing.minimumRechargeLitres,
            maximumRechargeLitres: pricing.maximumRechargeLitres,
            availableRechargePackages: pricing.availableRechargePackages,
            configured: true,
          }
        : { configured: false },
    };
  });

  app.get('/api/customer/overview', { preHandler: [app.authenticate] }, async (request) => {
    const deps = app.deps;
    const user = authUser(request);
    const device = await getDeviceForUser(deps, user.profile);
    const session = await new ValveService(deps).currentSession(user.profile);
    const pricing = await getPricing(deps);
    const transactions = await deps.store.query<Record<string, unknown>>('transactions', {
      filters: [{ field: 'userId', op: '==', value: user.uid }],
      orderBy: { field: 'createdAt', direction: 'desc' },
      limit: 10,
    });
    return {
      profile: serializeUser(user.profile),
      device,
      session: session ? publicSession(session) : null,
      pricing: pricing
        ? {
            pricePerLitrePaise: pricing.pricePerLitrePaise,
            pricePerLitreInr: pricing.pricePerLitrePaise / 100,
            currency: pricing.currency,
            minimumRechargeLitres: pricing.minimumRechargeLitres,
            maximumRechargeLitres: pricing.maximumRechargeLitres,
            availableRechargePackages: pricing.availableRechargePackages,
            configured: true,
          }
        : { configured: false },
      recentTransactions: transactions,
      serverTime: deps.now().toISOString(),
    };
  });

  app.get('/api/customer/transactions', { preHandler: [app.authenticate] }, async (request) => {
    const deps = app.deps;
    const user = authUser(request);
    const query = request.query as { limit?: string; type?: string };
    const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 100);
    const filters: QueryFilter[] = [{ field: 'userId', op: '==', value: user.uid }];
    if (query.type) filters.push({ field: 'type', op: '==', value: query.type });
    const transactions = await deps.store.query('transactions', {
      filters,
      orderBy: { field: 'createdAt', direction: 'desc' },
      limit,
    });
    return { transactions };
  });

  app.get('/api/customer/payments', { preHandler: [app.authenticate] }, async (request) => {
    const deps = app.deps;
    const user = authUser(request);
    const orders = await deps.store.query('rechargeOrders', {
      filters: [{ field: 'userId', op: '==', value: user.uid }],
      orderBy: { field: 'createdAt', direction: 'desc' },
      limit: 50,
    });
    const payments = await deps.store.query('payments', {
      filters: [{ field: 'userId', op: '==', value: user.uid }],
      orderBy: { field: 'createdAt', direction: 'desc' },
      limit: 50,
    });
    return { orders, payments };
  });

  app.get('/api/customer/history', { preHandler: [app.authenticate] }, async (request) => {
    const deps = app.deps;
    const user = authUser(request);
    const [transactions, orders] = await Promise.all([
      deps.store.query('transactions', {
        filters: [{ field: 'userId', op: '==', value: user.uid }],
        orderBy: { field: 'createdAt', direction: 'desc' },
        limit: 100,
      }),
      deps.store.query('rechargeOrders', {
        filters: [{ field: 'userId', op: '==', value: user.uid }],
        orderBy: { field: 'createdAt', direction: 'desc' },
        limit: 50,
      }),
    ]);
    return { transactions, orders };
  });
}
