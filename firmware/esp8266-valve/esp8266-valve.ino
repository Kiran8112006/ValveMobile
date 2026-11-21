/*
 * ============================================================================
 * VALVE — ESP8266 NodeMCU solenoid valve controller
 * ============================================================================
 *
 * Hardware:
 *   - ESP8266 NodeMCU (ESP8266 Arduino core 3.x)
 *   - Relay module (input driven by RELAY_PIN, active level configurable)
 *   - Normally-closed solenoid water valve on the relay contacts
 *   - Independent, correctly rated valve power supply
 *
 * Water model:
 *   - One second of actual relay-energized time = 1000 mL estimated.
 *   - Partial cycles are reported in integer millilitres (measured ms).
 *   - The device enforces its authorized allowance locally.
 *
 * Safety:
 *   - Relay is driven OFF as the first action in setup().
 *   - The valve is de-energized immediately on Wi-Fi/MQTT loss, OFF command,
 *     allowance exhaustion, queue exhaustion, or fault.
 *   - No session survives a reboot.
 *   - Wi-Fi credentials are provisioned at runtime over a protected local
 *     SoftAP and are never transmitted to the backend or printed to Serial.
 *
 * Dependencies (Arduino Library Manager):
 *   - PubSubClient by Nick O'Leary (2.8.x)
 *   - ArduinoJson by Benoit Blanchon (6.21.x)
 * ESP8266 core 3.1.2 was used for compilation verification.
 * ============================================================================
 */

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <DNSServer.h>
#include <LittleFS.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

#include "secrets.h"
#include "valve_config.h"

/* -------------------------------------------------------------------------- */
/* Types and state                                                            */
/* -------------------------------------------------------------------------- */

enum ValveDeviceState {
  ST_BOOT_SAFE,
  ST_SETUP_AP,
  ST_WIFI_CONNECTING,
  ST_MQTT_CONNECTING,
  ST_IDLE,
  ST_VALVE_OPEN,
  ST_CYCLE_PAUSE,
  ST_STOPPING,
  ST_EVENT_SYNC,
  ST_FAULT
};

struct PendingEvent {
  char eventId[96];
  char sessionId[64];
  uint32_t sequence;
  uint32_t quantityMl;
  uint32_t durationMs;
  bool finalEvent;
  char type[16];
  char stopReason[24];
  uint32_t lastPublishMs;
};

#define WIFI_CREDENTIALS_FILE "/wifi.json"
#define EVENT_QUEUE_FILE "/events.json"
#define ABORT_RECORD_FILE "/abort.json"

ESP8266WebServer httpServer(80);
DNSServer dnsServer;
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

ValveDeviceState g_state = ST_BOOT_SAFE;

/* Relay */
bool g_relayEnergized = false;
uint32_t g_relayStartMs = 0;

/* Session */
bool g_sessionActive = false;
char g_sessionId[64] = "";
uint32_t g_authorizedMl = 0;
uint32_t g_consumedMl = 0;
uint32_t g_sequence = 0;
uint32_t g_cycleTargetMs = 0;
uint32_t g_pauseUntilMs = 0;
char g_bootId[24] = "";

/* Provisioning / networking */
bool g_setupMode = false;
bool g_webServerConfigured = false;
char g_wifiSsid[33] = "";
char g_wifiPassword[65] = "";
char g_apSsid[40] = "";
uint32_t g_lastWifiAttemptMs = 0;
uint32_t g_lastMqttAttemptMs = 0;
uint32_t g_lastHeartbeatMs = 0;
uint32_t g_wifiDownSinceMs = 0;
uint32_t g_buttonDownSinceMs = 0;
bool g_buttonWasDown = false;

/* Last aborted session, reported on reconnect so the backend can reconcile it
 * even if no water was dispensed (for example, the valve was between cycles). */
bool g_hasAbortRecord = false;
char g_abortedSessionId[64] = "";
uint32_t g_abortedFinalSequence = 0;
char g_abortedReason[24] = "";

/* Direct offline mode balance */
#define LOCAL_BALANCE_FILE "/balance.json"
uint32_t g_localBalanceMl = DEFAULT_OFFLINE_BALANCE_ML;
uint32_t g_totalDispensedMl = 0;
uint32_t g_sessionStartMs = 0;

/* Persistent event queue */
PendingEvent g_pending[MAX_PENDING_EVENTS];
size_t g_pendingCount = 0;

/* -------------------------------------------------------------------------- */
/* Forward declarations                                                       */
/* -------------------------------------------------------------------------- */

void publishHeartbeat();
void publishPendingEvents(bool force);
void finishSession(const char *reason);
void abortForNetwork(const char *reason);
void enterSetupMode();
void writeRelayOff();
void saveAbortRecord(const char *sessionId, uint32_t finalSequence, const char *reason);
void loadAbortRecord();
void clearAbortRecord();
bool saveEventQueue();
bool loadEventQueue();

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const char *stateName(ValveDeviceState state) {
  switch (state) {
    case ST_BOOT_SAFE: return "boot_safe";
    case ST_SETUP_AP: return "setup_ap";
    case ST_WIFI_CONNECTING: return "wifi_connecting";
    case ST_MQTT_CONNECTING: return "mqtt_connecting";
    case ST_IDLE: return "idle";
    case ST_VALVE_OPEN: return "valve_open";
    case ST_CYCLE_PAUSE: return "cycle_pause";
    case ST_STOPPING: return "stopping";
    case ST_EVENT_SYNC: return "event_sync";
    case ST_FAULT: return "fault";
    default: return "unknown";
  }
}

void generateSessionId() {
  snprintf(
      g_bootId,
      sizeof(g_bootId),
      "%08X%04X",
      ESP.getChipId(),
      (uint16_t)(RANDOM_REG32 & 0xFFFF));
}

void writeRelayOff() {
  digitalWrite(RELAY_PIN, RELAY_OFF_LEVEL);
  g_relayEnergized = false;
}

void writeRelayOn() {
  g_relayStartMs = millis();
  g_relayEnergized = true;
  digitalWrite(RELAY_PIN, RELAY_ACTIVE_LEVEL);
}

uint32_t relayElapsedMs() {
  if (!g_relayEnergized) return 0;
  return millis() - g_relayStartMs;
}

