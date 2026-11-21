import type { AppDeps } from '../types/app.js';
import type {
  PaymentDoc,
  PricingDoc,
  RechargeOrderDoc,
  UserDoc,
} from '../types/domain.js';
import { paymentOrderPayload } from './serialize.js';
import { paths } from '../store/types.js';
import { errors } from '../utils/errors.js';
import { newId } from '../utils/ids.js';
import { isRazorpayConfigured } from '../config/env.js';
import { amountFor, requirePricing } from '../recharge/pricing.js';
import type { ProviderPayment } from '../types/deps.js';

export interface CreateOrderResult {
  orderId: string;
  razorpayOrderId: string;
  quantityMl: number;
  amountPaise: number;
  currency: 'INR';
  keyId: string;
  mode: 'test' | 'live';
  prefill: { name: string; email: string };
}

export async function createRechargeOrder(
  deps: AppDeps,
  user: UserDoc,
  quantityMl: number,
): Promise<CreateOrderResult> {
  const pricing = await requirePricing(deps);
  assertQuantity(pricing, quantityMl);
  if (!isRazorpayConfigured(deps.config) || !deps.config.razorpay.keyId) {
    throw errors.unavailable(
      'razorpay_not_configured',
      'Online recharge is not configured yet. Contact an administrator.',
    );
  }
  const amountPaise = amountFor(quantityMl, pricing.pricePerLitrePaise);
  if (amountPaise < 100) {
    throw errors.badRequest('amount_too_small', 'Recharge amount must be at least 100 paise.');
  }

  const orderId = newId('ord');
  const providerOrder = await deps.payments.createOrder({
    amountPaise,
    receipt: orderId,
    notes: { orderId, userId: user.uid },
  });

  const order: RechargeOrderDoc = {
    orderId,
    userId: user.uid,
    quantityMl,
    amountPaise,
    currency: 'INR',
    razorpayOrderId: providerOrder.id,
    razorpayPaymentId: null,
    status: 'created',
    createdAt: deps.now(),
    paidAt: null,
    creditedAt: null,
    failureReason: null,
  };
  await deps.store.set(paths.rechargeOrder(orderId), { ...order });

  return {
    orderId,
    razorpayOrderId: providerOrder.id,
    quantityMl,
    amountPaise,
    currency: 'INR',
    keyId: deps.config.razorpay.keyId,
    mode: deps.config.razorpay.mode,
    prefill: { name: user.fullName, email: user.email },
  };
}

export async function verifyCheckoutPayment(
  deps: AppDeps,
  user: UserDoc,
  input: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string },
): Promise<{
  status: 'paid' | 'pending' | 'failed';
  credited: boolean;
  balanceMl: number;
  order: RechargeOrderDoc;
  message: string;
}> {
  const order = await findOrderByProviderId(deps, input.razorpayOrderId);
  if (!order) throw errors.notFound('Recharge order not found.');
  if (order.userId !== user.uid) {
    throw errors.forbidden('This recharge order belongs to another customer.');
  }
  if (order.creditedAt) {
    return {
      status: 'paid',
      credited: false,
      balanceMl: user.balanceMl,
      order,
      message: 'This payment was already credited.',
    };
  }
  if (!deps.payments.verifyCheckoutSignature({
    orderId: input.razorpayOrderId,
    paymentId: input.razorpayPaymentId,
    signature: input.razorpaySignature,
  })) {
    await markOrderFailed(deps, order, 'signature_verification_failed');
    throw errors.badRequest('payment_signature_invalid', 'Payment signature verification failed.');
  }

  const providerPayment = await deps.payments.fetchPayment(input.razorpayPaymentId);
  if (providerPayment.order_id !== input.razorpayOrderId) {
    throw errors.badRequest('payment_order_mismatch', 'Payment does not belong to this order.');
  }
  if (providerPayment.amount !== order.amountPaise || providerPayment.currency !== 'INR') {
    throw errors.badRequest('payment_amount_mismatch', 'Payment amount does not match the order.');
  }

  if (providerPayment.status === 'authorized' && !providerPayment.captured) {
    await deps.store.merge(paths.rechargeOrder(order.orderId), {
      status: 'pending',
      razorpayPaymentId: providerPayment.id,
    });
    return {
      status: 'pending',
      credited: false,
      balanceMl: user.balanceMl,
      order: { ...order, status: 'pending', razorpayPaymentId: providerPayment.id },
      message: 'Payment is authorized but not captured yet. Balance will update when captured.',
    };
  }

  if (!providerPayment.captured || providerPayment.status !== 'captured') {
    await markOrderFailed(deps, order, `provider_status_${providerPayment.status}`);
    return {
      status: 'failed',
      credited: false,
      balanceMl: user.balanceMl,
      order: { ...order, status: 'failed' },
      message: `Payment was not captured (status: ${providerPayment.status}).`,
    };
  }

  const credited = await creditOrder(deps, {
    order,
    providerPayment,
    source: 'checkout',
    signatureValid: true,
  });
  return {
    status: 'paid',
    credited: credited.credited,
    balanceMl: credited.balanceMl,
    order: credited.order,
    message: credited.credited
      ? 'Payment verified and water balance credited.'
      : 'Payment was already credited.',
  };
}

