import type { AppConfig } from '../config/env.js';
import type { PaymentProvider, PaymentOrder, ProviderPayment } from '../types/deps.js';
import { errors } from '../utils/errors.js';
import { hmacSha256Hex, safeEqual } from '../utils/security.js';

/**
 * Razorpay REST client (Orders + Payments APIs) with local signature checks.
 * Only the backend ever sees the Key Secret and Webhook Secret.
 */
export class RazorpayProvider implements PaymentProvider {
  readonly mode: 'test' | 'live';

  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.mode = config.razorpay.mode;
  }

  private authHeader(): string {
    const { keyId, keySecret } = this.config.razorpay;
    if (!keyId || !keySecret) {
      throw errors.unavailable(
        'razorpay_not_configured',
        'Razorpay server credentials are not configured.',
      );
    }
    return `Basic ${Buffer.from(`${keyId}:${keySecret}`, 'utf8').toString('base64')}`;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`https://api.razorpay.com/v1${path}`, {
        ...init,
        headers: {
          Authorization: this.authHeader(),
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      throw errors.upstream(
        'razorpay_unreachable',
        `Could not reach Razorpay: ${(err as Error).message}`,
      );
    }
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const description =
        body && typeof body === 'object' && 'error' in body
          ? String((body as { error?: { description?: string } }).error?.description ?? '')
          : '';
      throw errors.upstream(
        'razorpay_api_error',
        `Razorpay API error (${response.status})${description ? `: ${description}` : ''}.`,
      );
    }
    return body as T;
  }

  async createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<PaymentOrder> {
    const order = await this.request<{
      id: string;
      amount: number;
      currency: string;
      status: string;
    }>('/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: 'INR',
        receipt: input.receipt,
        notes: input.notes,
      }),
    });
    return {
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      status: order.status,
    };
  }

  async fetchPayment(paymentId: string): Promise<ProviderPayment> {
    const payment = await this.request<{
      id: string;
      order_id: string;
      amount: number;
      currency: string;
      status: string;
      captured: boolean;
    }>(`/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' });
    return {
      id: payment.id,
      order_id: payment.order_id,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      captured: payment.captured === true || payment.status === 'captured',
    };
  }

  verifyCheckoutSignature(input: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean {
    const { keySecret } = this.config.razorpay;
    if (!keySecret) return false;
    const expected = hmacSha256Hex(keySecret, `${input.orderId}|${input.paymentId}`);
    return safeEqual(expected, input.signature.trim().toLowerCase());
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const { webhookSecret } = this.config.razorpay;
    if (!webhookSecret || !signature) return false;
    return safeEqual(hmacSha256Hex(webhookSecret, rawBody), signature.trim());
  }
}
