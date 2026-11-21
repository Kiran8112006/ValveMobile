# Hardware Setup

## ESP8266 NodeMCU + Relay + Solenoid

### Components

| Component | Description |
|-----------|-------------|
| **ESP8266 NodeMCU** | Development board with ESP8266 ESP-12E chip |
| **Relay Module** | 5V/12V relay with opto-isolation |
| **Solenoid Valve** | Normally-closed (NC) water valve |
| **Power Supply** | 5V USB or 7-12V VIN |
| **Water Tubing** | 6-8mm ID to valve inlet |
| **Fittings** | Barbed connectors, hose clamps |

### Wiring Diagram

```
           +5V     GND
            │       │
        ┌─────┼───────┼─────┐
        │     │       │     │
       GPIO12  GPIO13  GND
        │     │       │     │
       [----]   [----]  Relay Module
            (NC)         │
                         │
                ┌────────┼─────┐
                │        │     │
               Solenoid   Water
                │        │     │
                └────────┴─────┘
```

### Pin Assignment (valve_config.h)

```cpp
// Default pin assignments - configurable
#define RELAY_GPIO      12  // D6 - Controls relay (NC solenoid)
#define STATUS_LED      13  // D7 - Optional status LED
#define ADC_PIN         A0  // Analog pin for flow meter (optional)

// Relay active level
// Set to HIGH if relay energizes valve open
// Set to LOW if relay energizes valve open (invert logic)
#define RELAY_ACTIVE_LEVEL    HIGH

// Water accounting
// 1 second of relay energization ≈ 1000 mL (estimated)
// This is a rough estimate; actual flow depends on water pressure
#define SECOND_TO_ML        1000

// MQTT topics
#define TOPIC_TELEMETRY   "valve/telemetry"
#define TOPIC_RPC         "valve/rpc"
#define TOPIC_ATTRIBUTES  "valve/attributes"
```

### Firmware Flashing

```bash
# Compile firmware
/tty/acli/arduino-cli.exe --config-file /tmp/acli.yaml compile \
  --fqbn esp8266:esp8266:nodemcuv2 firmware/esp8266-valve \
  --output-dir /tmp/fwbuild

# Upload firmware
/tty/acli/arduino-cli.exe --config-file /tmp/acli.yaml upload \
  --fqbn esp8266:esp8266:nodemcuv2 \
  -p <COM_PORT> firmware/esp8266-valve
```

### Default Flash Command (from historical memory)

```
/tmp/acli/arduino-cli.exe --config-file /tmp/acli.yaml compile \
  --fqbn esp8266:esp8266:nodemcuv2 firmware/esp8266-valve \
  --output-dir /tmp/fwbuild
```

Compiles successfully with RAM 45%, flash 31%.

### Wi-Fi Provisioning

The ESP8266 supports two provisioning methods:

#### 1. SoftAP Mode (Initial Setup)

1. Power on ESP8266 while holding the setup button
2. Device creates its own Wi-Fi network: `Valve-XXXXXX`
3. Connect phone to this network
4. App discovers device and sends Wi-Fi credentials
5. ESP8266 connects to home Wi-Fi and stores config in LittleFS

#### 2. WPA2 Enterprise (Production)

- Requires dev build with proper entitlements
- Uses 802.1x with certificate authentication
- Not recommended for initial deployment

### Safety Critical: Fail-Closed Design

**The system fails closed by default:**

- On Wi-Fi loss: Relay de-energized (valve closed)
- On MQTT disconnect: Relay de-energized
- On backend crash: Relay de-energized (no keep-alive)
- On firmware crash/restart: Relay de-energized
- On power loss: Valve normally-closed, remains closed

**Never rely on slow polling or keep-alive signals.**

### GPIO Configuration

The relay active level is configurable in `valve_config.h`:

```cpp
// NC (Normally-Closed) solenoid:
// - Relay OFF → valve CLOSED (no water flow)
// - Relay ON → valve OPEN (water flows)

// Set RELAY_ACTIVE_LEVEL to match your relay module:
// HIGH: Relay energizes when GPIO is high
// LOW:  Relay energizes when GPIO is low

// Important: Verify before energizing any solenoid!
// Incorrect active level could cause continuous water flow.
```

### ThingsBoard Cloud Integration

1. **Create account**: https://thingsboard.cloud
2. **Register device**: Add a new device with unique UUID
3. **Get API Key**:
   - Type: `ApiKey`
   - Credential: `READ_WRITE`
   - Use as `X-Authorization` header or ` thingsboard-token` query param
4. **Configure device attributes** (via RPC or telemetry):
   - `balanceMl` (number) - remaining water in mL
   - `totalEstimatedDispensedMl` (number) - total since install
   - `status` (string) - `connected`, `offline`, `maintenance`
   - `lastSeenAt` (number) - Unix epoch ms
5. **RPC Methods** (backend → device):
   - `openValve` - Energize relay for specified ms
   - `closeValve` - De-energize relay immediately
   - `emergencyOff` - Cut power, log abort reason
   - `setBalance` - Set remaining mL (admin only)

### ESP8266 LittleFS Persistence

Critical state is persisted in LittleFS filesystem:

```
/abort.json - Written when session is abnormally terminated
  {
    "abortedSessionId": "string",
    "finalSequence": number,
    "stopReason": "timeout|emergency|wifi_lost|manual",
    "consumedMl": number,
    "timestamp": number
  }
```

This file is written on:
- Emergency off activation
- Wi-Fi connection loss during dispensing
- Power loss detection (on restart)
- Normal session completion

On device restart, the firmware reads `/abort.json` to determine if a session needs recovery or cleanup.

### Flow Meter Calibration (Optional)

For more accurate than estimated dispensing:

1. Connect flow meter to ADC pin (A0)
2. Calibration factor depends on flow meter model
3. Firmware pulses counter on falling edge
4. Report `consumedMl` based on actual measured flow

Default: Use estimated (1s = 1000mL). Calibration optional.

### Power Consumption

| State | Current | Description |
|-------|---------|-------------|
| Active dispensing | ~80 mA | Relay energized, Wi-Fi connected |
| Idle (Wi-Fi connected) | ~25 mA | MQTT keep-alive, no dispensing |
| Deep sleep | ~0.5 µA | Not currently implemented |
| SoftAP provisioning | ~30 mA | AP mode only |

### Maintenance

- Check valve seal periodically for leaks
- Clean flow meter filter (if installed)
- Verify relay contacts every 3 months
- Monitor ESP8266 temperature (should < 45°C)
- Update firmware via OTA when available

## iOS Hotspot Entitlement

For iOS Wi-Fi module (`NEHotspotConfiguration`):

1. Add `Hotspot` to `UIBackgroundModes` in `Info.plist`
2. Request entitlement from Apple Developer Portal
3. Build with development provisioning profile
4. Test on physical iOS device only (simulator limited)

## Android Wi-Fi Module

The custom `modules/valve-wifi` Android Kotlin module requires:

1. `ACCESS_FINE_LOCATION` permission (required for Wi-Fi scanning)
2. `CHANGE_WIFI_STATE` permission
3. Debug build for initial testing
4. Release build with proper permissions for production

## Reference: Old Project (ThingsBoard Only)

This project references `C:\Projects\Valve` for ThingsBoard setup only:
- Rule chain webhook script/payload format
- API key usage pattern
- Device token derivation
- UUID format for device registry

Do not reuse any other code or configuration from the old project.