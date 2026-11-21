/* VALVE — ESP8266 valve controller configuration
 * ----------------------------------------------------------------------------
 * Every value below is intentionally editable. Do not treat the defaults as a
 * verified electrical design: confirm the relay input logic, GPIO, solenoid
 * voltage/current and relay ratings against the real hardware before enabling
 * the valve.
 * SAFETY: the relay must be wired so the valve is CLOSED when the ESP8266 is
 * unpowered or booting. The firmware drives RELAY_OFF_LEVEL before anything
 * else in setup().
 */

#ifndef VALVE_CONFIG_H
#define VALVE_CONFIG_H

/* ---- Relay wiring -------------------------------------------------------- */
#ifndef RELAY_PIN
#define RELAY_PIN D1
#endif

/* Many relay modules are active LOW. Do not assume: measure the module or read
 * its datasheet. Set to HIGH for active-HIGH relay inputs. */
#ifndef RELAY_ACTIVE_LEVEL
#define RELAY_ACTIVE_LEVEL LOW
#endif

/* De-energized level. Normally closed solenoid + de-energized relay = closed. */
#ifndef RELAY_OFF_LEVEL
#define RELAY_OFF_LEVEL (RELAY_ACTIVE_LEVEL == HIGH ? LOW : HIGH)
#endif

/* Optional momentary button to re-enter setup mode (NodeMCU FLASH button is
 * GPIO0, active LOW). Hold for PAIRING_HOLD_MS. Set to -1 to disable. */
#ifndef PAIRING_BUTTON_PIN
#define PAIRING_BUTTON_PIN 0
#endif
#ifndef PAIRING_HOLD_MS
#define PAIRING_HOLD_MS 3000UL
#endif

/* ---- Dispensing ---------------------------------------------------------- */
/* 1 second of energized valve time = 1 litre = 1000 mL estimated. */
#ifndef VALVE_OPEN_DURATION_MS
#define VALVE_OPEN_DURATION_MS 1000UL
#endif
/* Closed interval between cycles. Not counted as consumption. */
#ifndef CYCLE_CLOSED_GAP_MS
#define CYCLE_CLOSED_GAP_MS 100UL
#endif
/* Local sanity ceiling; the backend also caps authorized volume. */
#ifndef MAX_AUTHORIZED_ML
#define MAX_AUTHORIZED_ML 100000UL
#endif

/* ---- Event queue / networking ------------------------------------------- */
#ifndef MAX_PENDING_EVENTS
#define MAX_PENDING_EVENTS 16
#endif
#ifndef EVENT_RETRY_INTERVAL_MS
#define EVENT_RETRY_INTERVAL_MS 4000UL
#endif
#ifndef HEARTBEAT_INTERVAL_MS
#define HEARTBEAT_INTERVAL_MS 15000UL
#endif
#ifndef MQTT_RETRY_INTERVAL_MS
#define MQTT_RETRY_INTERVAL_MS 5000UL
#endif
#ifndef WIFI_RETRY_INTERVAL_MS
#define WIFI_RETRY_INTERVAL_MS 10000UL
#endif
/* If saved Wi-Fi cannot be reached for this long (and no session is active),
 * fall back to setup mode so the customer can reconfigure the device. */
#ifndef WIFI_SETUP_FALLBACK_MS
#define WIFI_SETUP_FALLBACK_MS 120000UL
#endif

/* ---- Provisioning & Direct Mode ------------------------------------------ */
#ifndef DIRECT_AP_MODE
#define DIRECT_AP_MODE true
#endif
#ifndef DEFAULT_OFFLINE_BALANCE_ML
#define DEFAULT_OFFLINE_BALANCE_ML 50000UL
#endif
#ifndef DIRECT_SAFETY_TIMEOUT_MS
#define DIRECT_SAFETY_TIMEOUT_MS 120000UL
#endif
#ifndef SETUP_AP_PREFIX
#define SETUP_AP_PREFIX "Valve-ESP8266-"
#endif

/* ---- Identity ------------------------------------------------------------ */
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "1.0.0"
#endif
#ifndef HARDWARE_MODEL
#define HARDWARE_MODEL "ESP8266 NodeMCU"
#endif

#endif