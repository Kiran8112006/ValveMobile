import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { paths } from '../src/store/types.js';
import type { RechargeOrderDoc, UserDoc } from '../src/types/domain.js';
import {
  createTestContext,
  CUSTOMER_UID,
  DEVICE_ID,
  seedAdmin,
  seedDevice,
  seedStandardWorld,
  seedUser,
} from './helpers.js';

async function setup() {
  const ctx = createTestContext();
  await seedStandardWorld(ctx.store);
  const app = await buildApp(ctx.deps);
  return { ctx, app };
}

describe('authentication and authorization', () => {
  it('rejects unauthenticated calls to protected endpoints', async () => {
    const { app } = await setup();
    for (const [method, url] of [
      ['GET', '/api/customer/overview'],
      ['POST', '/api/valve/start'],
      ['GET', '/api/valve/status'],
      ['GET', '/api/devices/status'],
      ['GET', '/api/admin/overview'],
      ['POST', '/api/payments/create-order'],
      ['POST', '/api/devices/pairing/challenge'],
    ] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode, url).toBe(401);
    }
  });

  it('rejects a token with no Valve profile', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: '/api/customer/overview',
      headers: { authorization: 'Bearer no-profile-token' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('blocks disabled accounts on every protected route', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: '/api/customer/overview',
      headers: { authorization: 'Bearer disabled-token' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('prevents customers from reaching admin APIs', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/overview',
      headers: { authorization: 'Bearer customer-token' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('requires BOTH the custom claim and the trusted Firestore role for admin', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/overview',
      headers: { authorization: 'Bearer admin-claim-customer-token' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('allows a verified admin through', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/overview',
      headers: { authorization: 'Bearer admin-token' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('always creates new public registrations as active customers with zero balance', async () => {
    const { ctx, app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register-profile',
      headers: { authorization: 'Bearer no-profile-token' },
      payload: { fullName: 'New Person', role: 'admin', balanceMl: 999999 },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.created).toBe(true);
    expect(body.profile).toMatchObject({
      uid: 'ghost-1',
      role: 'customer',
      status: 'active',
      balanceMl: 0,
    });
    const stored = await ctx.store.get<UserDoc>(paths.user('ghost-1'));
    expect(stored?.role).toBe('customer');
    expect(stored?.balanceMl).toBe(0);
  });

  it('treats registration retries idempotently', async () => {
    const { app } = await setup();
    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/register-profile',
      headers: { authorization: 'Bearer no-profile-token' },
      payload: { fullName: 'New Person' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/register-profile',
      headers: { authorization: 'Bearer no-profile-token' },
      payload: { fullName: 'New Person' },
    });
    expect(first.json().created).toBe(true);
    expect(second.json().created).toBe(false);
  });

  it('rejects a value that is not a bearer token', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: '/api/valve/status',
      headers: { authorization: 'customer-token' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('does not let a customer start a device owned by someone else', async () => {
    const ctx = createTestContext();
    await seedUser(ctx.store, { balanceMl: 5000 });
    await seedDevice(ctx.store, { assignedUserId: 'cust-2' });
    const app = await buildApp(ctx.deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/valve/start',
      headers: { authorization: 'Bearer customer-token' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('does not let a customer claim another customer\'s payment order', async () => {
    const ctx = createTestContext();
    await seedStandardWorld(ctx.store);
    await seedUser(ctx.store, { uid: 'cust-2', deviceId: null });
    const order: RechargeOrderDoc = {
      orderId: 'ord_other',
      userId: 'cust-2',
      quantityMl: 10_000,
      amountPaise: 5000,
      currency: 'INR',
      razorpayOrderId: 'order_test_other',
      razorpayPaymentId: null,
      status: 'created',
      createdAt: new Date(),
      paidAt: null,
      creditedAt: null,
      failureReason: null,
    };
    await ctx.store.set(paths.rechargeOrder(order.orderId), { ...order });
    const app = await buildApp(ctx.deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/payments/verify',
      headers: { authorization: 'Bearer customer-token' },
      payload: {
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId: 'pay_other',
        razorpaySignature: 'sig_order_test_other_pay_other',
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects a customer trying the admin emergency-off endpoint', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/device/emergency-off',
      headers: { authorization: 'Bearer customer-token' },
      payload: { deviceId: DEVICE_ID },
    });
    expect(response.statusCode).toBe(403);
  });

  it('exposes only public Firebase configuration through /me', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Bearer customer-token' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.profile.role).toBe('customer');
    expect(JSON.stringify(body)).not.toContain('rzp_test_secret');
    expect(JSON.stringify(body)).not.toContain('tb-webhook-secret');
  });

  it('applies CORS allow-listing for browser origins', async () => {
    const { app } = await setup();
    const allowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:8081' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:8081');
    const denied = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example.com' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('admin provisioning basics', () => {
  it('only admins can read the customer list', async () => {
    const ctx = createTestContext();
    await seedStandardWorld(ctx.store);
    await seedAdmin(ctx.store);
    const app = await buildApp(ctx.deps);
    const unauthenticated = await app.inject({ method: 'GET', url: '/api/admin/customers' });
    expect(unauthenticated.statusCode).toBe(401);
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/admin/customers',
      headers: { authorization: 'Bearer admin-token' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().customers.length).toBeGreaterThan(0);
  });
});
