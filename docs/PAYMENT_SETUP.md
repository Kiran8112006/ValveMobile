# Payment Setup (Razorpay)

This document explains the payment configuration and integration for the Valve Mobile system.

## Overview

Payments are handled via **Razorpay** - a Indian payment gateway SDK. The system supports:

- Customer recharge (adding credit/balance)
- Idempotent credit operations (no double-charging)
- Refunds with audit trail
- Price per litre configured by admin

**Payments are disabled until pricing is configured.** Until then, the recharge screen is disabled and a message shows "Pricing not configured."

## Prerequisites

### Razorpay Account

1. Go to https://razorpay.com and sign up for an account
2. Complete KYC verification
3. Obtain your API keys:
   - **Key ID**: `rzp_test_XXXXXXXXXXXXXXXX`
   - **Key Secret**: `your_test_key_secret`
4. For production: Replace `test` with `live` keys

### Backend Configuration

The following environment variables are required (see `.env.example`):

```
RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXXXXXX
RAZORPAY_KEY_SECRET=your_test_key_secret
```

## Integration Architecture

```
┌────────────────────────────────────────────────────────────┐
│                    CUSTOMER MOBILE APP                     │
│  - Razorpay SDK v3.0.0 embedded                             │
│  - Recharge initiation                                      │
│  - Payment completion callback                              │
└───────────────────────▲─────────────────────────────────────┘
                        │
                        │ HTTPS + JSON
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                    BACKEND API (Fastify)                     │
│  - Creates Razorpay orders                                  │
│  - Verifies payment signatures                              │
│  - Idempotent credit operations                             │
│  - Rate limiting per user                                   │
│  - Redacted logs (no card details)                         │
└───────────────────────▲─────────────────────────────────────┘
                        │
                        │ HTTPS + JSON
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                    RAZORPAY PAYMENT GATEWAY                  │
│  - Order creation                                           │
│  - Payment page                                             │
│  - Payment verification                                     │
│  - Refund processing                                        │
└─────────────────────────────────────────────────────────────┘
```

## Step-by-Step Flow

### 1. Admin Configures Price

The admin sets the price per litre in the admin panel, which writes to Firestore:

```javascript
// Firestore path: admin/pricing
{
  "configured": true,
  "pricePerLitre": 500,  // in paise (₹5.00 per litre)
  "updatedAt": Timestamp.now()
}
```

**Until this is configured:**
- Recharge button is disabled
- Toast: "Pricing not configured. Contact admin."
- No payment requests are sent to Razorpay

### 2. Customer Initiates Recharge

Customer enters amount (in mL or ₹) on the Recharge screen:

```javascript
// Example: Recharge 500 mL at ₹5/L = ₹2.50
const amountMl = 500;          // mL to dispense
const pricePerLitre = 500;     // 500 paise = ₹5.00 per litre
const pricePaise = Math.round((amountMl / 1000) * pricePerLitre); // 250 paise = ₹2.50
```

### 3. Server Creates Razorpay Order

Frontend calls `POST /api/payments/create-order`:

```json
POST /api/payments/create-order
Content-Type: application/json
X-Authorization: <id_token>

{
  "amount": 250,     // in paise (₹2.50)
  "currency": "INR",
  "receipt": "valve-receipt-XXXX",
  "notes": {
    "customerId": "uid123",
    "amountMl": 500
  }
}
```

**Server response:**
```json
{
  "id": "order_XXXXXXXXX",
  "entity": "order",
  "amount": 250,
  "currency": "INR",
  "status": "created",
  "ceipt": "receipt_XXXXXXXXX",
  "offer_id": null
}
```

### 4. Customer Completes Payment

Razorpay checkout opens:

```javascript
// Frontend JavaScript
const razorpay = new Razorpay({
  key_id: 'rzp_test_XXXXXXXXXXXXXXX',
  key_secret: 'your_test_key_secret',
});

const payment = razorpay.open({
  amount: 250,           // in paise
  currency: 'INR',
  receipt: 'receipt_XXXXXXXXX',
  notes: {
    customerId: 'uid123',
    amountMl: 500
  }
});

// Handle payment response
payment.on('payment.failed', (error) => {
  console.error(error);
  // Show error to user
});

payment.on('payment.success', (paymentId) => {
  // Notify backend
  fetch('/api/payments/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Authorization': userIdToken
    },
    body: JSON.stringify({
      razorpayPaymentId: paymentId,
      razorpayOrderId: orderId,
      razorpaySignature: signature
    })
  });
});
```

### 5. Server Verifies Signature

Backend endpoint `POST /api/payments/verify`:

1. Receive: `razorpayPaymentId`, `razorpayOrderId`, `razorpaySignature`
2. Compute expected signature:
   ```
   signature = sha256_hex(`${orderId}|${paymentId}`)
   ```
   Using: `razorpayKeySecret` as the key
3. Compare: `computedSignature === razorpaySignature`
4. If valid: credit the customer's balance
5. If invalid: reject with 400

### 6. Credit Account (Idempotent)

On verified payment:

