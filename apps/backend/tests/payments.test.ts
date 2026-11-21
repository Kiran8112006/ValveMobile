import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { RazorpayProvider } from '../src/payments/provider.js';
import { testConfig } from './helpers.js';
import { paths } from '../src/store/types.js';
import type { PaymentDoc, RechargeOrderDoc, UserDoc } from '../src/types/domain.js';
import { createTestContext, CUSTOMER_UID, seedStandardWorld } from './helpers.js';

const RZP_WEBHOOK_SIGNATURE = 'valid-webhook-signature';

async function setup(options: { pricing?: boolean } = {}) {
  const ctx = createTestContext();
  await seedStandardWorld(ctx.store, { balanceMl: 10_000 });
  if (options.pricing !== false) {
    await ctx.store.set(paths.pricing(), {
      pricePerLitrePaise: 500,
      currency: 'INR',
      minimumRechargeLitres: 10,
      maximumRechargeLitres: 100,
      availableRechargePackages: [10, 25, 50, 100],
      updatedAt: new Date(),
      updatedBy: 'admin-1',
    });
  }
  const app = await buildApp(ctx.deps);
  return { ctx, app };
}

const auth = { authorization: 'Bearer customer-token' };

async function createOrder(app: Awaited<ReturnType<typeof setup>>['app'], quantityMl = 25_000) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/payments/create-order',
    headers: auth,
    payload: { quantityMl },
  });
  return response;
}

