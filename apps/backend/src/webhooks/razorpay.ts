import type { FastifyInstance } from 'fastify';
import { handleRazorpayWebhook } from '../payments/service.js';
import { errors } from '../utils/errors.js';

/**
 * Razorpay webhook. Verification uses the raw request body and the webhook
 * secret only — client-supplied success is never trusted.
 */
export async function razorpayWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/webhooks/razorpay', { bodyLimit: 64 * 1024 }, async (request, reply) => {
    const signature = request.headers['x-razorpay-signature'];
    if (typeof signature !== 'string') {
      throw errors.unauthorized('Missing Razorpay webhook signature.');
    }
    const raw = request.rawBody;
    if (!raw) {
      throw errors.badRequest('invalid_webhook_body', 'Raw webhook body is unavailable.');
    }
    const result = await handleRazorpayWebhook(app.deps, raw, signature);
    reply.code(200);
    return { ok: true, ...result };
  });
}
