import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authUser } from '../auth/plugin.js';
import { getPricing } from '../recharge/pricing.js';
import { parseBody } from '../utils/validate.js';
import { errors } from '../utils/errors.js';
import { createRechargeOrder, verifyCheckoutPayment } from './service.js';

const createOrderSchema = z.object({
  quantityMl: z.number().int().positive().max(100_000_000),
});

const verifySchema = z.object({
  razorpayOrderId: z.string().min(3).max(120),
  razorpayPaymentId: z.string().min(3).max(120),
  razorpaySignature: z.string().min(10).max(512),
});

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/recharge/pricing', { preHandler: [app.authenticate] }, async () => {
    const pricing = await getPricing(app.deps);
    if (!pricing) {
      return { configured: false as const, paymentsEnabled: false };
    }
    return {
      configured: true as const,
      paymentsEnabled: Boolean(app.deps.config.razorpay.keyId),
      pricePerLitrePaise: pricing.pricePerLitrePaise,
      pricePerLitreInr: pricing.pricePerLitrePaise / 100,
      currency: pricing.currency,
      minimumRechargeLitres: pricing.minimumRechargeLitres,
      maximumRechargeLitres: pricing.maximumRechargeLitres,
      availableRechargePackages: pricing.availableRechargePackages,
      mode: app.deps.config.razorpay.mode,
    };
  });

  app.post(
    '/api/payments/create-order',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request) => {
      const user = authUser(request);
      const body = parseBody(createOrderSchema, request.body ?? {});
      return createRechargeOrder(app.deps, user.profile, body.quantityMl);
    },
  );

  app.post(
    '/api/payments/verify',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request) => {
      const user = authUser(request);
      const body = parseBody(verifySchema, request.body ?? {});
      return verifyCheckoutPayment(app.deps, user.profile, body);
    },
  );

  app.get('/api/payments/:paymentId', { preHandler: [app.authenticate] }, async (request) => {
    const user = authUser(request);
    const { paymentId } = request.params as { paymentId: string };
    const payment = await app.deps.store.get<Record<string, unknown>>(
      `payments/${paymentId}`,
    );
    if (!payment) throw errors.notFound('Payment not found.');
    if (payment.userId !== user.uid && user.role !== 'admin') {
      throw errors.forbidden();
    }
    return { payment };
  });
}
