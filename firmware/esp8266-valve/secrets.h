/*
 * LOCAL DEVICE SECRETS — created by setup. Replace every placeholder.
 * This file is Git-ignored. Never commit it or paste it into chat.
 */
#ifndef VALVE_SECRETS_H
#define VALVE_SECRETS_H

#define TB_SERVER "thingsboard.cloud"
#define TB_PORT 1883
#define TB_DEVICE_TOKEN "0xnxY4m3XiSYLsFtOzW5"
#define DEVICE_ID "valve-esp8266-001"
#define SETUP_AP_PASSWORD "ValveSetupChangeMe1"
#define SETUP_PAIRING_TOKEN "REPLACE_WITH_DEVICE_PAIRING_TOKEN"

/* -------------------------------------------------------------------------- */
/* Standalone Direct Mode Wi-Fi Access Point                                  */
/* The ESP8266 broadcasts this network. Connect your phone directly to it.   */
/* -------------------------------------------------------------------------- */
#define AP_SSID "Valve-Water-Dispenser"
#define AP_PASSWORD "password123"

/* -------------------------------------------------------------------------- */
/* Optional: Home Wi-Fi for ThingsBoard Cloud connection                      */
/* If you also want ThingsBoard cloud access, uncomment and fill these in.    */
/* -------------------------------------------------------------------------- */
#define WIFI_SSID "TP-Link_DAC6"
#define WIFI_PASSWORD "Abhikiran@321"

#endif
