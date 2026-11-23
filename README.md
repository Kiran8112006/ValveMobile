# Valve Mobile

A React Native/Expo mobile client for remote water dispensing control with prepaid accounting, admin features, Firebase backend, ThingsBoard integration, and Razorpay payments.

## Overview

This project consists of three main components:

1. **Mobile App** (Expo/React Native) - Customer and admin interfaces with QR-based pairing and real-time WebSocket state management.
2. **Backend API** (Fastify/Node.js) - Server-side logic, auth, accounting, webhooks, and ThingsBoard RPC integration.
3. **Firmware** (ESP8266 Arduino) - Embedded firmware for solenoid valve relay control, local SoftAP provisioning, and cloud MQTT telemetry.

## Remote IoT Architecture (Home Water Node)

The system is architected as an IoT home node network (one node per household) accessible from any location:

```
[ User Smartphone (Anywhere in the world on 4G/5G/Wi-Fi) ]
                           │
                           │ HTTPS / WSS
                           ▼
                 [ Fastify Backend API ]
                           │
                           │ REST RPC
                           ▼
             [ ThingsBoard Cloud Broker ]
                           │
                           │ MQTT (Port 1883) via Internet
                           ▼
              [ Home Wi-Fi Access Point ]
                           │
                           │ 802.11 b/g/n
                           ▼
          [ ESP8266 Water Node (Solenoid Valve) ]
```

### How Global Remote Access Operates

1. **Home Internet Link**: The ESP8266 node connects to the home's Wi-Fi router, obtaining outbound internet access.
2. **Persistent Cloud MQTT Channel**: The device maintains an authenticated MQTT session with ThingsBoard Cloud (`thingsboard.cloud:1883`) using its unique device token.
3. **Remote RPC Commands**: When a customer taps to start dispensing in the mobile app from any external network, the backend dispatches an RPC request through ThingsBoard. The ESP8266 receives the command in real-time, opens the solenoid relay, tracks dispensed volume, and returns execution confirmation.
4. **Live Cloud Telemetry**: The node publishes regular heartbeats, consumption events, and Wi-Fi signal strength (RSSI) back to `v1/devices/me/telemetry` so the user can observe live status from anywhere.
5. **Fail-Closed Safety**: The firmware enforces an immediate shut-off policy. If Wi-Fi drops, MQTT disconnects, the allowance runs out, or an abort is signaled, the relay is immediately de-energized to prevent unmetered water flow.

### Operating Modes

* **Cloud Mode (Primary)**: Standard mode where the node communicates over home Wi-Fi and ThingsBoard Cloud for global remote access.
* **Direct Standalone Mode (Offline Fallback)**: If broadband internet is unavailable, the ESP8266 can broadcast its own local access point (`Valve-Water-Dispenser`) exposing a local REST API (`/api/status`, `/api/valve/start`, `/api/valve/stop`) so a nearby phone can operate the valve directly without internet.

---

## Device Pairing, QR Code & Provisioning System

The system includes a complete onboarding flow to connect newly installed home nodes to the user's account and home Wi-Fi network.

### QR Code Specification

The mobile app's built-in camera scanner reads a custom URI format:

```text
valve://pair?deviceId=<deviceId>&claimCode=<claimCode>&apSsid=<apSsid>&apPassword=<apPassword>&pairingToken=<pairingToken>
```

| Query Parameter | Description |
|-----------------|-------------|
| `deviceId` | Unique identifier of the device in Firestore (e.g., `valve-esp8266-001`). |
| `claimCode` | One-time authorization code verified against `claimCodeHash` in Firestore. |
| `apSsid` | Temporary setup access point name broadcast by the node (e.g., `Valve-ESP8266-XXXX`). |
| `apPassword` | WPA2 password required to join the node's setup hotspot (from `secrets.h`). |
| `pairingToken` | Security token sent in the `X-Pairing-Token` HTTP header during provisioning. |

### Generating the QR Code Label

The physical ESP8266 does **not** need to be powered or connected to generate the label. The QR code is generated from software credentials:

```bash
# Generate QR code and printable HTML label with project defaults
npm run qr:generate

# Or generate with custom device parameters
node scripts/generate-qr.mjs [deviceId] [claimCode] [setupPassword] [pairingToken] [apSsid]
```

This command generates an HTML label document at:
```text
scripts/device-qr.html
```
Open `device-qr.html` in any web browser to view, scan directly off the monitor, or print as an adhesive sticker for the hardware enclosure.

### In-App Onboarding Flow (Customer)

1. **Step 1 - Scan Label**: In the mobile app, navigate to `Connect device` and tap `Scan QR label`. The camera scanner parses the URI and auto-populates all device identifiers and security tokens.
2. **Step 2 - Join Setup Network**: The phone connects to the ESP8266 temporary setup hotspot (`Valve-ESP8266-XXXX`).
3. **Step 3 - Transmit Home Wi-Fi**: The user enters their home Wi-Fi SSID and password. The app sends these credentials directly to the ESP8266 over local HTTP (`POST http://192.168.4.1/provision`). Credentials are saved to internal flash memory (`LittleFS`) and are never sent to the cloud backend.
4. **Step 4 - Online Verification**: The ESP8266 restarts, connects to the home Wi-Fi router, and connects to ThingsBoard Cloud. The backend verifies the device heartbeat, associates the node with the customer's account in Firestore, and marks pairing complete.