/* -------------------------------------------------------------------------- */
/* Wi-Fi credential storage (LittleFS)                                        */
/* -------------------------------------------------------------------------- */

bool loadWifiCredentials() {
  File file = LittleFS.open(WIFI_CREDENTIALS_FILE, "r");
  if (!file) return false;
  StaticJsonDocument<320> doc;
  DeserializationError err = deserializeJson(doc, file);
  file.close();
  if (err) return false;
  const char *ssid = doc["ssid"] | "";
  const char *password = doc["password"] | "";
  if (strlen(ssid) == 0 || strlen(ssid) > 32 || strlen(password) > 64) return false;
  strncpy(g_wifiSsid, ssid, sizeof(g_wifiSsid) - 1);
  strncpy(g_wifiPassword, password, sizeof(g_wifiPassword) - 1);
  return true;
}

bool saveWifiCredentials(const char *ssid, const char *password) {
  File file = LittleFS.open(WIFI_CREDENTIALS_FILE, "w");
  if (!file) return false;
  StaticJsonDocument<320> doc;
  doc["ssid"] = ssid;
  doc["password"] = password;
  bool ok = serializeJson(doc, file) > 0;
  file.close();
  return ok;
}

void clearWifiCredentials() {
  LittleFS.remove(WIFI_CREDENTIALS_FILE);
  g_wifiSsid[0] = '\0';
  g_wifiPassword[0] = '\0';
}

bool loadLocalBalance() {
  File file = LittleFS.open(LOCAL_BALANCE_FILE, "r");
  if (!file) {
    g_localBalanceMl = DEFAULT_OFFLINE_BALANCE_ML;
    g_totalDispensedMl = 0;
    return true;
  }
  StaticJsonDocument<256> doc;
  DeserializationError err = deserializeJson(doc, file);
  file.close();
  if (err) return false;
  g_localBalanceMl = doc["balanceMl"] | DEFAULT_OFFLINE_BALANCE_ML;
  g_totalDispensedMl = doc["totalDispensedMl"] | 0UL;
  return true;
}

bool saveLocalBalance() {
  File file = LittleFS.open(LOCAL_BALANCE_FILE, "w");
  if (!file) return false;
  StaticJsonDocument<256> doc;
  doc["balanceMl"] = g_localBalanceMl;
  doc["totalDispensedMl"] = g_totalDispensedMl;
  bool ok = serializeJson(doc, file) > 0;
  file.close();
  return ok;
}

/* -------------------------------------------------------------------------- */
/* Persistent event queue                                                     */
/* -------------------------------------------------------------------------- */

bool saveEventQueue() {
  File file = LittleFS.open(EVENT_QUEUE_FILE, "w");
  if (!file) {
    Serial.println("[QUEUE] Failed to open queue file for writing");
    return false;
  }
  DynamicJsonDocument doc(6144);
  JsonArray events = doc.createNestedArray("events");
  for (size_t i = 0; i < g_pendingCount; i++) {
    JsonObject item = events.createNestedObject();
    item["eventId"] = g_pending[i].eventId;
    item["sessionId"] = g_pending[i].sessionId;
    item["sequence"] = g_pending[i].sequence;
    item["quantityMl"] = g_pending[i].quantityMl;
    item["durationMs"] = g_pending[i].durationMs;
    item["final"] = g_pending[i].finalEvent;
    item["type"] = g_pending[i].type;
    item["stopReason"] = g_pending[i].stopReason;
  }
  bool ok = serializeJson(doc, file) > 0;
  file.close();
  return ok;
}

bool loadEventQueue() {
  g_pendingCount = 0;
  File file = LittleFS.open(EVENT_QUEUE_FILE, "r");
  if (!file) return false;
  DynamicJsonDocument doc(6144);
  DeserializationError err = deserializeJson(doc, file);
  file.close();
  if (err) return false;
  JsonArray events = doc["events"].as<JsonArray>();
  for (JsonObject item : events) {
    if (g_pendingCount >= MAX_PENDING_EVENTS) break;
    PendingEvent &slot = g_pending[g_pendingCount];
    memset(&slot, 0, sizeof(slot));
    strncpy(slot.eventId, item["eventId"] | "", sizeof(slot.eventId) - 1);
    strncpy(slot.sessionId, item["sessionId"] | "", sizeof(slot.sessionId) - 1);
    slot.sequence = item["sequence"] | 0UL;
    slot.quantityMl = item["quantityMl"] | 0UL;
    slot.durationMs = item["durationMs"] | 0UL;
    slot.finalEvent = item["final"] | false;
    strncpy(slot.type, item["type"] | "partial_cycle", sizeof(slot.type) - 1);
    strncpy(slot.stopReason, item["stopReason"] | "", sizeof(slot.stopReason) - 1);
    slot.lastPublishMs = 0;
    g_pendingCount++;
  }
  return true;
}

bool queueEvent(uint32_t quantityMl, uint32_t durationMs, bool finalEvent, const char *reason) {
  if (g_pendingCount >= MAX_PENDING_EVENTS) {
    Serial.println("[QUEUE] FULL — refusing to continue dispensing");
    return false;
  }
  PendingEvent &slot = g_pending[g_pendingCount];
  memset(&slot, 0, sizeof(slot));
  snprintf(
      slot.eventId,
      sizeof(slot.eventId),
      "%s:%s:%lu",
      DEVICE_ID,
      g_bootId,
      (unsigned long)g_sequence);
  strncpy(slot.sessionId, g_sessionId, sizeof(slot.sessionId) - 1);
  slot.sequence = g_sequence;
  slot.quantityMl = quantityMl;
  slot.durationMs = durationMs;
  slot.finalEvent = finalEvent;
  strncpy(
      slot.type,
      quantityMl >= VALVE_OPEN_DURATION_MS ? "full_cycle" : "partial_cycle",
      sizeof(slot.type) - 1);
  strncpy(slot.stopReason, reason == NULL ? "" : reason, sizeof(slot.stopReason) - 1);
  slot.lastPublishMs = 0;
  g_pendingCount++;
  saveEventQueue();
  return true;
}

