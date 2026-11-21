# ThingsBoard Cloud Setup

This document explains how to set up ThingsBoard Cloud for the Valve Mobile system.

## Account Creation

1. Go to https://thingsboard.cloud and click "Sign up"
2. Create an account with your email address
3. Verify your email and log in
4. Create a new tenant (or use the default shared tenant)

## Device Registration

### Method 1: Via UI

1. In the ThingsBoard Cloud dashboard, click **"Devices"** → **"Add Device"**
2. Select **"Add a new device"** 
3. Enter a **Device Name** (e.g., `valve-node-001`)
4. Click **"Add"** - the device is created with a unique UUID
5. **Copy the Device UUID** - you'll need this for firmware config

### Method 2: Via API

```bash
curl -i -X POST \
  -H "X-Authorization: your-api-key" \
  -H "Content-Type: application/json" \
  "https://thingsboard.cloud/api/v1/device" \
  -d '{"name": "valve-node-001", "type": "esp8266"}'
```

## API Key Configuration

### Create API Key

1. Go to **"Authentication"** → **"API Keys"**
2. Click **"Create API Key"**
3. Name: `Valve-Mobile-App`
4. Type: Select **`ApiKey`**
5. Credential: Select **`READ_WRITE`**
6. Click **"Create"**
7. **Copy the API Key** - this is your `THINGSBOARD_API_KEY`

### API Key Usage

The API key is used for:

| Purpose | Method |
|---------|--------|
| **Telemetry upload** | `POST /api/v1/{device_uuid}/telemetry` \
  Header: `X-Authorization: your-api-key` |
| **RPC calls** | `POST /api/v1/{device_uuid}/rpc` \
  Header: `X-Authorization: your-api-key` |
| **Attribute writes** | `POST /api/v1/{device_uuid}/attributes` \
  Header: `X-Authorization: your-api-key` |
| **MQTT connection** | `mqtt://thingsboard.cloud:1883` \
  Client ID: `device_{device_uuid}` \
  Username: `your-api-key` \
  Password: `thingsexchange` |

## Device Profile Configuration

### Attribute Keys

Configure these attribute keys on your device profile:

| Attribute Key | Type | Description |
|--------------|------|-------------|
| `balanceMl` | Number | Remaining water in mL (integer) |
| `totalEstimatedDispensedMl` | Number | Total estimated dispensed in mL |
| `status` | String | `connected`, `offline`, `maintenance` |
| `lastSeenAt` | Number | Unix epoch milliseconds |

### RPC Method Keys

Configure these RPC method keys for backend → device communication:

| Method Key | Description | Direction |
|-----------|-------------|-----------|
| `openValve` | Energize relay for specified ms | Backend → Device |
| `closeValve` | De-energize relay immediately | Backend → Device |
| `emergencyOff` | Cut power, log abort reason | Backend → Device |
| `setBalance` | Set remaining mL (admin) | Backend → Device |

### Telemetry Key Mapping (firmware → cloud)

Ensure your firmware publishes to these telemetry keys:

```json
{
  "balanceMl": <integer>,
  "totalEstimatedDispensedMl": <integer>,
  "status": "connected",
  "lastSeenAt": <unix_ms>
}
```

## Webhook Setup (Backend → ThingsBoard)

The backend sends dispensing events to ThingsBoard via webhook. Configure:

### Webhook URL

Your backend public URL (via Cloudflare Tunnel or Cloud Run) that receives:

```
POST /api/thingsboard/webhook
```

### Webhook Payload

When a dispensing session completes, the backend sends:

```json
{
  "deviceId": "your-device-uuid",
  "sessionId": "session-uuid",
  "consumedMl": 500,
  "durationMs": 500,
  "timestamp": 1700000000000,
  "status": "completed"
}
```

### ThingsBoard Rule Chain

