import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authUser } from '../auth/plugin.js';
import { parseBody } from '../utils/validate.js';
import { publicDevice } from '../types/realtime.js';
import { claimDevice, createPairingChallenge, getDeviceForUser } from './service.js';
import { paths } from '../store/types.js';

const challengeSchema = z.object({
  deviceId: z.string().trim().min(3).max(80),
  claimCode: z.string().trim().min(6).max(64),
});

const assignSchema = z.object({
  pairingToken: z.string().min(10).max(2048),
});

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/devices/pairing/challenge',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request) => {
      const user = authUser(request);
      const body = parseBody(challengeSchema, request.body ?? {});
      const challenge = await createPairingChallenge(app.deps, user.uid, body.deviceId, body.claimCode);
      return {
        ...challenge,
        notice:
          'Wi-Fi credentials are sent only from the phone to the ESP8266 setup network. They never reach this server.',
      };
    },
  );

  app.post(
    '/api/devices/assign',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request) => {
      const user = authUser(request);
      const body = parseBody(assignSchema, request.body ?? {});
      const result = await claimDevice(app.deps, user.uid, body.pairingToken);
      app.deps.hub.publishToAdmins({
        type: 'device',
        device: publicDevice(result.device),
      });
      return {
        assigned: true,
        device: publicDevice(result.device),
        previousDeviceId: result.previousDeviceId,
        message:
          'Device assigned. Confirm it comes online after it joins your Wi-Fi and sends its first heartbeat.',
      };
    },
  );

  // Alias kept for clients that model pairing as a provisioning claim.
  app.post(
    '/api/devices/provisioning/claim',
    { preHandler: [app.authenticate] },
    async (request) => {
      const user = authUser(request);
      const body = parseBody(assignSchema, request.body ?? {});
      const result = await claimDevice(app.deps, user.uid, body.pairingToken);
      return { assigned: true, device: publicDevice(result.device) };
    },
  );

  app.get('/api/devices/status', { preHandler: [app.authenticate] }, async (request) => {
    const user = authUser(request);
    const device = await getDeviceForUser(app.deps, user.profile);
    let deviceRecord = device;
    if (!deviceRecord && user.profile.deviceId) {
      deviceRecord = await app.deps.store.get(paths.device(user.profile.deviceId));
    }
    return { device: deviceRecord ? publicDevice(deviceRecord) : null };
  });
}
