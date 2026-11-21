# Valve Mobile

A React Native/Expo mobile client for remote water dispensing control with prepaid accounting, admin features, Firebase backend, ThingsBoard integration, and Razorpay payments.

## Overview

This project consists of three main components:

1. **Mobile App** (Expo/React Native) - Customer and admin interfaces
2. **Backend API** (Fastify/Node.js) - Server-side logic, auth, accounting, webhooks
3. **Firmware** (ESP8266 Arduino) - Device firmware for valve control

## Prerequisites

- Node.js 24.x
- Python 3 (for some build tools)
- Java JDK 17 (for Android)
- Android SDK (adb available)
- Expo CLI
- Arduino CLI 1.6.0+
- ESP8266 core for Arduino CLI

## Quick Start

```bash
# 1. Install root dependencies
npm install

# 2. Install mobile dependencies
cd apps/mobile && npm install

# 3. Install backend dependencies
cd apps/backend && npm install

# 4. Copy .env.example to .env and fill in values
cp .env.example .env

# 5. Start the backend server
cd apps/backend && npm run dev

# 6. Start the mobile app (expo)
cd apps/mobile && npx expo start
```

## Available Scripts

### Root

| Script | Description |
|--------|-------------|
| `npm install` | Install all dependencies (mobile + backend) |
| `npm run lint` | Run ESLint on all code |
| `npm run typecheck` | Run TypeScript type check |

### Mobile

| Script | Description |
|--------|-------------|
| `npx expo start` | Start Expo dev server |
| `npx expo run:android` | Run on Android device/emulator |
| `npx expo run:ios` | Run on iOS device/simulator |

### Backend

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Fastify dev server (tsx) |
| `npm run build` | Build TypeScript to dist/ |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npx vitest run` | Run all 85 tests |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          MOBILE APP                              │
│  (Expo SDK 58, React Native 0.88.1, React 19.3.1)               │
│  - Expo Router for navigation                                   │
│  - Firebase Auth with AsyncStorage persistence                 │
│  - Realtime WebSocket for live updates                         │
│  - Razorpay SDK for payments                                   │
│  - Custom valve-wifi module (Android Kotlin + iOS Swift)       │
└───────────────────────▲─────────────────────────────────────────┘
                        │
                        │ WebSocket (WSS)
                        │
┌───────────────────────▼─────────────────────────────────────────┐
│                         BACKEND API                              │
│  (Fastify, Node.js, TypeScript)                                │
│  - Firebase Admin SDK for auth & Firestore                     │
│  - D1 database (planned)                                       │
│  - Accounting with idempotent transactions                     │
│  - ThingsBoard REST client (RPC)                               │
│  - Razorpay provider/service                                   │
│  - Rate limiting & CORS                                        │
│  - WebSocket secure endpoint                                   │
└───────────────────────▲─────────────────────────────────────────┘
                        │
                        │ HTTPS + JSON
                        │
┌───────────────────────▼─────────────────────────────────────────┐
│                         THINGSBOARD CLOUD                        │
│  - Device registry & telemetry                                 │
│  - RPC calls for valve control                                 │
│  - Attribute updates (balance, status)                        │
│  - Webhook for dispensing events                               │
└───────────────────────▲─────────────────────────────────────────┘
                        │
                        │ MQTT / HTTP
                        │
┌───────────────────────▼─────────────────────────────────────────┐
│                          ESP8266 FIRMWARE                        │
│  (Arduino, ESP8266 core 3.1.2)                                 │
│  - Wi-Fi provisioning (SoftAP + WPA2)                          │
│  - MQTT client for telemetry                                   │
│  - LittleFS for session abort persistence                      │
│  - Relay control (1s = ~1000 mL)                               │
│  - OTA update support                                         │
└─────────────────────────────────────────────────────────────────┘
```

## Mobile Screens