### Developer Fast-Track Pairing

For local testing without running the SoftAP provisioning wizard:
1. Configure `WIFI_SSID` and `WIFI_PASSWORD` directly in `firmware/esp8266-valve/secrets.h`.
2. Run the direct setup script to bind the device to a user with an initial 50 L credit:
```bash
node scripts/setup-device.mjs user@example.com
```

---

## Firmware Implementation Details

The Arduino firmware is located in `firmware/esp8266-valve/esp8266-valve.ino`. Key functions and their roles:

* **Wi-Fi Connectivity (`maintainNetwork()`)**:
  Manages the station connection to the home router using credentials stored in LittleFS (`/wifi.json`). Reconnects automatically on signal drop. Falls back to setup mode if disconnected beyond `WIFI_SETUP_FALLBACK_MS`.
* **Cloud MQTT Client (`maintainMqtt()`)**:
  Maintains connection to ThingsBoard Cloud. Subscribes to the RPC topic `v1/devices/me/rpc/request/+` to accept incoming commands.
* **Remote RPC Dispatcher (`mqttCallback()`)**:
  Deserializes incoming JSON requests from the cloud. Dispatches commands for:
  * `setValve`: Controls valve state (`on`/`off`) with authorized dispensing limits.
  * `getDeviceStatus`: Reports current state, active session, remaining allowance, and Wi-Fi RSSI.
  * `ackConsumptionEvent`: Acknowledges recorded water events to clear pending buffers.
* **Dispensing Control (`handleOnCommand()`, `handleOffCommand()`, `updateDispensing()`)**:
  Drives the relay pin using calibrated timing (`VALVE_OPEN_DURATION_MS = 1000` ms per 1000 mL). Enforces maximum authorization allowances locally.
* **Telemetry Reporting (`publishHeartbeat()`, `publishTelemetry()`)**:
  Periodically sends JSON status packets to `v1/devices/me/telemetry` including device state, relay state, consumed volume, sequence numbers, and RSSI.
* **Durable Event Buffer (`publishPendingEvents()`)**:
  Saves dispensing records to LittleFS flash (`/events.json`). Ensures water consumption data is persisted and re-sent to the backend even after unexpected power cycles.
* **Local HTTP Provisioning Server (`configureWebServer()`, `handleProvision()`)**:
  Runs a lightweight web server on port 80 during setup mode to receive Wi-Fi configuration and execute pairing token validation.

---

## Prerequisites

- Node.js 24.x
- Python 3 (for build tools)
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
| `npm run qr:generate` | Generate pairing QR code and printable HTML label for ESP8266 node |
| `npm run admin:promote` | Promote a user account to administrator role |

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
| Connect Device | `app/connect-device.tsx` | 4-step QR scan and Wi-Fi provisioning wizard |
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
| `POST /api/devices/pairing/challenge` | Generate pairing challenge |
| `POST /api/devices/assign` | Assign device to user |
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

- **GPIO pin**: Configurable in `valve_config.h` (default D1 for relay)
- **Relay**: Normally-closed solenoid valve
- **Power**: 5V via USB or VIN
- **Water flow**: ~1 second = ~1000 mL (estimated)

### Wiring

```
ESP8266 GPIO5 (D1) → Relay Module Input → Solenoid Valve
ESP8266 GND        → Relay Module GND   → Power Supply Ground
5V External Supply → Solenoid Valve Power Contact
```

### Safety Critical: Fail-Closed Policy

The system fails closed by default:
- On Wi-Fi loss: Relay de-energized (valve closed)
- On MQTT disconnect: Relay de-energized
- On backend failure: Relay de-energized
- On firmware restart: Relay de-energized in initial boot instruction
- On power loss: Valve is normally-closed, remains closed

## Deployment

### Cloud Run (Asia-South1)

The backend is configured for Google Cloud Run deployment:

```bash
gcloud run deploy valve-backend \
  --image us-central1-docker.pkg.com/valve-mobile/valve-backend:latest \
  --region asia-south1 \
  --allow-unauthenticated
```

### Cloudflare Tunnel (for local webhooks)

Use Cloudflare Tunnel to expose the local development server to the internet for ThingsBoard webhooks:

```bash
cloudflared tunnel --url http://localhost:3000
```

### Firestore Emulator (local dev)

```bash
firebase emulators:start --only firestore,auth
```

## Testing

### Backend

```bash
cd apps/backend && npx vitest run
```

### Mobile

Type checking:
```bash
cd apps/mobile && npx tsc --noEmit
```

## License

MIT
