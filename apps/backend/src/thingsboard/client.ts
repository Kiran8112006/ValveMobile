import type { AppConfig } from '../config/env.js';
import type { RpcResult, ThingsBoardClient } from '../types/deps.js';
import { errors } from '../utils/errors.js';

/**
 * ThingsBoard Cloud REST client.
 *
 * Authentication uses an API key only: `X-Authorization: ApiKey <key>`.
 * The device access token is never used here — it belongs to the ESP8266's
 * MQTT connection and to the firmware's secrets.h.
 */
export class HttpThingsBoardClient implements ThingsBoardClient {
  constructor(private readonly config: AppConfig) {}

  async sendTwoWayRpc(
    deviceUuid: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<RpcResult> {
    const { baseUrl, apiKey, rpcTimeoutMs } = this.config.thingsboard;
    if (!apiKey) {
      throw errors.unavailable(
        'thingsboard_not_configured',
        'THINGSBOARD_API_KEY is not configured on the server.',
      );
    }
    const url = `${baseUrl}/api/rpc/twoway/${encodeURIComponent(deviceUuid)}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Authorization': `ApiKey ${apiKey}`,
        },
        body: JSON.stringify({ method, params, timeout: rpcTimeoutMs }),
        signal: AbortSignal.timeout(rpcTimeoutMs + 2000),
      });
    } catch (err) {
      throw errors.upstream(
        'thingsboard_unreachable',
        `ThingsBoard RPC request failed: ${(err as Error).message}`,
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw errors.upstream(
        'thingsboard_auth_failed',
        'ThingsBoard rejected the server API key.',
      );
    }
    const text = await response.text();
    if (!response.ok) {
      throw errors.upstream(
        'thingsboard_rpc_failed',
        `ThingsBoard RPC failed with status ${response.status}.`,
        { body: text.slice(0, 500) },
      );
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === 'object') {
        return parsed as RpcResult;
      }
      return { success: false, raw: text };
    } catch {
      return { success: false, raw: text };
    }
  }
}

/** Test double that records commands; it never reports a hardware ack by itself. */
export class RecordingThingsBoardClient implements ThingsBoardClient {
  readonly calls: Array<{ deviceUuid: string; method: string; params: Record<string, unknown> }> =
    [];

  constructor(private readonly responder: (method: string, params: Record<string, unknown>) => RpcResult) {}

  async sendTwoWayRpc(
    deviceUuid: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<RpcResult> {
    this.calls.push({ deviceUuid, method, params });
    return this.responder(method, params);
  }
}
