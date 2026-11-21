import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { UserDoc } from '../types/domain.js';
import { paths } from '../store/types.js';

/**
 * Authenticated WebSocket endpoint: `/ws?token=<Firebase ID token>`.
 *
 * The token is verified on connect and the profile is re-read so a disabled
 * account cannot hold an open privileged channel. Clients must re-fetch
 * authoritative state after reconnecting; this channel is a low-latency hint,
 * not the source of truth.
 */
export async function realtimeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, async (socket: WebSocket, request) => {
    const deps = app.deps;
    const token = (request.query as { token?: string }).token;
    if (!token) {
      socket.close(4401, 'unauthorized');
      return;
    }

    let uid: string;
    let admin: boolean;
    try {
      const payload = await deps.verifier.verify(token);
      uid = payload.uid;
      admin = payload.admin;
    } catch {
      socket.close(4401, 'unauthorized');
      return;
    }

    const profile = await deps.store.get<UserDoc>(paths.user(uid));
    if (!profile || profile.status !== 'active') {
      socket.close(4403, 'forbidden');
      return;
    }
    const role = admin && profile.role === 'admin' ? 'admin' : 'customer';
    deps.hub.register(uid, role, socket);

    const ping = setInterval(() => {
      if (socket.readyState === 1) {
        try {
          socket.ping();
        } catch {
          /* ignore */
        }
      }
    }, 30_000);
    if (typeof ping.unref === 'function') ping.unref();

    socket.on('close', () => {
      clearInterval(ping);
      deps.hub.unregister(socket);
    });
    socket.on('error', () => {
      clearInterval(ping);
      deps.hub.unregister(socket);
    });
  });
}
