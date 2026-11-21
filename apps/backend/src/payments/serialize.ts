import type { RechargeOrderDoc } from '../types/domain.js';
import type { PublicOrder } from '../types/realtime.js';

export function paymentOrderPayload(order: RechargeOrderDoc): PublicOrder {
  return {
    orderId: order.orderId,
    userId: order.userId,
    quantityMl: order.quantityMl,
    amountPaise: order.amountPaise,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    creditedAt: order.creditedAt ? order.creditedAt.toISOString() : null,
  };
}