| Screen | Path | Description |
|--------|------|-------------|
| Login | `(auth)/login.tsx` | Email/password login |
| Register | `(auth)/register.tsx` | Create new account |
| Forgot Password | `(auth)/forgot-password.tsx` | Password reset |
| Home | `app/(tabs)/index.tsx` | Main dashboard |
| Customers | `app/(tabs)/customers.tsx` | Customer list |
| Customer Detail | `app/customer/[uid].tsx` | Customer details by UID |
| Device | `app/(tabs)/device.tsx` | Device status |
| Admin Overview | `components/admin/AdminOverviewScreen.tsx` | Admin dashboard |
| Admin History | `components/admin/AdminHistoryScreen.tsx` | Admin history |
| Settings | `app/(tabs)/settings.tsx` | User settings |
| Recharge | `app/(tabs)/recharge.tsx` | Add credit/balance |

## Backend API

### Base URL

```
http://localhost:3000 (development)
https://your-domain.com (production)
```

### Key Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET /api/admin/time` | Server time |
| `GET /api/customer/overview` | Customer overview (balance, device, sessions) |
| `GET /api/customer/:uid` | Customer detail |
| `POST /api/pairing/code` | Generate pairing code |
| `POST /api/pairing/claim` | Claim device |
| `POST /api/sessions/start` | Start dispensing session |
| `POST /api/sessions/emergency-off` | Emergency stop |
| `POST /api/transactions/credit` | Add credit |
| `POST /api/transactions/refund` | Refund transaction |
| `WebSocket /ws` | Real-time updates |

### WebSocket

Connect to `ws://localhost:3000/ws?token=<idToken>` for live updates:
- `ready` - Connection established
- `balance` - Balance update
- `session` - Session status change
- `device` - Device status
- `dispensing` - Dispensing in progress
- `payment` - Payment completed

## Firestore Rules

The project uses strict default-deny Firestore rules (see `firebase/firestore.rules`):
- Clients can only read their own data
- Admin operations require `admin` custom claim
- Server-only writes for balances, payments, credits
- Audit logs are append-only

## Payment Integration (Razorpay)

Payments are handled via Razorpay SDK:

1. Admin configures price per litre in the admin panel
2. Customer initiates recharge
3. Razorpay order is created on the server
4. Customer completes payment on Razorpay checkout
5. Server verifies signature and credits account
6. Idempotent operations prevent double-charging

Payments are disabled until pricing is configured. See `docs/PAYMENT_SETUP.md` for details.

## Hardware Setup

### ESP8266 NodeMCU

- **GPIO pin**: Configurable (default D1/D2 for relay)
- **Relay**: Normally-closed solenoid valve
- **Power**: 5V via USB or VIN
- **Water flow**: ~1 second = ~1000 mL (estimated)

### Wiring

```
ESP8266 GPIO12 (D6) → Relay Module → Solenoid Valve
ESP8266 GPIO13 (D7) → Status LED (optional)
GND → GND (common ground)
```

### ThingsBoard Cloud

1. Create a free ThingsBoard Cloud account
2. Register a new device
3. Obtain API Key (ApiKey type: READ_WRITE)
4. Configure device profile with attributes:
   - `balanceMl` - remaining water in mL
   - `totalEstimatedDispensedMl` - total dispensed
   - `status` - connected/offline
   - `lastSeenAt` - timestamp

### Wi-Fi Provisioning

- **Phone → ESP8266**: Credentials via SoftAP
- **Protected**: One-time pairing token
- **Per-device setup password**: Unique per device

## Credential Guide

See `docs/CREDENTIAL_SETUP.md` for exact PowerShell commands and credential tables.

## Deployment

### Cloud Run (Asia-South1)

The backend is configured for Google Cloud Run deployment:

```bash
# Build and deploy
gcloud run deploy valve-backend \
  --image us-central1-docker.pkg.com/valve-mobile/valve-backend:latest \
  --region asia-south1 \
  --allow-unauthenticated
```

### Cloudflare Tunnel (for local webhooks)

Use Cloudflare Tunnel to expose local development server to the internet for ThingsBoard webhooks:

```bash
cloudflared tunnel --url http://localhost:3000
```

This provides a stable public URL that ThingsBoard can webhook to.

### Firestore Emulator (local dev)

```bash
firebase emulators:start --only firestore,auth
```

## Testing

### Backend

```bash
cd apps/backend && npx vitest run
# 85 tests pass
```

### Mobile

Type checking:
```bash
cd apps/mobile && npx tsc --noEmit
```

## License

MIT