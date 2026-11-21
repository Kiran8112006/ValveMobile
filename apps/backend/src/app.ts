import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import type { AppDeps } from './types/app.js';
import { registerAuth } from './auth/plugin.js';
import { ApiError } from './utils/errors.js';
import { userRoutes } from './users/routes.js';
import { valveRoutes } from './valve/routes.js';
import { deviceRoutes } from './devices/routes.js';
import { paymentRoutes } from './payments/routes.js';
import { adminRoutes } from './admin/routes.js';
import { realtimeRoutes } from './realtime/routes.js';
import { thingsboardWebhookRoutes } from './webhooks/thingsboard.js';
import { razorpayWebhookRoutes } from './webhooks/razorpay.js';

export interface BuildOptions {
  logger?: boolean;
}

export async function buildApp(
  deps: AppDeps,
  options: BuildOptions = {},
): Promise<FastifyInstance> {
  const isTest = deps.config.env === 'test';
  const app = Fastify({
    logger:
      options.logger === false || isTest
        ? false
        : {
            level: deps.config.logLevel,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers["x-valve-webhook-secret"]',
                'req.headers["x-razorpay-signature"]',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
              ],
              censor: '[redacted]',
            },
          },
    bodyLimit: 256 * 1024,
    trustProxy: true,
    disableRequestLogging: false,
  });

  // Preserve the raw body for webhook signature verification.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body, done) => {
      const raw = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
      request.rawBody = raw;
      if (!raw.trim()) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(raw));
      } catch {
        const err = new Error('Request body is not valid JSON.') as FastifyError;
        err.statusCode = 400;
        err.code = 'FST_ERR_CTP_INVALID_JSON';
        done(err);
      }
    },
  );

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        // Native mobile clients and server-to-server calls send no Origin.
        callback(null, true);
        return;
      }
      callback(null, deps.config.corsOrigins.includes(origin));
    },
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    maxAge: 600,
  });

  await app.register(rateLimit, {
    max: isTest ? 100_000 : 300,
    timeWindow: '1 minute',
  });

  await app.register(websocket, {
    options: { maxPayload: 64 * 1024 },
  });

  await registerAuth(app, deps);

  app.get('/health', async () => ({
    status: 'ok',
    service: 'valve-backend',
    time: deps.now().toISOString(),
    thingsboardConfigured: Boolean(deps.config.thingsboard.apiKey),
    paymentsConfigured: Boolean(
      deps.config.razorpay.keyId && deps.config.razorpay.keySecret,
    ),
  }));

  app.setNotFoundHandler(async (_request, reply) => {
    reply.code(404).send({ error: { code: 'not_found', message: 'Route not found.' } });
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ApiError) {
      reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      });
      return;
    }
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || error.statusCode === 413) {
      reply.code(413).send({
        error: { code: 'body_too_large', message: 'Request body is too large.' },
      });
      return;
    }
    if (error.code === 'FST_ERR_CTP_INVALID_JSON') {
      reply.code(400).send({
        error: { code: 'invalid_json', message: 'Request body is not valid JSON.' },
      });
      return;
    }
    if (error.statusCode === 429) {
      reply.code(429).send({
        error: { code: 'rate_limited', message: 'Too many requests. Try again shortly.' },
      });
      return;
    }
    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      reply.code(error.statusCode).send({
        error: { code: 'bad_request', message: error.message },
      });
      return;
    }
    request.log.error({ err: error }, 'Unhandled request error');
    reply.code(500).send({
      error: { code: 'internal_error', message: 'An unexpected error occurred.' },
    });
  });

  await app.register(userRoutes);
  await app.register(valveRoutes);
  await app.register(deviceRoutes);
  await app.register(paymentRoutes);
  await app.register(adminRoutes);
  await app.register(realtimeRoutes);
  await app.register(thingsboardWebhookRoutes);
  await app.register(razorpayWebhookRoutes);

  return app;
}
