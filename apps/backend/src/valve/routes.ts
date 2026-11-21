import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authUser } from '../auth/plugin.js';
import { getDeviceForUser } from '../devices/service.js';
import { publicSession } from '../types/realtime.js';
import { serializeUser } from '../users/serialize.js';
import { parseBody } from '../utils/validate.js';
import { ValveService } from './service.js';

export async function valveRoutes(app: FastifyInstance): Promise<void> {
  const service = new ValveService(app.deps);

  app.post(
    '/api/valve/start',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
    },
    async (request) => {
      const user = authUser(request);
      const result = await service.start(user.profile);
      const device = await getDeviceForUser(app.deps, user.profile);
      return {
        acknowledged: true,
        session: publicSession(result.session),
        device,
      };
    },
  );

  app.post(
    '/api/valve/stop',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request) => {
      const user = authUser(request);
      const result = await service.stop(user.profile);
      return {
        confirmed: result.confirmed,
        message: result.message,
        session: publicSession(result.session),
      };
    },
  );

  app.get('/api/valve/session', { preHandler: [app.authenticate] }, async (request) => {
    const user = authUser(request);
    const session = await service.currentSession(user.profile);
    return { session: session ? publicSession(session) : null };
  });

  app.get('/api/valve/status', { preHandler: [app.authenticate] }, async (request) => {
    const user = authUser(request);
    const device = await getDeviceForUser(app.deps, user.profile);
    const session = await service.currentSession(user.profile);
    return {
      profile: serializeUser(user.profile),
      device,
      session: session ? publicSession(session) : null,
      serverTime: app.deps.now().toISOString(),
    };
  });

  app.get('/api/valve/config', { preHandler: [app.authenticate] }, async () => {
    return {
      openDurationMs: app.deps.config.valve.openDurationMs,
      closedGapMs: app.deps.config.valve.closedGapMs,
      mlPerSecond: 1000,
    };
  });

  // Admin emergency stop lives under /api/admin/device/emergency-off.
  app.post(
    '/api/valve/emergency-off',
    {
      preHandler: [app.authenticate, app.requireAdmin],
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request) => {
      const admin = authUser(request);
      const body = parseBody(z.object({ deviceId: z.string().min(1) }), request.body ?? {});
      return service.emergencyOff(body.deviceId, admin.uid);
    },
  );
}