describe('Razorpay integration', () => {
  it('disables recharge when pricing is not configured', async () => {
    const { app } = await setup({ pricing: false });
    const pricing = await app.inject({
      method: 'GET',
      url: '/api/recharge/pricing',
      headers: auth,
    });
    expect(pricing.json()).toMatchObject({ configured: false, paymentsEnabled: false });
    const response = await createOrder(app);
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('pricing_not_configured');
  });

  it('creates a Razorpay order using admin-configured price in paise', async () => {
    const { ctx, app } = await setup();
    const response = await createOrder(app);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      quantityMl: 25_000,
      amountPaise: 12_500,
      currency: 'INR',
      keyId: 'rzp_test_key',
      mode: 'test',
    });
    expect(body.razorpayOrderId).toMatch(/^order_test_/);
    const order = await ctx.store.get<RechargeOrderDoc>(paths.rechargeOrder(body.orderId));
    expect(order).toMatchObject({
      userId: CUSTOMER_UID,
      quantityMl: 25_000,
      amountPaise: 12_500,
      status: 'created',
    });
    // The Key Secret must never leave the server.
    expect(JSON.stringify(body)).not.toContain('rzp_test_secret');
  });

  it('rejects quantities outside the configured range', async () => {
    const { app } = await setup();
    const response = await createOrder(app, 5000);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('quantity_out_of_range');
  });

  it('verifies a captured payment and credits the balance exactly once', async () => {
    const { ctx, app } = await setup();
    const created = (await createOrder(app)).json();
    const payment = ctx.payments.addCapturedPayment(created.razorpayOrderId);
    const signature = `sig_${created.razorpayOrderId}_${payment.id}`;

    const first = await app.inject({
      method: 'POST',
      url: '/api/payments/verify',
      headers: auth,
      payload: {
        razorpayOrderId: created.razorpayOrderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: signature,
      },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ status: 'paid', credited: true, balanceMl: 35_000 });

    const second = await app.inject({
      method: 'POST',
      url: '/api/payments/verify',
      headers: auth,
      payload: {
        razorpayOrderId: created.razorpayOrderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: signature,
      },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ credited: false, balanceMl: 35_000 });

    const user = await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID));
    expect(user?.balanceMl).toBe(35_000);
    const paymentDoc = await ctx.store.get<PaymentDoc>(paths.payment(payment.id));
    expect(paymentDoc).toMatchObject({
      status: 'captured',
      amountPaise: 12_500,
      providerOrderId: created.razorpayOrderId,
    });
    expect(paymentDoc?.verification.signatureValid).toBe(true);
  });

  it('rejects an invalid checkout signature and does not credit', async () => {
    const { ctx, app } = await setup();
    const created = (await createOrder(app)).json();
    const payment = ctx.payments.addCapturedPayment(created.razorpayOrderId);
    const response = await app.inject({
      method: 'POST',
      url: '/api/payments/verify',
      headers: auth,
      payload: {
        razorpayOrderId: created.razorpayOrderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: 'forged-signature',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('payment_signature_invalid');
    const user = await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID));
    expect(user?.balanceMl).toBe(10_000);
    const order = await ctx.store.get<RechargeOrderDoc>(paths.rechargeOrder(created.orderId));
    expect(order?.status).toBe('failed');
  });

  it('rejects a payment whose amount does not match the order', async () => {
    const { ctx, app } = await setup();
    const created = (await createOrder(app)).json();
    const payment = ctx.payments.addCapturedPayment(created.razorpayOrderId);
    payment.amount = 100;
    const response = await app.inject({
      method: 'POST',
      url: '/api/payments/verify',
      headers: auth,
      payload: {
        razorpayOrderId: created.razorpayOrderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: `sig_${created.razorpayOrderId}_${payment.id}`,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('payment_amount_mismatch');
  });

  it('keeps an authorized-but-not-captured payment pending', async () => {
    const { ctx, app } = await setup();
    const created = (await createOrder(app)).json();
    const payment = ctx.payments.addCapturedPayment(created.razorpayOrderId);
    payment.status = 'authorized';
    payment.captured = false;
    const response = await app.inject({
      method: 'POST',
      url: '/api/payments/verify',
      headers: auth,
      payload: {
        razorpayOrderId: created.razorpayOrderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: `sig_${created.razorpayOrderId}_${payment.id}`,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('pending');
    const user = await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID));
    expect(user?.balanceMl).toBe(10_000);
  });

  it('rejects an unsigned Razorpay webhook', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/razorpay',
      headers: { 'x-razorpay-signature': 'not-valid' },
      payload: { event: 'payment.captured' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('credits from a verified webhook and ignores the duplicate delivery', async () => {
    const { ctx, app } = await setup();
    const created = (await createOrder(app)).json();
    const payment = ctx.payments.addCapturedPayment(created.razorpayOrderId);
    const webhookBody = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: payment.id,
            order_id: created.razorpayOrderId,
            amount: 12_500,
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/webhooks/razorpay',
      headers: { 'x-razorpay-signature': RZP_WEBHOOK_SIGNATURE },
      payload: webhookBody,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ handled: true, reason: 'credited' });

    const second = await app.inject({
      method: 'POST',
      url: '/api/webhooks/razorpay',
      headers: { 'x-razorpay-signature': RZP_WEBHOOK_SIGNATURE },
      payload: webhookBody,
    });
    expect(second.json()).toMatchObject({ handled: true, reason: 'already_credited' });

    const user = await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID));
    expect(user?.balanceMl).toBe(35_000);
  });

  it('marks a failed webhook payment as failed without crediting', async () => {
    const { ctx, app } = await setup();
    const created = (await createOrder(app)).json();
    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/razorpay',
      headers: { 'x-razorpay-signature': RZP_WEBHOOK_SIGNATURE },
      payload: {
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_failed_1',
              order_id: created.razorpayOrderId,
              error_description: 'card declined',
            },
          },
        },
      },
    });
    expect(response.statusCode).toBe(200);
    const order = await ctx.store.get<RechargeOrderDoc>(paths.rechargeOrder(created.orderId));
    expect(order?.status).toBe('failed');
    const user = await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID));
    expect(user?.balanceMl).toBe(10_000);
  });

  it('records refund status without silently clawing back water', async () => {
    const { ctx, app } = await setup();
    const created = (await createOrder(app)).json();
    const payment = ctx.payments.addCapturedPayment(created.razorpayOrderId);
    await app.inject({
      method: 'POST',
      url: '/api/webhooks/razorpay',
      headers: { 'x-razorpay-signature': RZP_WEBHOOK_SIGNATURE },
      payload: {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: payment.id,
              order_id: created.razorpayOrderId,
              amount: 12_500,
              currency: 'INR',
              status: 'captured',
            },
          },
        },
      },
    });
    const refund = await app.inject({
      method: 'POST',
      url: '/api/webhooks/razorpay',
      headers: { 'x-razorpay-signature': RZP_WEBHOOK_SIGNATURE },
      payload: {
        event: 'refund.processed',
        payload: { refund: { entity: { payment_id: payment.id, status: 'processed' } } },
      },
    });
    expect(refund.json()).toMatchObject({ handled: true, reason: 'refund_recorded' });
    const paymentDoc = await ctx.store.get<PaymentDoc>(paths.payment(payment.id));
    expect(paymentDoc?.status).toBe('refunded');
    const order = await ctx.store.get<RechargeOrderDoc>(paths.rechargeOrder(created.orderId));
    expect(order?.status).toBe('refunded');
    const user = await ctx.store.get<UserDoc>(paths.user(CUSTOMER_UID));
    expect(user?.balanceMl).toBe(35_000);
  });
});

describe('Razorpay signature primitives', () => {
  it('verifies checkout HMAC signatures with the key secret', () => {
    const provider = new RazorpayProvider(testConfig());
    const expected = createHmac('sha256', 'rzp_test_secret')
      .update('order_abc|pay_xyz')
      .digest('hex');
    expect(
      provider.verifyCheckoutSignature({
        orderId: 'order_abc',
        paymentId: 'pay_xyz',
        signature: expected,
      }),
    ).toBe(true);
    expect(
      provider.verifyCheckoutSignature({
        orderId: 'order_abc',
        paymentId: 'pay_xyz',
        signature: 'deadbeef',
      }),
    ).toBe(false);
  });

  it('verifies webhook HMAC signatures over the raw body', () => {
    const provider = new RazorpayProvider(testConfig());
    const raw = '{"event":"payment.captured"}';
    const expected = createHmac('sha256', 'rzp_webhook_secret').update(raw).digest('hex');
    expect(provider.verifyWebhookSignature(raw, expected)).toBe(true);
    expect(provider.verifyWebhookSignature(`${raw} `, expected)).toBe(false);
  });
});
