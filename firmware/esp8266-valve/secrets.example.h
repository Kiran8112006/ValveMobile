/* VALVE — device secrets template
 * ---------------------------------------------------------------------------
 * Copy this file to secrets.h (same folder) and fill in the real values.
 * secrets.h is Git-ignored and must never be committed, shared or logged.
 *
 * This file intentionally contains ONLY device-side values. Wi-Fi credentials
 * are provisioned at runtime through the Valve app and stored in LittleFS;
 * they are not compiled into the firmware.
 */

/* ThingsBoard Cloud MQTT endpoint. */
#define TB_SERVER "thingsboard.cloud"
#define TB_PORT 1883

/* Device access token from ThingsBoard → Device → Credentials.
 * This is DEVICE-side only. Never put it in the mobile app or backend.
 */
#define TB_DEVICE_TOKEN "REPLACE_WITH_THINGSBOARD_DEVICE_ACCESS_TOKEN"

/* Local device identifier used in telemetry and event IDs. Must match the
 * device record created by the admin in the Valve backend.
 */
#define DEVICE_ID "valve-esp8266-001"

/* WPA2 password for the temporary Valve-ESP8266-XXXX access point.
 * At least 8 characters. Unique per physical device. Print it on the label.
 */
#define SETUP_AP_PASSWORD "REPLACE_WITH_DEVICE_AP_PASSWORD"

/* One-time pairing token checked by the local provisioning endpoint.
 * Unique per device. Sent by the app as the X-Pairing-Token header.
 * Never reuse the ThingsBoard device access token here.
 */
#define SETUP_PAIRING_TOKEN "REPLACE_WITH_DEVICE_PAIRING_TOKEN"

#endif