1. Create a new **Rule**: `Valve Dispensing Events`
2. **Event Type**: `REQUEST_ATTRIBUTION_CHANGE` or custom
3. **Payload Transformation**: Map JSON fields to attributes
4. **Action**: 
   - **Store to Database**: Save to D1/R2
   - **Forward to MQTT**: Publish to valve telemetry topic
   - **Email Notification**: Optional admin alert

### Alternative: Direct RPC

Instead of webhook, the backend can call RPC directly:

```http
POST /api/v1/{device_uuid}/rpc
X-Authorization: your-api-key
Content-Type: application/json

{
  "method": "openValve",
  "params": {
    "durationMs": 3000
  }
}
```

## MQTT Topics

### Telemetry (Device → Cloud)

```
v1/devices/me/telemetry
Payload: {"balanceMl": 850, "totalEstimatedDispensedMl": 12500, "status": "connected"}
```

### Attributes (Device → Cloud)

```
v1/devices/me/attributes
Payload: {"status": "connected", "lastSeenAt": 1700000000000}
```

### RPC Request (Backend → Device)

```
v1/rpc/request/{request_id}
Payload: {"method": "openValve", "params": {"durationMs": 3000}}
```

### RPC Response (Device → Backend)

```
v1/rpc/response/{request_id}
Payload: {"status": "success", "durationMs": 3000, "consumedMl": 300}
```

## Firmware Configuration Integration

Update `firmware/esp8266-valve/valve_config.h` with:

```cpp
// ThingsBoard configuration
#define THINGSBOARD_SERVER   "thingsboard.cloud"
#define THINGSBOARD_PORT     1883
#define THINGSBOARD_API_KEY  "your-api-key-here"
#define THINGSBOARD_DEVICE_UUID "your-device-uuid-here"

// MQTT topics (usually no need to change)
#define TOPIC_TELEMETRY   "v1/devices/me/telemetry"
#define TOPIC_ATTRIBUTES  "v1/devices/me/attributes"
#define TOPIC_RPC_REQUEST "v1/rpc/request/+"
#define TOPIC_RPC_RESPONSE "v1/rpc/response/+"
```

## Testing Connection

### MQTT Test (via mosquitto_pub)

```bash
mosquitto_pub -h thingsboard.cloud -p 1883 \
  -u "your-api-key" -P "thingsexchange" \
  -t "v1/devices/me/telemetry" \
  -i "valve-node-001" \
  -m '{"balanceMl": 1000, "status": "connected"}'
```

### RPC Test

```bash
curl -i -X POST \
  -H "X-Authorization: your-api-key" \
  -H "Content-Type: application/json" \
  "https://thingsboard.cloud/api/v1/your-device-uuid/rpc" \
  -d '{"method": "openValve", "params": {"durationMs": 1000}}'
```

Expected response:
```json
{"status": "success", "durationMs": 1000, "consumedMl": 1000}
```

## Troubleshooting

### Common Issues

| Problem | Cause | Fix |
|---------|-------|-----|
| Device not connecting | Wrong API key | Verify `THINGSBOARD_API_KEY` |
| No telemetry appearing | Wrong topic | Check `TOPIC_TELEMETRY` in firmware |
| RPC calls failing | Device not in READ_WRITE mode | Recreate API key with WRITE |
| Status stuck at `offline` | Wi-Fi loss | Check fail-closed behavior |
| Balance not updating | Telemetry key mismatch | Verify `balanceMl` attribute key |

### Debug Mode

Enable firmware debug logging:

```cpp
#define DEBUG 1
```

Check Arduino Serial Monitor for:
- MQTT connection events
- RPC method calls
- Telemetry publish status
- Wi-Fi connection/disconnect reasons

## Reference: Old Project Setup

This project references `C:\Projects\Valve` for the original ThingsBoard configuration:

- Original rule chain webhook script format
- API key generation pattern
- Device token derivation
- UUID format for device registry

**Only the webhook payload structure and API key usage pattern** are reused. Do not copy any other code or configuration from the old project.