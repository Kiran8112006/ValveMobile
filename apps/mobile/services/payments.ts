export interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: { name: string; email: string };
  theme: { color: string };
}

export interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayCheckout {
  open(options: RazorpayCheckoutOptions): Promise<RazorpaySuccess>;
}

/**
 * The native Razorpay Standard Checkout SDK. It requires a development build —
 * Expo Go cannot load the native module. Loaded lazily so the rest of the app
 * still works if the SDK is unavailable.
 */
export async function openRazorpayCheckout(
  options: RazorpayCheckoutOptions,
): Promise<RazorpaySuccess> {
  let checkout: RazorpayCheckout;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('react-native-razorpay') as { default?: RazorpayCheckout };
    const resolved = module.default ?? (module as unknown as RazorpayCheckout);
    if (!resolved?.open) throw new Error('missing open()');
    checkout = resolved;
  } catch {
    throw new Error(
      'Razorpay is unavailable in this build. Install the Valve development build (Expo Go does not include Razorpay).',
    );
  }
  return checkout.open(options);
}