```javascript
// Firestore: transactions collection
// Create with idempotency key
const transactionId = `txn-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Check for existing transaction (idempotency)
const existing = await db.collection('transactions')
  .doc(transactionId).get();
if (existing.exists) {
  // Already processed - return existing result
  return existing.data();
}

// Create transaction record
await db.collection('transactions').doc(transactionId).set({
  customerId: uid,
  amountMl: 500,
  amountPaise: 250,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
  status: 'completed',
  createdAt: Timestamp.now(),
  type: 'recharge'
});

// Credit the balance (atomic increment)
await db.collection('customers').doc(uid).update({
  'profile.balanceMl': admin.firestore.FieldValue.increment(500),
  'profile.totalEstimatedDispensedMl': admin.firestore.FieldValue.increment(500),
  'profile.lastRechargeAt': Timestamp.now()
});

// Create audit log
await db.collection('admin/audit').doc(transactionId).set({
  action: 'recharge',
  customerId: uid,
  amountMl: 500,
  amountPaise: 250,
  status: 'completed',
  initiatedBy: 'razorpay',
  timestamp: Timestamp.now()
});
```

## Idempotency

### Why It Matters

- Network timeouts may cause the customer to retry payment
- Razorpay may send the same webhook twice
- User may rotate device and restart the app

### Implementation

Each transaction record has a unique `transactionId` (composed of timestamp + random). The server:

1. Checks if `transactionId` already exists in Firestore
2. If yes: returns the existing transaction data (no double-credit)
3. If no: creates the new transaction and credits the account

**Transaction ID format:** `txn-{timestamp}-{8-random-chars}`

### Rate Limiting

- Max 5 recharge attempts per hour per user
- Exponential backoff on failures
- All failures logged (redacted - no card data)

## Refunds

### When to Refund

- Duplicate payment (customer charged twice)
- Admin-initiated credit adjustment
- Service failure (valve malfunction during dispensing)

### Refund Flow

1. Admin initiates refund from admin panel
2. Backend calls Razorpay refund API:
   ```http
   POST https://api.razorpay.com/v1/refunds
   Authorization: basic <base64-key-secret>
   Content-Type: application/json
   
   {
     "payment_id": "pay_XXXXXXXXX",
     "amount": 250,     // in paise (optional, full by default)
     "notes": {
       "reason": "duplicate-payment"
     }
   }
   ```
3. Razorpay processes refund (T+1 business days)
4. Transaction status updated to `refunded`
5. Balance decremented atomically

### Refund Restrictions

- Refunds can only be issued for **completed** payments
- Partial refunds are allowed (specify `amount` in paise)
- Full refunds must be within 180 days of payment
- No refunds after 180 days (Razorpay policy)

## Testing

### Test Mode (Recommended)

Razorpay provides test credentials:

| Field | Test Value | Live Value |
|-------|-----------|-----------|
| `key_id` | `rzp_test_XXXXXXXXXXXXXXX` | `rzp_live_XXXXXXXXXXXXXXX` |
| `key_secret` | `your_test_key_secret` | `your_live_key_secret` |

### Test Cards

Use these test card details in the Razorpay checkout:

| Card Number | CVV | Expiry |
|------------|-----|--------|
| `4242 4242 4242 4242` | `123` | Any future date |
| `5555 5555 5555 5555` | `123` | Any future date |

These always trigger the test flow (no real money moves).

### Test Scenarios

1. **Successful payment**: Card `4242 4242 4242 4242` any future expiry
2. **Failed payment**: Card `4242 4242 4242 4242` expiry `01/20` (fails CVV)
3. **Idempotent retry**: First payment succeeds, retry also succeeds (balance only credited once)
4. **Pricing not configured**: Recharge button disabled, message shown

### Backend Test Suite

Run existing tests:

```bash
cd apps/backend && npx vitest run
# Tests 85 pass, including:
# - payments.test.ts: 13 tests ( Razorpay signature / idempotent credit / refund )
```

## Environment Checklist

### .env Requirements

```
# Razorpay
RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXXXXX
RAZORPAY_KEY_SECRET=your_test_key_secret
```

### Firestore Pricing

```javascript
// admin/pricing document
{
  configured: true,
  pricePerLitre: 500,  // paise, e.g. 500 = ₹5.00 per litre
}
```

### Mobile App Feature Flag

In `RealtimeContext` or auth check:
- If `pricing.configured === false`: disable recharge UI
- If `pricing.configured === true`: enable recharge UI

## Production Checklist

- [ ] Razorpay account created and KYC completed
- [ ] Test keys integrated and verified
- [ ] Live keys ready (when ready to go production)
- [ ] Price per litre configured in Firestore `admin/pricing`
- [ ] Recharge UI tested with test cards
- [ ] Idempotency tested (retry scenarios)
- [ ] Refund flow tested (admin-initiated)
- [ ] Audit logs working (no PII in logs)
- [ ] Rate limiting configured
- [ ] Error messages user-friendly (no raw Razorpay errors)
- [ ] Backups of transaction records