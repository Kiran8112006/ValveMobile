# Architecture

## System Overview

The Valve Mobile system is a full-stack application with a clear separation of concerns between mobile client, backend API, and embedded firmware.

### Layered Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                            PRESENTATION                          │
│  (Expo/React Native, TypeScript, Luaude icons)                 │
│  - Expo Router navigation                                      │
│  - React Native UI components                                  │
│  - Firebase Auth (AsyncStorage)                                │
│  - Realtime WebSocket subscriptions                            │
│  - Razorpay payment SDK                                        │
└───────────────────────▲─────────────────────────────────────────┘
                        │
                        │ WSS + JWT
                        │
┌───────────────────────▼─────────────────────────────────────────┐
│                            APPLICATION                             │
│  (Fastify, Node.js, TypeScript)                                │
│  ┌─────────────────────┐  ┌─────────────────────────────┐    │
│  │  Auth & Session     │  │  Accounting & Transactions    │    │
│  │  (custom claims,   │  │  (idempotent, allowance)    │    │
│  │   Firestore roles)│  │                               │    │
│  └─────────────────────┘  └─────────────────────────────┘    │
│  ┌─────────────────────┐  ┌─────────────────────────────┐    │
│  │  Realtime WS        │  │  Payment (Razorpay)         │    │
│  │  (live updates)     │  │  (order, verify, refund)    │    │
│  └─────────────────────┘  └─────────────────────────────┘    │
│  ┌─────────────────────┐  ┌─────────────────────────────┐    │
│  │  ThingsBoard client │  │  Provisioning & Pairing       │    │
│  │  (RPC, telemetry)   │  │  (Wi-Fi, claim code)        │    │
│  └─────────────────────┘  └─────────────────────────────┘    │
└───────────────────────▲─────────────────────────────────────────┘
                        │
                        │ HTTPS + JSON
                        │