/**
 * Idempotent credit. The recharge order's `creditedAt` field, written in the
 * same transaction as the balance change, is the single source of truth.
 */
export async function creditOrder(
  deps: AppDeps,
  input: {
    order: RechargeOrderDoc;
    providerPayment: ProviderPayment;
    source: 'checkout' | 'webhook';
    signatureValid: boolean;
  },
): Promise<{ credited: boolean; balanceMl: number; order: RechargeOrderDoc }> {
  const { order, providerPayment } = input;
  const at = deps.now();

  const result = await deps.store.runTransaction(async (tx) => {
    const freshOrder = await tx.get<RechargeOrderDoc>(paths.rechargeOrder(order.orderId));
    if (!freshOrder) throw errors.notFound('Recharge order not found.');
    if (freshOrder.creditedAt) {
      const existingUser = await tx.get<UserDoc>(paths.user(freshOrder.userId));
      if (!existingUser) throw errors.notFound('Customer not found.');
      return {
        credited: false,
        balanceMl: existingUser.balanceMl,
        totalEstimatedDispensedMl: existingUser.totalEstimatedDispensedMl,
        order: freshOrder,
        userId: freshOrder.userId,
      };
    }
    if (freshOrder.amountPaise !== providerPayment.amount) {
      throw errors.badRequest('payment_amount_mismatch', 'Verified amount does not match the order.');
    }
    const user = await tx.get<UserDoc>(paths.user(freshOrder.userId));
    if (!user) throw errors.notFound('Customer not found.');

    const existingPayment = await tx.get<PaymentDoc>(paths.payment(providerPayment.id));
    if (existingPayment && existingPayment.userId !== freshOrder.userId) {
      throw errors.conflict('payment_conflict', 'Payment ID is already linked to another account.');
    }

    const balanceAfter = user.balanceMl + freshOrder.quantityMl;
    const updatedOrder: RechargeOrderDoc = {
      ...freshOrder,
      razorpayPaymentId: providerPayment.id,
      status: 'paid',
      paidAt: freshOrder.paidAt ?? at,
      creditedAt: at,
      failureReason: null,
    };
    const paymentDoc: PaymentDoc = {
      paymentId: providerPayment.id,
      userId: freshOrder.userId,
      provider: 'razorpay',
      amountPaise: providerPayment.amount,
      currency: 'INR',
      status: 'captured',
      providerOrderId: providerPayment.order_id,
      providerPaymentId: providerPayment.id,
      verification: {
        signatureValid: input.signatureValid,
        statusFromProvider: providerPayment.status,
        captured: providerPayment.captured,
        verifiedAt: at,
        source: input.source,
      },
      createdAt: existingPayment?.createdAt ?? at,
      updatedAt: at,
    };

    tx.set(paths.user(user.uid), {
      ...user,
      balanceMl: balanceAfter,
      updatedAt: at,
    });
    tx.set(paths.rechargeOrder(freshOrder.orderId), { ...updatedOrder });
    tx.set(paths.payment(providerPayment.id), { ...paymentDoc });

    const transactionId = newId('txn');
    tx.set(paths.transaction(transactionId), {
      transactionId,
      userId: user.uid,
      type: 'recharge',
      deltaMl: freshOrder.quantityMl,
      balanceAfterMl: balanceAfter,
      referenceId: freshOrder.orderId,
      description: `Online recharge (${providerPayment.id})`,
      createdAt: at,
      createdBy: input.source === 'webhook' ? 'razorpay_webhook' : 'razorpay_checkout',
    });

    return {
      credited: true,
      balanceMl: balanceAfter,
      order: updatedOrder,
      userId: user.uid,
      totalEstimatedDispensedMl: user.totalEstimatedDispensedMl,
    };
  });

  deps.hub.publishToUser(result.userId, {
    type: 'balance',
    balanceMl: result.balanceMl,
    totalEstimatedDispensedMl: result.totalEstimatedDispensedMl,
    updatedAt: at.toISOString(),
  });
  deps.hub.publishToUser(result.userId, {
    type: 'payment',
    order: paymentOrderPayload(result.order),
  });
  deps.hub.publishToAdmins({ type: 'payment', order: paymentOrderPayload(result.order) });

  return { credited: result.credited, balanceMl: result.balanceMl, order: result.order };
}