void acknowledgeEvent(const char *eventId) {
  for (size_t i = 0; i < g_pendingCount; i++) {
    if (strcmp(g_pending[i].eventId, eventId) == 0) {
      for (size_t j = i; j + 1 < g_pendingCount; j++) {
        g_pending[j] = g_pending[j + 1];
      }
      g_pendingCount--;
      saveEventQueue();
      Serial.printf("[QUEUE] Acknowledged %s, pending=%u\n", eventId, (unsigned)g_pendingCount);
      return;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Relay / dispensing engine                                                  */
/* -------------------------------------------------------------------------- */

/* Close the relay and record exactly the measured energized time. The quantity
 * is capped to the remaining authorized allowance so the valve can never
 * consume more than the backend authorized. */
void closeRelayAndRecord(bool finalEvent, const char *reason) {
  uint32_t elapsed = relayElapsedMs();
  writeRelayOff();
  if (elapsed == 0) return;

  uint32_t remaining = g_authorizedMl > g_consumedMl ? g_authorizedMl - g_consumedMl : 0;
  if (elapsed > remaining) elapsed = remaining;
  if (elapsed > VALVE_OPEN_DURATION_MS) elapsed = VALVE_OPEN_DURATION_MS;
  if (elapsed == 0) return;

  g_consumedMl += elapsed;
  g_sequence++;
  if (DIRECT_AP_MODE) {
    if (g_localBalanceMl >= elapsed) {
      g_localBalanceMl -= elapsed;
    } else {
      g_localBalanceMl = 0;
    }
    g_totalDispensedMl += elapsed;
    saveLocalBalance();
  } else {
    if (!queueEvent(elapsed, elapsed, finalEvent, reason)) {
      g_state = ST_FAULT;
      Serial.println("[FAULT] Event queue exhausted; dispensing halted");
      return;
    }
    publishPendingEvents(true);
  }
  Serial.printf(
      "[CYCLE] %lu ms -> %lu mL estimated, consumed=%lu/%lu, balance=%lu\n",
      (unsigned long)elapsed,
      (unsigned long)elapsed,
      (unsigned long)g_consumedMl,
      (unsigned long)g_authorizedMl,
      (unsigned long)g_localBalanceMl);
}

void finishSession(const char *reason) {
  if (g_relayEnergized) {
    closeRelayAndRecord(true, reason);
  }
  g_sessionActive = false;
  g_cycleTargetMs = 0;
  g_pauseUntilMs = 0;
  if (g_state != ST_FAULT) g_state = DIRECT_AP_MODE ? ST_IDLE : ST_EVENT_SYNC;
  Serial.printf("[SESSION] Ended: %s (consumed=%lu mL)\n", reason, (unsigned long)g_consumedMl);
  if (!DIRECT_AP_MODE) publishHeartbeat();
}

void abortForNetwork(const char *reason) {
  Serial.printf("[FAIL-SAFE] Closing valve: %s\n", reason);
  if (g_sessionId[0] != '\0') {
    saveAbortRecord(g_sessionId, g_sequence, reason);
  }
  if (g_relayEnergized) {
    closeRelayAndRecord(true, reason);
  }
  g_sessionActive = false;
  g_state = ST_EVENT_SYNC;
  g_sessionId[0] = '\0';
  g_cycleTargetMs = 0;
  g_pauseUntilMs = 0;
  saveEventQueue();
}

void saveAbortRecord(const char *sessionId, uint32_t finalSequence, const char *reason) {
  g_hasAbortRecord = true;
  strncpy(g_abortedSessionId, sessionId, sizeof(g_abortedSessionId) - 1);
  g_abortedSessionId[sizeof(g_abortedSessionId) - 1] = '\0';
  g_abortedFinalSequence = finalSequence;
  strncpy(g_abortedReason, reason, sizeof(g_abortedReason) - 1);
  g_abortedReason[sizeof(g_abortedReason) - 1] = '\0';
  File file = LittleFS.open(ABORT_RECORD_FILE, "w");
  if (!file) return;
  StaticJsonDocument<256> doc;
  doc["sessionId"] = g_abortedSessionId;
  doc["finalSequence"] = g_abortedFinalSequence;
  doc["reason"] = g_abortedReason;
  serializeJson(doc, file);
  file.close();
}

void loadAbortRecord() {
  File file = LittleFS.open(ABORT_RECORD_FILE, "r");
  if (!file) return;
  StaticJsonDocument<256> doc;
  DeserializationError err = deserializeJson(doc, file);
  file.close();
  if (err) return;
  const char *sessionId = doc["sessionId"] | "";
  if (strlen(sessionId) == 0) return;
  g_hasAbortRecord = true;
  strncpy(g_abortedSessionId, sessionId, sizeof(g_abortedSessionId) - 1);
  g_abortedFinalSequence = doc["finalSequence"] | 0UL;
  strncpy(g_abortedReason, doc["reason"] | "device_aborted", sizeof(g_abortedReason) - 1);
}

void clearAbortRecord() {
  g_hasAbortRecord = false;
  g_abortedSessionId[0] = '\0';
  g_abortedFinalSequence = 0;
  g_abortedReason[0] = '\0';
  LittleFS.remove(ABORT_RECORD_FILE);
}

void startCycle() {
  if (!g_sessionActive || g_relayEnergized) return;
  if (millis() < g_pauseUntilMs) return;
  uint32_t remaining = g_authorizedMl - g_consumedMl;
  if (remaining == 0) {
    finishSession("allowance_exhausted");
    return;
  }
  if (g_pendingCount + 1 >= MAX_PENDING_EVENTS) {
    Serial.println("[FAULT] Pending event queue nearly full; stopping before the valve opens");
    g_state = ST_FAULT;
    g_sessionActive = false;
    writeRelayOff();
    publishHeartbeat();
    return;
  }
  g_cycleTargetMs = remaining < VALVE_OPEN_DURATION_MS ? remaining : VALVE_OPEN_DURATION_MS;
  g_state = ST_VALVE_OPEN;
  writeRelayOn();
  publishHeartbeat();
}

void updateDispensing() {
  if (!g_sessionActive) return;

  if (g_relayEnergized) {
    uint32_t elapsed = relayElapsedMs();
    if (elapsed >= g_cycleTargetMs) {
      uint32_t quantity = elapsed < g_cycleTargetMs ? elapsed : g_cycleTargetMs;
      uint32_t remaining = g_authorizedMl - g_consumedMl;
      if (quantity > remaining) quantity = remaining;
      /* Record the same value for quantity and duration: 1 ms = 1 mL. */
      writeRelayOff();
      g_consumedMl += quantity;
      g_sequence++;
      if (DIRECT_AP_MODE) {
        if (g_localBalanceMl >= quantity) {
          g_localBalanceMl -= quantity;
        } else {
          g_localBalanceMl = 0;
        }
        g_totalDispensedMl += quantity;
        saveLocalBalance();
      } else {
        if (!queueEvent(quantity, quantity, false, NULL)) {
          g_state = ST_FAULT;
          g_sessionActive = false;
          publishHeartbeat();
          return;
        }
        publishPendingEvents(true);
      }

      if (g_consumedMl >= g_authorizedMl || (DIRECT_AP_MODE && g_localBalanceMl == 0)) {
        finishSession("allowance_exhausted");
      } else {
        g_pauseUntilMs = millis() + CYCLE_CLOSED_GAP_MS;
        g_state = ST_CYCLE_PAUSE;
      }
    }
    return;
  }

  if (millis() >= g_pauseUntilMs) {
    startCycle();
  }
}

/* -------------------------------------------------------------------------- */
/* MQTT                                                                       */
/* -------------------------------------------------------------------------- */

template <typename TJsonDoc>
void publishTelemetry(TJsonDoc &doc) {
  if (!mqtt.connected()) return;
  char buffer[768];
  size_t length = serializeJson(doc, buffer, sizeof(buffer));
  if (length == 0) return;
  mqtt.publish("v1/devices/me/telemetry", buffer);
}

void publishHeartbeat() {
  if (!mqtt.connected()) return;
  StaticJsonDocument<512> doc;
  doc["eventType"] = "heartbeat";
  doc["deviceId"] = DEVICE_ID;
  doc["state"] = stateName(g_state);
  doc["valveState"] = g_relayEnergized ? "on" : "off";
  doc["relayState"] = g_relayEnergized ? "on" : "off";
  doc["activeSessionId"] = g_sessionActive ? g_sessionId : "";
  doc["remainingAuthorizedMl"] = g_authorizedMl > g_consumedMl ? g_authorizedMl - g_consumedMl : 0;
  doc["consumedMl"] = g_consumedMl;
  doc["sequence"] = g_sequence;
  doc["pendingEventCount"] = g_pendingCount;
  doc["wifiRssi"] = WiFi.RSSI();
  doc["firmwareVersion"] = FIRMWARE_VERSION;
  doc["hardwareModel"] = HARDWARE_MODEL;
  doc["bootId"] = g_bootId;
  if (g_hasAbortRecord) {
    doc["abortedSessionId"] = g_abortedSessionId;
    doc["finalSequence"] = g_abortedFinalSequence;
    doc["stopReason"] = g_abortedReason;
  }
  publishTelemetry(doc);
  g_lastHeartbeatMs = millis();
}

void publishPendingEvents(bool force) {
  if (!mqtt.connected() || g_pendingCount == 0) return;
  uint32_t now = millis();
  bool changed = false;
  for (size_t i = 0; i < g_pendingCount; i++) {
    PendingEvent &event = g_pending[i];
    if (!force && event.lastPublishMs != 0 &&
        (uint32_t)(now - event.lastPublishMs) < EVENT_RETRY_INTERVAL_MS) {
      continue;
    }
    StaticJsonDocument<512> doc;
    doc["eventType"] = "consumption_event";
    doc["deviceId"] = DEVICE_ID;
    doc["eventId"] = event.eventId;
    doc["sessionId"] = event.sessionId;
    doc["sequence"] = event.sequence;
    doc["quantityMl"] = event.quantityMl;
    doc["valveOpenDurationMs"] = event.durationMs;
    doc["type"] = event.type;
    doc["final"] = event.finalEvent;
    doc["stopReason"] = event.stopReason;
    doc["bootId"] = g_bootId;
    doc["firmwareVersion"] = FIRMWARE_VERSION;
    char buffer[640];
    size_t length = serializeJson(doc, buffer, sizeof(buffer));
    if (length == 0) continue;
    if (mqtt.publish("v1/devices/me/telemetry", buffer)) {
      event.lastPublishMs = now;
      changed = true;
    }
  }
  (void)changed;
}

void sendRpcResponse(const char *responseTopic, JsonDocument &doc) {
  char buffer[512];
  size_t length = serializeJson(doc, buffer, sizeof(buffer));
  if (length == 0) return;
  mqtt.publish(responseTopic, buffer);
}

void handleOnCommand(const char *responseTopic, JsonObject params) {
  const char *requestedSession = params["sessionId"] | "";
  uint32_t requestedAuthorized = params["authorizedMl"] | 0UL;

  StaticJsonDocument<256> response;
  if (g_sessionActive || g_relayEnergized) {
    response["success"] = false;
    response["error"] = "session_already_active";
    sendRpcResponse(responseTopic, response);
    return;
  }
  if (strlen(requestedSession) == 0 || requestedSession[0] == '\0' || requestedAuthorized == 0) {
    response["success"] = false;
    response["error"] = "invalid_authorization";
    sendRpcResponse(responseTopic, response);
    return;
  }
  if (requestedAuthorized > MAX_AUTHORIZED_ML) requestedAuthorized = MAX_AUTHORIZED_ML;
  if (g_pendingCount + 2 >= MAX_PENDING_EVENTS) {
    response["success"] = false;
    response["error"] = "event_queue_full";
    sendRpcResponse(responseTopic, response);
    return;
  }

  clearAbortRecord();
  generateSessionId();
  strncpy(g_sessionId, requestedSession, sizeof(g_sessionId) - 1);
  g_sessionId[sizeof(g_sessionId) - 1] = '\0';
  g_authorizedMl = requestedAuthorized;
  g_consumedMl = 0;
  g_sequence = 0;
  g_pauseUntilMs = 0;
  g_sessionActive = true;
  g_state = ST_IDLE;

  /* Acknowledge first; the relay energizes immediately after the response. */
  response["success"] = true;
  response["valveState"] = "on";
  response["sessionId"] = g_sessionId;
  response["authorizedMl"] = g_authorizedMl;
  sendRpcResponse(responseTopic, response);

  startCycle();
  publishHeartbeat();
}

void handleOffCommand(const char *responseTopic, JsonObject params) {
  const char *reason = params["reason"] | "rpc_off";
  if (g_relayEnergized) {
    closeRelayAndRecord(true, reason);
  }
  g_sessionActive = false;
  g_state = g_pendingCount > 0 ? ST_EVENT_SYNC : ST_IDLE;
  g_cycleTargetMs = 0;
  g_pauseUntilMs = 0;
  writeRelayOff();

  StaticJsonDocument<256> response;
  response["success"] = true;
  response["valveState"] = "off";
  response["finalSequence"] = g_sequence;
  response["pendingEventCount"] = g_pendingCount;
  response["consumedMl"] = g_consumedMl;
  sendRpcResponse(responseTopic, response);
  publishHeartbeat();
  Serial.printf("[RPC] OFF applied, finalSequence=%lu\n", (unsigned long)g_sequence);
}

void handleDeviceStatus(const char *responseTopic) {
  StaticJsonDocument<384> response;
  response["success"] = true;
  response["deviceId"] = DEVICE_ID;
  response["valveState"] = g_relayEnergized ? "on" : "off";
  response["state"] = stateName(g_state);
  response["sessionId"] = g_sessionActive ? g_sessionId : "";
  response["authorizedMl"] = g_authorizedMl;
  response["consumedMl"] = g_consumedMl;
  response["remainingAuthorizedMl"] =
      g_authorizedMl > g_consumedMl ? g_authorizedMl - g_consumedMl : 0;
  response["sequence"] = g_sequence;
  response["pendingEventCount"] = g_pendingCount;
  response["firmwareVersion"] = FIRMWARE_VERSION;
  response["wifiRssi"] = WiFi.RSSI();
  sendRpcResponse(responseTopic, response);
}

void mqttCallback(char *topic, byte *payload, unsigned int length) {
  char responseTopic[96];
  strncpy(responseTopic, topic, sizeof(responseTopic) - 1);
  responseTopic[sizeof(responseTopic) - 1] = '\0';
  char *requestPart = strstr(responseTopic, "request");
  if (requestPart != NULL) {
    strncpy(requestPart, "response", 8);
  }

  DynamicJsonDocument doc(1200);
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.printf("[RPC] Invalid JSON: %s\n", err.c_str());
    StaticJsonDocument<96> response;
    response["success"] = false;
    response["error"] = "invalid_json";
    sendRpcResponse(responseTopic, response);
    return;
  }

  const char *method = doc["method"] | "";
  JsonObject params = doc["params"].as<JsonObject>();

  if (strcmp(method, "setValve") == 0) {
    const char *state = params["state"] | "";
    bool on = strcmp(state, "on") == 0 || strcmp(state, "ON") == 0 || params["state"] == true;
    if (on) {
      handleOnCommand(responseTopic, params);
    } else {
      handleOffCommand(responseTopic, params);
    }
    return;
  }

  if (strcmp(method, "ackConsumptionEvent") == 0) {
    const char *eventId = params["eventId"] | "";
    acknowledgeEvent(eventId);
    StaticJsonDocument<192> response;
    response["success"] = true;
    response["acknowledged"] = eventId;
    response["pendingEventCount"] = g_pendingCount;
    sendRpcResponse(responseTopic, response);
    return;
  }

  if (strcmp(method, "getDeviceStatus") == 0) {
    handleDeviceStatus(responseTopic);
    return;
  }

  StaticJsonDocument<128> response;
  response["success"] = false;
  response["error"] = "unsupported_method";
  sendRpcResponse(responseTopic, response);
}

void maintainMqtt() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (mqtt.connected()) return;
  if (g_lastMqttAttemptMs != 0 &&
      (uint32_t)(millis() - g_lastMqttAttemptMs) < MQTT_RETRY_INTERVAL_MS) {
    return;
  }
  g_lastMqttAttemptMs = millis();
  g_state = ST_MQTT_CONNECTING;
  Serial.println("[MQTT] Connecting to ThingsBoard...");
  if (mqtt.connect(DEVICE_ID, TB_DEVICE_TOKEN, NULL)) {
    Serial.println("[MQTT] Connected");
    mqtt.subscribe("v1/devices/me/rpc/request/+");
    if (!g_sessionActive) g_state = ST_IDLE;
    publishHeartbeat();
    publishPendingEvents(true);
  } else {
    Serial.printf("[MQTT] Connect failed rc=%d\n", mqtt.state());
  }
}

/* -------------------------------------------------------------------------- */
/* Provisioning (SoftAP + local HTTP)                                         */
/* -------------------------------------------------------------------------- */

bool validSetupPassword() {
  return strlen(SETUP_AP_PASSWORD) >= 8;
}

void handleSetupInfo() {
  StaticJsonDocument<384> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["firmwareVersion"] = FIRMWARE_VERSION;
  doc["hardwareModel"] = HARDWARE_MODEL;
  doc["apSsid"] = g_apSsid;
  doc["requiresPairingToken"] = true;
  doc["message"] = "POST /provision with X-Pairing-Token, ssid and password";
  char buffer[384];
  size_t length = serializeJson(doc, buffer, sizeof(buffer));
  if (length == 0) {
    httpServer.send(500, "application/json", "{\"error\":\"serialization_failed\"}");
    return;
  }
  httpServer.send(200, "application/json", buffer);
}

void handleSetupNotFound() {
  httpServer.sendHeader("Location", "http://192.168.4.1/info", true);
  httpServer.send(302, "text/plain", "");
}

bool pairingTokenValid() {
  if (!httpServer.hasHeader("X-Pairing-Token")) return false;
  String provided = httpServer.header("X-Pairing-Token");
  if (provided.length() != strlen(SETUP_PAIRING_TOKEN)) return false;
  /* Constant-time-ish comparison. */
  unsigned char diff = 0;
  for (size_t i = 0; i < provided.length(); i++) {
    diff |= (unsigned char)(provided[i] ^ SETUP_PAIRING_TOKEN[i]);
  }
  return diff == 0;
}

void handleProvision() {
  if (!pairingTokenValid()) {
    httpServer.send(401, "application/json", "{\"error\":\"invalid_pairing_token\"}");
    return;
  }
  StaticJsonDocument<320> doc;
  DeserializationError err = deserializeJson(doc, httpServer.arg("plain"));
  if (err) {
    httpServer.send(400, "application/json", "{\"error\":\"invalid_json\"}");
    return;
  }
  const char *ssid = doc["ssid"] | "";
  const char *password = doc["password"] | "";
  size_t ssidLength = strlen(ssid);
  size_t passwordLength = strlen(password);
  if (ssidLength == 0 || ssidLength > 32 || passwordLength > 64) {
    httpServer.send(400, "application/json", "{\"error\":\"invalid_credentials\"}");
    return;
  }

  /* Never print the SSID password. */
  Serial.println("[SETUP] Credentials received; testing connection");

  WiFi.mode(WIFI_AP_STA);
  WiFi.begin(ssid, password);
  uint32_t started = millis();
  bool connected = false;
  while (millis() - started < 20000UL) {
    if (WiFi.status() == WL_CONNECTED) {
      connected = true;
      break;
    }
    delay(250);
  }

  if (!connected) {
    WiFi.disconnect(true);
    delay(200);
    httpServer.send(
        400,
        "application/json",
        "{\"error\":\"wifi_connection_failed\",\"message\":\"Could not join that network. Check the name and password.\"}");
    /* Restore the protected setup AP so the customer can retry. */
    delay(500);
    enterSetupMode();
    return;
  }

  if (!saveWifiCredentials(ssid, password)) {
    httpServer.send(500, "application/json", "{\"error\":\"storage_failed\"}");
    return;
  }
  httpServer.send(
      200,
      "application/json",
      "{\"ok\":true,\"message\":\"Wi-Fi saved. Device will restart and connect to ThingsBoard.\"}");
  delay(800);
  ESP.restart();
}

void handleFactoryReset() {
  if (!pairingTokenValid()) {
    httpServer.send(401, "application/json", "{\"error\":\"invalid_pairing_token\"}");
    return;
  }
  writeRelayOff();
  clearWifiCredentials();
  LittleFS.remove(EVENT_QUEUE_FILE);
  g_pendingCount = 0;
  httpServer.send(200, "application/json", "{\"ok\":true,\"message\":\"Device reset.\"}");
  delay(800);
  ESP.restart();
}

/* -------------------------------------------------------------------------- */
/* Direct SoftAP REST API (Mobile App Control)                                */
/* -------------------------------------------------------------------------- */

void sendCorsHeader() {
  httpServer.sendHeader("Access-Control-Allow-Origin", "*");
  httpServer.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  httpServer.sendHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

void handleCorsPreflight() {
  sendCorsHeader();
  httpServer.send(204);
}

void handleDirectStatus() {
  sendCorsHeader();
  StaticJsonDocument<512> doc;
  doc["ok"] = true;
  doc["deviceId"] = DEVICE_ID;
  doc["valveState"] = g_relayEnergized ? "on" : "off";
  doc["relayEnergized"] = g_relayEnergized;
  doc["sessionActive"] = g_sessionActive;
  doc["sessionId"] = g_sessionId;
  doc["authorizedMl"] = g_authorizedMl;
  doc["consumedMl"] = g_consumedMl;
  doc["balanceMl"] = g_localBalanceMl;
  doc["totalDispensedMl"] = g_totalDispensedMl;
  doc["flowRateMlSec"] = g_relayEnergized ? 1000 : 0;
  doc["uptime"] = millis() / 1000;
  char buffer[512];
  serializeJson(doc, buffer, sizeof(buffer));
  httpServer.send(200, "application/json", buffer);
}

void handleDirectStart() {
  sendCorsHeader();
  if (g_sessionActive || g_relayEnergized) {
    httpServer.send(409, "application/json", "{\"ok\":false,\"error\":\"session_already_active\"}");
    return;
  }
  if (g_localBalanceMl < 100) {
    httpServer.send(400, "application/json", "{\"ok\":false,\"error\":\"insufficient_balance\"}");
    return;
  }

  uint32_t requestedAuth = g_localBalanceMl;
  if (httpServer.hasArg("plain")) {
    StaticJsonDocument<256> req;
    if (!deserializeJson(req, httpServer.arg("plain"))) {
      if (req.containsKey("authorizedMl")) {
        uint32_t val = req["authorizedMl"] | 0UL;
        if (val > 0 && val < requestedAuth) requestedAuth = val;
      }
    }
  }

  generateSessionId();
  snprintf(g_sessionId, sizeof(g_sessionId), "direct_%s_%lu", g_bootId, millis());
  g_authorizedMl = requestedAuth;
  g_consumedMl = 0;
  g_sequence = 0;
  g_sessionActive = true;
  g_sessionStartMs = millis();
  g_state = ST_VALVE_OPEN;
  g_cycleTargetMs = g_authorizedMl < VALVE_OPEN_DURATION_MS ? g_authorizedMl : VALVE_OPEN_DURATION_MS;

  writeRelayOn();

  StaticJsonDocument<256> doc;
  doc["ok"] = true;
  doc["valveState"] = "on";
  doc["sessionId"] = g_sessionId;
  doc["authorizedMl"] = g_authorizedMl;
  doc["balanceMl"] = g_localBalanceMl;
  char buffer[256];
  serializeJson(doc, buffer, sizeof(buffer));
  httpServer.send(200, "application/json", buffer);
}

void handleDirectStop() {
  sendCorsHeader();
  if (g_relayEnergized) {
    closeRelayAndRecord(true, "user_direct_stop");
  }
  g_sessionActive = false;
  g_state = ST_IDLE;
  writeRelayOff();

  StaticJsonDocument<256> doc;
  doc["ok"] = true;
  doc["valveState"] = "off";
  doc["sessionId"] = g_sessionId;
  doc["consumedMl"] = g_consumedMl;
  doc["balanceMl"] = g_localBalanceMl;
  doc["totalDispensedMl"] = g_totalDispensedMl;
  char buffer[256];
  serializeJson(doc, buffer, sizeof(buffer));
  httpServer.send(200, "application/json", buffer);
}

void handleDirectTopup() {
  sendCorsHeader();
  uint32_t amount = 50000;
  if (httpServer.hasArg("plain")) {
    StaticJsonDocument<256> req;
    if (!deserializeJson(req, httpServer.arg("plain"))) {
      if (req.containsKey("amountMl")) {
        amount = req["amountMl"] | 50000UL;
      }
    }
  }
  g_localBalanceMl += amount;
  saveLocalBalance();

  StaticJsonDocument<256> doc;
  doc["ok"] = true;
  doc["balanceMl"] = g_localBalanceMl;
  doc["addedMl"] = amount;
  char buffer[256];
  serializeJson(doc, buffer, sizeof(buffer));
  httpServer.send(200, "application/json", buffer);
}

void configureWebServer() {
  if (g_webServerConfigured) return;
  httpServer.on("/info", HTTP_GET, handleSetupInfo);
  httpServer.on("/provision", HTTP_POST, handleProvision);
  httpServer.on("/reset", HTTP_POST, handleFactoryReset);

  // Direct Mobile App REST Endpoints
  httpServer.on("/api/status", HTTP_GET, handleDirectStatus);
  httpServer.on("/api/valve/start", HTTP_POST, handleDirectStart);
  httpServer.on("/api/valve/stop", HTTP_POST, handleDirectStop);
  httpServer.on("/api/balance/topup", HTTP_POST, handleDirectTopup);

  httpServer.on("/api/status", HTTP_OPTIONS, handleCorsPreflight);
  httpServer.on("/api/valve/start", HTTP_OPTIONS, handleCorsPreflight);
  httpServer.on("/api/valve/stop", HTTP_OPTIONS, handleCorsPreflight);
  httpServer.on("/api/balance/topup", HTTP_OPTIONS, handleCorsPreflight);

  httpServer.onNotFound(handleSetupNotFound);
  g_webServerConfigured = true;
}

void enterSetupMode() {
  if (!validSetupPassword()) {
    g_state = ST_FAULT;
    Serial.println("[FAULT] SETUP_AP_PASSWORD must be at least 8 characters. Setup AP not started.");
    writeRelayOff();
    return;
  }
  writeRelayOff();
  g_sessionActive = false;
  g_setupMode = true;
  g_state = ST_SETUP_AP;
  mqtt.disconnect();
  WiFi.disconnect(true);
  delay(100);
  WiFi.mode(WIFI_AP);
  IPAddress apIp(192, 168, 4, 1);
  IPAddress netMask(255, 255, 255, 0);
  WiFi.softAPConfig(apIp, apIp, netMask);
  snprintf(
      g_apSsid,
      sizeof(g_apSsid),
      "%s%04X",
      SETUP_AP_PREFIX,
      (unsigned int)(ESP.getChipId() & 0xFFFF));
  if (!WiFi.softAP(g_apSsid, SETUP_AP_PASSWORD)) {
    g_state = ST_FAULT;
    Serial.println("[FAULT] Could not start setup access point");
    return;
  }
  dnsServer.start(53, "*", WiFi.softAPIP());
  configureWebServer();
  httpServer.begin();
  Serial.printf("[SETUP] Access point started: %s (password configured, not printed)\n", g_apSsid);
  Serial.printf("[SETUP] Open http://%s/info while joined to the device\n", WiFi.softAPIP().toString().c_str());
}

/* -------------------------------------------------------------------------- */
/* Button                                                                     */
/* -------------------------------------------------------------------------- */

void handlePairingButton() {
  if (PAIRING_BUTTON_PIN < 0) return;
#if PAIRING_BUTTON_PIN >= 0
  bool down = digitalRead(PAIRING_BUTTON_PIN) == LOW;
  if (down && !g_buttonWasDown) {
    g_buttonDownSinceMs = millis();
    g_buttonWasDown = true;
  } else if (!down && g_buttonWasDown) {
    g_buttonWasDown = false;
    g_buttonDownSinceMs = 0;
  } else if (down && g_buttonWasDown && g_buttonDownSinceMs != 0 &&
             (uint32_t)(millis() - g_buttonDownSinceMs) >= PAIRING_HOLD_MS) {
    g_buttonWasDown = false;
    g_buttonDownSinceMs = 0;
    Serial.println("[SETUP] Pairing button held; entering setup mode");
    if (g_relayEnergized) closeRelayAndRecord(true, "pairing_button");
    g_sessionActive = false;
    enterSetupMode();
  }
#endif
}

/* -------------------------------------------------------------------------- */
/* Network                                                                    */
/* -------------------------------------------------------------------------- */

void maintainNetwork() {
  if (g_setupMode) return;
  if (strlen(g_wifiSsid) == 0) {
    enterSetupMode();
    return;
  }

  if (WiFi.status() == WL_CONNECTED) {
    g_wifiDownSinceMs = 0;
    if (!mqtt.connected()) maintainMqtt();
    return;
  }

  if (g_wifiDownSinceMs == 0) {
    g_wifiDownSinceMs = millis();
    Serial.printf("[WIFI] Connecting to saved network \"%s\"\n", g_wifiSsid);
  }
  g_state = g_sessionActive ? g_state : ST_WIFI_CONNECTING;

  if (g_lastWifiAttemptMs == 0 ||
      (uint32_t)(millis() - g_lastWifiAttemptMs) >= WIFI_RETRY_INTERVAL_MS) {
    g_lastWifiAttemptMs = millis();
    WiFi.mode(WIFI_STA);
    WiFi.begin(g_wifiSsid, g_wifiPassword);
  }

  if (!g_sessionActive &&
      (uint32_t)(millis() - g_wifiDownSinceMs) >= WIFI_SETUP_FALLBACK_MS) {
    Serial.println("[WIFI] Could not join saved network; falling back to setup mode");
    enterSetupMode();
  }
}

/* -------------------------------------------------------------------------- */
/* Setup / loop                                                               */
/* -------------------------------------------------------------------------- */

void setup() {
  /* SAFE FIRST: drive the relay to its de-energized level before anything else.
   * A normally-closed solenoid stays closed when the relay is unpowered. */
  digitalWrite(RELAY_PIN, RELAY_OFF_LEVEL);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_OFF_LEVEL);

  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("==============================================");
  Serial.println("  VALVE — ESP8266 solenoid controller");
  Serial.printf("  Firmware %s\n", FIRMWARE_VERSION);
  Serial.println("==============================================");

  generateSessionId();

  if (!LittleFS.begin()) {
    Serial.println("[FS] LittleFS mount failed; event recovery disabled");
  } else {
    if (loadEventQueue()) {
      Serial.printf("[FS] Loaded %u pending events\n", (unsigned)g_pendingCount);
    }
    loadAbortRecord();
  }

  if (PAIRING_BUTTON_PIN >= 0) {
    pinMode(PAIRING_BUTTON_PIN, INPUT_PULLUP);
  }

  if (DIRECT_AP_MODE) {
    loadLocalBalance();
    WiFi.disconnect(true);
    delay(50);
    WiFi.mode(WIFI_AP_STA);
    IPAddress apIp(192, 168, 4, 1);
    IPAddress netMask(255, 255, 255, 0);
    WiFi.softAPConfig(apIp, apIp, netMask);
    WiFi.softAP(AP_SSID, AP_PASSWORD);

    configureWebServer();
    httpServer.begin();
    g_state = ST_IDLE;
    Serial.println();
    Serial.printf("[DIRECT-AP] Standalone Wi-Fi started: %s (Password: %s)\n", AP_SSID, AP_PASSWORD);
    Serial.printf("[DIRECT-AP] Direct IP: %s\n", WiFi.softAPIP().toString().c_str());
    Serial.printf("[DIRECT-AP] Stored balance: %lu mL (total dispensed: %lu mL)\n", (unsigned long)g_localBalanceMl, (unsigned long)g_totalDispensedMl);
    Serial.println("[DIRECT-AP] Valve Mobile App REST API ready at http://192.168.4.1/api/...");

    // Also initialize ThingsBoard MQTT client
    mqtt.setServer(TB_SERVER, TB_PORT);
    mqtt.setCallback(mqttCallback);
    mqtt.setBufferSize(1024);
    mqtt.setKeepAlive(20);

#if defined(WIFI_SSID) && defined(WIFI_PASSWORD)
    if (strlen(WIFI_SSID) > 0) {
      strncpy(g_wifiSsid, WIFI_SSID, sizeof(g_wifiSsid) - 1);
      strncpy(g_wifiPassword, WIFI_PASSWORD, sizeof(g_wifiPassword) - 1);
      saveWifiCredentials(g_wifiSsid, g_wifiPassword);
    }
#else
    loadWifiCredentials();
#endif

    if (strlen(g_wifiSsid) > 0) {
      WiFi.begin(g_wifiSsid, g_wifiPassword);
      g_lastWifiAttemptMs = millis();
      Serial.printf("[WIFI] Connecting to \"%s\" for ThingsBoard Cloud sync...\n", g_wifiSsid);
    } else {
      Serial.println("[WIFI] No home Wi-Fi set; running in Standalone Direct Mode.");
    }
    return;
  }

  mqtt.setServer(TB_SERVER, TB_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(1024);
  mqtt.setKeepAlive(20);

  if (!validSetupPassword()) {
    g_state = ST_FAULT;
    Serial.println("[FAULT] SETUP_AP_PASSWORD is shorter than 8 characters. Fix secrets.h.");
    return;
  }

  if (!loadWifiCredentials()) {
#if defined(WIFI_SSID) && defined(WIFI_PASSWORD)
    if (strlen(WIFI_SSID) > 0) {
      Serial.println("[WIFI] Using default Wi-Fi from secrets.h");
      strncpy(g_wifiSsid, WIFI_SSID, sizeof(g_wifiSsid) - 1);
      strncpy(g_wifiPassword, WIFI_PASSWORD, sizeof(g_wifiPassword) - 1);
      saveWifiCredentials(g_wifiSsid, g_wifiPassword);
    } else {
      Serial.println("[WIFI] No saved credentials; starting setup mode");
      enterSetupMode();
      return;
    }
#else
    Serial.println("[WIFI] No saved credentials; starting setup mode");
    enterSetupMode();
    return;
#endif
  }

  g_state = ST_WIFI_CONNECTING;
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(g_wifiSsid, g_wifiPassword);
  g_lastWifiAttemptMs = millis();
  Serial.println("[WIFI] Connecting with saved credentials");
}

void loop() {
  if (DIRECT_AP_MODE) {
    httpServer.handleClient();
    updateDispensing();
    handlePairingButton();

    if (g_sessionActive && (uint32_t)(millis() - g_sessionStartMs) >= DIRECT_SAFETY_TIMEOUT_MS) {
      Serial.println("[SAFETY] Direct session duration limit reached; closing valve");
      finishSession("safety_timeout");
    }

    // Maintain ThingsBoard MQTT connection when connected to home Wi-Fi
    if (strlen(g_wifiSsid) > 0) {
      if (WiFi.status() == WL_CONNECTED) {
        g_wifiDownSinceMs = 0;
        if (!mqtt.connected()) {
          maintainMqtt();
        } else {
          mqtt.loop();
          publishPendingEvents(false);
          if ((uint32_t)(millis() - g_lastHeartbeatMs) >= HEARTBEAT_INTERVAL_MS) {
            publishHeartbeat();
          }
        }
      } else {
        if (g_lastWifiAttemptMs == 0 || (uint32_t)(millis() - g_lastWifiAttemptMs) >= WIFI_RETRY_INTERVAL_MS) {
          g_lastWifiAttemptMs = millis();
          WiFi.begin(g_wifiSsid, g_wifiPassword);
        }
      }
    }

    delay(2);
    return;
  }

  if (g_state == ST_FAULT && !g_setupMode) {
    writeRelayOff();
  }

  if (g_setupMode) {
    dnsServer.processNextRequest();
    httpServer.handleClient();
    handlePairingButton();
    return;
  }

  /* Fail closed BEFORE attempting reconnection: if the cloud link is gone while
   * the valve is open, close the valve immediately. */
  if (g_sessionActive && (WiFi.status() != WL_CONNECTED || !mqtt.connected())) {
    abortForNetwork("network_lost");
    writeRelayOff();
  }

  maintainNetwork();
  if (mqtt.connected()) {
    mqtt.loop();
    publishPendingEvents(false);
  }

  handlePairingButton();
  updateDispensing();

  if (mqtt.connected() &&
      (uint32_t)(millis() - g_lastHeartbeatMs) >= HEARTBEAT_INTERVAL_MS) {
    publishHeartbeat();
  }

  delay(5);
}
