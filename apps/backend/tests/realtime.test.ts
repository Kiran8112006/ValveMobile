import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { Hub } from '../src/realtime/hub.js';
import type { SocketLike } from '../src/types/deps.js';
import { createTestContext, CUSTOMER_UID, seedStandardWorld } from './helpers.js';

class FakeSocket implements SocketLike {
  readyState = 1;
  readonly sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
}

describe('realtime hub routing', () => {
  it('sends only a customer\'s own messages to that customer', () => {
    const hub = new Hub();
    const customer = new FakeSocket();
    const other = new FakeSocket();
    const admin = new FakeSocket();
    hub.register(CUSTOMER_UID, 'customer', customer);
    hub.register('cust-2', 'customer', other);
    hub.register('admin-1', 'admin', admin);

    hub.publishToUser(CUSTOMER_UID, {
      type: 'balance',
      balanceMl: 1000,
      totalEstimatedDispensedMl: 500,
      updatedAt: new Date().toISOString(),
    });
    hub.publishToAdmins({
      type: 'balance',
      balanceMl: 1000,
      totalEstimatedDispensedMl: 500,
      updatedAt: new Date().toISOString(),
    });

    expect(customer.sent.some((entry) => entry.includes('balanceMl'))).toBe(true);
    expect(other.sent.some((entry) => entry.includes('balanceMl'))).toBe(false);
    expect(admin.sent.some((entry) => entry.includes('balanceMl'))).toBe(true);
    expect(admin.sent.some((entry) => entry.includes('"type":"ready"'))).toBe(true);
    expect(hub.connectionCount()).toBe(3);

    hub.unregister(customer);
    expect(hub.connectionCount()).toBe(2);
  });

  it('drops sockets that are no longer open', () => {
    const hub = new Hub();
    const socket = new FakeSocket();
    hub.register(CUSTOMER_UID, 'customer', socket);
    socket.readyState = 3;
    hub.publishToUser(CUSTOMER_UID, {
      type: 'balance',
      balanceMl: 0,
      totalEstimatedDispensedMl: 0,
      updatedAt: new Date().toISOString(),
    });
    expect(socket.sent).toHaveLength(1);
  });
});

describe('authenticated WebSocket endpoint', () => {
  it('accepts a valid token, streams updates and rejects invalid tokens', async () => {
    const ctx = createTestContext();
    await seedStandardWorld(ctx.store);
    const hub = new Hub();
    ctx.deps.hub = hub;
    const app = await buildApp(ctx.deps);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    const base = `ws://127.0.0.1:${address.port}`;

    const received: string[] = [];
    const socket = new WebSocket(`${base}/ws?token=customer-token`);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no ready message')), 5000);
      socket.addEventListener('message', (event) => {
        received.push(String(event.data));
        if (String(event.data).includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
      socket.addEventListener('error', () => reject(new Error('socket error')));
    });

    hub.publishToUser(CUSTOMER_UID, {
      type: 'balance',
      balanceMl: 4321,
      totalEstimatedDispensedMl: 1000,
      updatedAt: new Date().toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(received.some((entry) => entry.includes('4321'))).toBe(true);
    socket.close();

    const unauthorised = new WebSocket(`${base}/ws?token=bogus`);
    const closeCode = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no close')), 5000);
      unauthorised.addEventListener('close', (event) => {
        clearTimeout(timer);
        resolve((event as unknown as { code: number }).code);
      });
      unauthorised.addEventListener('error', () => {
        /* close follows */
      });
    });
    expect([4401, 1006]).toContain(closeCode);

    const disabled = new WebSocket(`${base}/ws?token=disabled-token`);
    const disabledCode = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no close')), 5000);
      disabled.addEventListener('close', (event) => {
        clearTimeout(timer);
        resolve((event as unknown as { code: number }).code);
      });
      disabled.addEventListener('error', () => {
        /* close follows */
      });
    });
    expect([4403, 1006]).toContain(disabledCode);

    await app.close();
  });
});