┌───────────────────────▼─────────────────────────────────────────┐
│                            INFRASTRUCTURE                        │
│  (Cloudflare, Firebase, ThingsBoard)                          │
│  ┌─────────────────────┐  ┌─────────────────────────────┐    │
│  │  Firebase Auth      │  │  Firestore Database         │    │
│  │  (users, custom     │  │  (collections: customers,   │    │
│  │   claims)           │  │   transactions, sessions,   │    │
│  │                     │  │   devices, admin)           │    │
│  └─────────────────────┘  └─────────────────────────────┘    │
│  ┌─────────────────────┐  ┌─────────────────────────────┐    │
│  │  ThingsBoard Cloud  │  │  Cloud Run (backend API)    │    │
│  │  (device registry,   │  │  (Fastify, API routes)      │    │
│   │ telemetry, RPC)     │  └─────────────────────────────┘    │
│  └─────────────────────┘                               │
│                                                             │
│  ┌─────────────────────┐                                │
│  │  ESP8266 Firmware     │                                │
│  │  (Arduino, ESP8266) │                                │
│  └─────────────────────┘                                │
└─────────────────────────────────────────────────────────────────┘
```

## Component Details

### Mobile App (Expo/React Native)

- **SDK**: Expo 58, React Native 0.88.1, React 19.3.1
- **Navigation**: expo-router 58 (file-based)
- **Auth**: `@firebase/auth` with `initializeAuth`/`getReactNativePersistence`
- **Persistence**: AsyncStorage v3 (`createAsyncStorage('valve-auth')`)
- **Realtime**: Custom WebSocket-based realtime subscription hub
- **Wi-Fi**: Custom local Expo module `modules/valve-wifi`
  - Android: `WifiNetworkSpecifier` + `bindProcessToNetwork`
  - iOS: `NEHotspotConfiguration`
- **Payments**: `react-native-razorpay` 3.0.0
- **Navigation**: Role-based routing (customer vs admin)

### Backend API (Fastify)

- **Framework**: Fastify with TypeScript
- **Auth**: Firebase Admin SDK token verification + custom claims + Firestore role check
- **Database**: Firebase Firestore (production) / in-memory store (tests)
- **Accounting**: Idempotent transaction store with partial-allowance logic
- **Realtime**: Secure WebSocket endpoint (`/ws?token=`)
- **ThingsBoard**: REST client with two-way RPC and telemetry subscription
- **Payments**: Razorpay provider/service with signature verification
- **Rate limiting**: Per-IP and per-user limits
- **CORS**: Configured origins only
- **Error handling**: Registered before routes (encapsulation)

### ESP8266 Firmware

- **Arduino CLI**: 1.6.0 at `/tmp/acli/arduino-cli.exe`
- **Board**: esp8266:esp8266:nodemcuv2
- **Core**: Arduino 15 (3.1.2)
- **Key Libraries**:
  - PubSubClient 2.8.0 (MQTT)
  - ArduinoJson 6.21.5 (JSON parsing)
- **Files**:
  - `firmware/esp8266-valve/esp8266-valve.ino` (main firmware)
  - `firmware/esp8266-valve/valve_config.h` (configuration)
  - `firmware/esp8266-valve/secrets.example.h` (placeholder secrets)
  - `firmware/esp8266-valve/secrets.h` (local overrides, gitignored)
- **Accounting**: 1 second relay-energized = ~1000 mL estimated
  - Partial cycles deduct exact measured ms as mL
  - Integer mL internally
  - Label: "Estimated water dispensed"
- **Fail-closed**: On lost connectivity, relay de-energized
- **Heartbeat**: Reports `abortedSessionId`, `finalSequence`, `stopReason`
  - Persisted in LittleFS `/abort.json`
- **Wi-Fi**: Protected SoftAP, per-device setup password + pairing token

### Firebase

- **Auth**: Custom claims for admin/customer roles
- **Firestore**: Default-deny client rules, server-admin writes
- **Collections**: customers, devices, sessions, transactions, admin/audit

### ThingsBoard Cloud

- **Protocol**: MQTT + HTTP + RPC
- **Authentication**: API Key (ApiKey type: READ_WRITE)
- **Device telemetry**: balanceMl, totalEstimatedDispensedMl, status, lastSeenAt
- **RPC**: Valve control (open/close, emergency off)
- **Webhook**: Receives dispensing events from backend

## Data Flow

### Normal Dispensing Cycle

1. Customer selects quantity on mobile app
2. App calls `POST /api/sessions/start`
3. Backend verifies balance, creates Firestore session
4. Backend sends RPC to ThingsBoard: `valve.open`
5. ESP8266 energizes relay for measured time
6. ESP8266 reports consumed mL via MQTT
7. Backend updates Firestore: balance decreased, total increased
8. App receives realtime update, shows estimated dispensed
9. Session completes, relay de-energized (fail-closed)

### Payment Recharge

1. Admin sets price per litre
2. Customer initiates recharge on mobile
3. Frontend creates Razorpay order on server
4. Customer completes payment on Razorpay checkout
5. Server verifies Razorpay signature
6. Server credits customer balance atomically
7. Transaction recorded in Firestore
8. Realtime update pushes new balance to all clients

### Wi-Fi Provisioning

1. User puts ESP8266 in provisioning mode (SoftAP)
2. Phone connects to device AP
3. App sends Wi-Fi credentials (SSID + password)
4. ESP8266 connects to home network
5. One-time pairing token validates device ownership
6. Device claims itself to Firebase via custom auth

## Security Model

### Authentication

- Firebase Auth with email/password
- Custom claims: `admin` boolean
- Id tokens verified on every backend request

### Authorization (Firestore Rules)

| Resource | Client Access | Admin Access |
|----------|--------------|--------------|
| `users/{uid}` | Deny all | Write via admin SDK |
| `customers/{id}` | Read own only | CRUD |
| `sessions/{id}` | Read own only | CRUD |
| `devices/{id}` | Read all | CRUD |
| `transactions/{id}` | Read own only | CRUD |
| `admin/pricing` | Read only | CRUD |
| `admin/credits/{id}` | Read own only | CRUD |
| `admin/audit/{id}` | Deny all | Create only |

### Network

- WebSocket requires valid Firebase ID token
- CORS restricted to configured origins
- Rate limiting on all write endpoints
- Redacted logs (no PII in error output)

### Data Validation

- Server-side validation on all inbound payloads
- Idempotency keys for payment/credit operations
- Schema validation with Zod (or similar)
- Balance never goes negative (enforced by rules)

## Configuration

### Environment Variables

See `.env.example` for all required variables:
- Firebase project IDs and keys
- API base URL
- ThingsBoard tenant and API key
- Razorpay keys
- Admin secret
- WebSocket URL

### Admin Configuration

- Price per litre configured via admin panel or Firestore `admin/pricing`
- Credits adjusted via `admin/credits/{uid}`
- Pricing disabled until configured (recharge blocked)

### Firmware Configuration

- `valve_config.h`: GPIO pins, relay active level, Wi-Fi settings
- `secrets.h`: Wi-Fi credentials, Firebase token (not version-controlled)
- Power defaults: 1s relay = ~1000 mL (estimated)

## Extensions

### Realtime Enhancements

- Durable snapshots in D1 database
- Room-based presence tracking
- Broadcast status updates to all devices in a room

### Payment Extensions

- Multi-currency support
- Refund engine with audit trail
- Subscription-based recurring payments

### Mobile Extensions

- Dark mode support
- Offline queue for when connectivity is lost
- Biometric authentication fallback

### Backend Extensions

- D1 database migration from Firestore
- GraphQL API layer
- Background job queue ( Bull/Redis)
- API rate limit per-tenant