export async function handleRazorpayWebhook(
  deps: AppDeps,
  rawBody: string,
  signature: string,
): Promise<{ handled: boolean; reason: string }> {
  if (!deps.payments.verifyWebhookSignature(rawBody, signature)) {
    throw errors.badRequest('invalid_webhook_signature', 'Razorpay webhook signature is invalid.');
  }
  let event: {
    event?: string;
    payload?: {
      payment?: { entity?: Record<string, unknown> };
      refund?: { entity?: Record<string, unknown> };
    };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw errors.badRequest('invalid_webhook_body', 'Webhook body is not valid JSON.');
  }
  const eventName = event.event ?? '';
  if (!eventName) throw errors.badRequest('invalid_webhook_body', 'Webhook event name is missing.');

  if (eventName === 'payment.captured' || eventName === 'order.paid') {
    const entity = event.payload?.payment?.entity;
    if (!entity) return { handled: false, reason: 'missing_payment_entity' };
    const orderId = String(entity.order_id ?? '');
    const paymentId = String(entity.id ?? '');
    const amount = Number(entity.amount ?? 0);
    const currency = String(entity.currency ?? 'INR');
    const status = String(entity.status ?? '');
    if (!orderId || !paymentId) {
      return { handled: false, reason: 'missing_payment_identity' };
    }
    const order = await findOrderByProviderId(deps, orderId);
    if (!order) return { handled: false, reason: 'order_not_found' };
    if (currency !== 'INR') return { handled: false, reason: 'currency_mismatch' };
    if (!Number.isInteger(amount) || amount !== order.amountPaise) {
      return { handled: false, reason: 'amount_mismatch' };
    }
    if (status !== 'captured') {
      return { handled: false, reason: `payment_status_${status || 'unknown'}` };
    }
    const credited = await creditOrder(deps, {
      order,
      providerPayment: {
        id: paymentId,
        order_id: orderId,
        amount,
        currency,
        status,
        captured: true,
      },
      source: 'webhook',
      signatureValid: true,
    });
    return {
      handled: true,
      reason: credited.credited ? 'credited' : 'already_credited',
    };
  }

  if (eventName === 'payment.failed') {
    const entity = event.payload?.payment?.entity;
    const orderId = entity ? String(entity.order_id ?? '') : '';
    if (!orderId) return { handled: false, reason: 'missing_order' };
    const order = await findOrderByProviderId(deps, orderId);
    if (!order) return { handled: false, reason: 'order_not_found' };
    if (!order.creditedAt) {
      await deps.store.merge(paths.rechargeOrder(order.orderId), {
        status: 'failed',
        failureReason: String(entity?.error_description ?? 'payment_failed'),
        razorpayPaymentId: String(entity?.id ?? '') || null,
      });
      deps.hub.publishToUser(order.userId, {
        type: 'payment',
        order: paymentOrderPayload({ ...order, status: 'failed' }),
      });
    }
    return { handled: true, reason: 'marked_failed' };
  }

  if (eventName === 'refund.processed' || eventName === 'refund.created') {
    const entity = event.payload?.refund?.entity;
    const paymentId = entity ? String(entity.payment_id ?? '') : '';
    if (!paymentId) return { handled: false, reason: 'missing_payment' };
    const payment = await deps.store.get<PaymentDoc>(paths.payment(paymentId));
    if (!payment) return { handled: false, reason: 'payment_not_found' };
    await deps.store.merge(paths.payment(paymentId), {
      status: 'refunded',
      updatedAt: deps.now(),
    });
    const order = await findOrderByProviderId(deps, payment.providerOrderId);
    if (order) {
      await deps.store.merge(paths.rechargeOrder(order.orderId), {
        status: 'refunded',
        failureReason: `refund:${String(entity?.status ?? 'processed')}`,
      });
      deps.hub.publishToUser(order.userId, {
        type: 'payment',
        order: paymentOrderPayload({ ...order, status: 'refunded' }),
      });
    }
    return { handled: true, reason: 'refund_recorded' };
  }

  return { handled: false, reason: 'ignored_event' };
}

export async function findOrderByProviderId(
  deps: AppDeps,
  razorpayOrderId: string,
): Promise<RechargeOrderDoc | null> {
  const results = await deps.store.query<RechargeOrderDoc>('rechargeOrders', {
    filters: [{ field: 'razorpayOrderId', op: '==', value: razorpayOrderId }],
    limit: 1,
  });
  return results[0] ?? null;
}

async function markOrderFailed(
  deps: AppDeps,
  order: RechargeOrderDoc,
  reason: string,
): Promise<void> {
  await deps.store.merge(paths.rechargeOrder(order.orderId), {
    status: 'failed',
    failureReason: reason,
  });
  deps.hub.publishToUser(order.userId, {
    type: 'payment',
    order: paymentOrderPayload({ ...order, status: 'failed' }),
  });
}

export function assertQuantity(pricing: PricingDoc, quantityMl: number): void {
  if (!Number.isInteger(quantityMl) || quantityMl <= 0) {
    throw errors.badRequest('invalid_quantity', 'Quantity must be a positive integer in mL.');
  }
  const minMl = pricing.minimumRechargeLitres * 1000;
  const maxMl = pricing.maximumRechargeLitres * 1000;
  if (quantityMl < minMl || quantityMl > maxMl) {
    throw errors.badRequest(
      'quantity_out_of_range',
      `Quantity must be between ${pricing.minimumRechargeLitres} L and ${pricing.maximumRechargeLitres} L.`,
    );
  }
  if (quantityMl % 100 !== 0) {
    throw errors.badRequest('quantity_increment', 'Quantity must be a multiple of 100 mL.');
  }
}
