// src/server.ts
import "dotenv/config";
import { getFirestore } from "firebase-admin/firestore";

// src/app.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";

// src/utils/errors.ts
var ApiError = class extends Error {
  statusCode;
  code;
  details;
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
};
var errors = {
  unauthorized: (message = "Authentication required.") => new ApiError(401, "unauthorized", message),
  forbidden: (message = "You are not allowed to perform this action.") => new ApiError(403, "forbidden", message),
  notFound: (message = "Resource not found.") => new ApiError(404, "not_found", message),
  conflict: (code, message, details) => new ApiError(409, code, message, details),
  badRequest: (code, message, details) => new ApiError(400, code, message, details),
  tooMany: (message = "Too many requests.") => new ApiError(429, "rate_limited", message),
  upstream: (code, message, details) => new ApiError(502, code, message, details),
  unavailable: (code, message) => new ApiError(503, code, message)
};

// src/store/types.ts
var paths = {
  user: (uid) => `users/${uid}`,
  device: (deviceId) => `devices/${deviceId}`,
  session: (sessionId) => `dispensingSessions/${sessionId}`,
  event: (eventId) => `dispensingEvents/${eventId}`,
  transaction: (transactionId) => `transactions/${transactionId}`,
  rechargeOrder: (orderId) => `rechargeOrders/${orderId}`,
  rechargeOrderByProvider: (razorpayOrderId) => `rechargeOrders/${razorpayOrderId}`,
  payment: (paymentId) => `payments/${paymentId}`,
  auditLog: (logId) => `auditLogs/${logId}`,
  pricing: () => "appConfig/pricing"
};

// src/auth/plugin.ts
async function registerAuth(app, deps) {
  app.decorateRequest("authUser", null);
  app.decorateRequest("rawBody", null);
  app.decorate("deps", deps);
  app.decorate("authenticate", async (request, reply) => {
    const header = request.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw errors.unauthorized("Missing bearer token.");
    }
    const token = header.slice("Bearer ".length).trim();
    if (!token) throw errors.unauthorized("Missing bearer token.");
    let payload;
    try {
      payload = await deps.verifier.verify(token);
    } catch {
      throw errors.unauthorized("Invalid or expired authentication token.");
    }
    const profile = await deps.store.get(paths.user(payload.uid));
    if (!profile) {
      throw errors.unauthorized("No Valve profile exists for this account.");
    }
    if (profile.status !== "active") {
      throw errors.forbidden("This account is disabled. Contact an administrator.");
    }
    const role = payload.admin && profile.role === "admin" ? "admin" : "customer";
    request.authUser = {
      uid: payload.uid,
      email: payload.email ?? profile.email,
      role,
      emailVerified: payload.emailVerified,
      profile
    };
    reply.header("Cache-Control", "no-store");
  });
  app.decorate("requireAdmin", async (request) => {
    if (!request.authUser) throw errors.unauthorized();
    if (request.authUser.role !== "admin") {
      throw errors.forbidden("Administrator access required.");
    }
  });
}
function authUser(request) {
  if (!request.authUser) throw errors.unauthorized();
  return request.authUser;
}

// src/users/routes.ts
import { z } from "zod";

// src/utils/validate.ts
function parseBody(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
    throw errors.badRequest("validation_error", message);
  }
  return result.data;
}

// src/types/realtime.ts
function publicSession(session) {
  return {
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    status: session.status,
    authorizedMl: session.authorizedMl,
    consumedMl: session.consumedMl,
    remainingAuthorizedMl: session.remainingAuthorizedMl,
    lastProcessedSequence: session.lastProcessedSequence,
    finalSequence: session.finalSequence,
    startedAt: session.startedAt ? session.startedAt.toISOString() : null,
    stoppedAt: session.stoppedAt ? session.stoppedAt.toISOString() : null,
    stopReason: session.stopReason
  };
}
function publicDevice(device) {
  return {
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    status: device.status,
    valveState: device.valveState,
    relayState: device.relayState,
    lastHeartbeat: device.lastHeartbeat ? device.lastHeartbeat.toISOString() : null,
    firmwareVersion: device.firmwareVersion,
    wifiRssi: device.wifiRssi,
    assignedUserId: device.assignedUserId,
    activeSessionId: device.activeSessionId
  };
}

// src/users/serialize.ts
function serializeUser(user) {
  return {
    uid: user.uid,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    status: user.status,
    balanceMl: user.balanceMl,
    balanceLitres: (user.balanceMl / 1e3).toFixed(2),
    totalEstimatedDispensedMl: user.totalEstimatedDispensedMl,
    totalEstimatedDispensedLitres: (user.totalEstimatedDispensedMl / 1e3).toFixed(2),
    deviceId: user.deviceId,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString()
  };
}

// src/utils/ids.ts
import { randomUUID } from "crypto";
function newId(prefix) {
  const id = randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

// src/utils/security.ts
import { createHash, createHmac, timingSafeEqual } from "crypto";
function safeEqual(a, b) {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    const filler = Buffer.alloc(left.length);
    timingSafeEqual(left, filler);
    return false;
  }
  return timingSafeEqual(left, right);
}
function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function hmacSha256Hex(secret, payload) {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

// src/devices/service.ts
function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = hmacSha256Hex(secret, body);
  return `${body}.${signature}`;
}
function verifyToken(token, secret) {
  const [body, signature] = token.split(".");
  if (!body || !signature) throw errors.badRequest("invalid_pairing_token", "Malformed pairing token.");
  if (!safeEqual(hmacSha256Hex(secret, body), signature)) {
    throw errors.badRequest("invalid_pairing_token", "Pairing token signature is invalid.");
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw errors.badRequest("invalid_pairing_token", "Pairing token payload is invalid.");
  }
  if (payload.exp < Date.now()) {
    throw errors.badRequest("pairing_token_expired", "Pairing token has expired.");
  }
  return payload;
}
async function createPairingChallenge(deps, uid, deviceId, claimCode) {
  const device = await deps.store.get(paths.device(deviceId));
  if (!device) throw errors.notFound("Device not found.");
  if (device.assignedUserId && device.assignedUserId !== uid) {
    throw errors.conflict("device_assigned", "This device is already paired to another account.");
  }
  if (!device.claimCodeHash) {
    throw errors.conflict(
      "claim_not_available",
      "This device was not issued a claim code. Ask an administrator to assign it."
    );
  }
  if (device.claimUsedAt && device.assignedUserId !== uid) {
    throw errors.conflict("claim_used", "This device claim code has already been used.");
  }
  if (!safeEqual(sha256Hex(claimCode.trim()), device.claimCodeHash)) {
    throw errors.badRequest("invalid_claim_code", "Claim code is incorrect.");
  }
  const expiresAt = new Date(Date.now() + deps.config.pairing.challengeTtlMs);
  const token = sign(
    { deviceId: device.deviceId, uid, exp: expiresAt.getTime() },
    deps.config.pairing.tokenSecret
  );
  return {
    pairingToken: token,
    expiresAt: expiresAt.toISOString(),
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    setupApPrefix: `Valve-ESP8266-${device.deviceId.slice(-4).toUpperCase()}`,
    instructions: [
      "Switch the device into setup mode (hold the pairing button for 3 seconds or power-cycle an unprovisioned device).",
      "On your phone, join the Valve-ESP8266-XXXX network printed on the device label.",
      "Enter your home Wi-Fi or hotspot name and password. They are sent only to the ESP8266.",
      "The device reboots, joins your network and appears online here after its first heartbeat."
    ]
  };
}
async function claimDevice(deps, uid, pairingToken) {
  const payload = verifyToken(pairingToken, deps.config.pairing.tokenSecret);
  if (payload.uid !== uid) {
    throw errors.forbidden("Pairing token belongs to a different account.");
  }
  const at = deps.now();
  return deps.store.runTransaction(async (tx) => {
    const device = await tx.get(paths.device(payload.deviceId));
    if (!device) throw errors.notFound("Device not found.");
    if (device.assignedUserId && device.assignedUserId !== uid) {
      throw errors.conflict("device_assigned", "Device is paired to another account.");
    }
    const user = await tx.get(paths.user(uid));
    if (!user) throw errors.notFound("Customer profile not found.");
    if (user.status !== "active") throw errors.forbidden("Account is not active.");
    const previousDeviceId = user.deviceId;
    if (previousDeviceId && previousDeviceId !== device.deviceId) {
      const previous = await tx.get(paths.device(previousDeviceId));
      if (previous && previous.assignedUserId === uid) {
        tx.set(paths.device(previous.deviceId), {
          ...previous,
          assignedUserId: null,
          activeSessionId: null,
          updatedAt: at
        });
      }
    }
    tx.set(paths.user(uid), {
      ...user,
      deviceId: device.deviceId,
      updatedAt: at
    });
    tx.set(paths.device(device.deviceId), {
      ...device,
      assignedUserId: uid,
      claimUsedAt: device.claimUsedAt ?? at,
      updatedAt: at
    });
    return {
      device: { ...device, assignedUserId: uid },
      previousDeviceId
    };
  });
}
async function getDeviceForUser(deps, user) {
  if (!user.deviceId) return null;
  const device = await deps.store.get(paths.device(user.deviceId));
  if (!device) return null;
  if (!isHeartbeatFresh(deps, device)) {
    return { ...device, status: "offline" };
  }
  return device;
}
function isHeartbeatFresh(deps, device) {
  if (!device.lastHeartbeat) return false;
  return deps.now().getTime() - device.lastHeartbeat.getTime() <= deps.config.thingsboard.offlineThresholdMs;
}
async function refreshDeviceStatuses(deps) {
  const devices = await deps.store.query("devices", {
    filters: [{ field: "status", op: "==", value: "online" }],
    limit: 200
  });
  for (const device of devices) {
    if (isHeartbeatFresh(deps, device)) continue;
    const now = deps.now();
    await deps.store.merge(paths.device(device.deviceId), {
      status: "offline",
      valveState: "unknown",
      updatedAt: now
    });
    const updated = {
      ...device,
      status: "offline",
      valveState: "unknown"
    };
    deps.hub.publishToAdmins({ type: "device", device: publicDevice(updated) });
    if (device.assignedUserId) {
      deps.hub.publishToUser(device.assignedUserId, {
        type: "device",
        device: publicDevice(updated)
      });
    }
  }
}
function newDeviceId() {
  return newId("valve");
}
function hashClaimCode(code) {
  return sha256Hex(code.trim());
}
function generateClaimCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

// src/recharge/pricing.ts
async function getPricing(deps) {
  return deps.store.get(paths.pricing());
}
function amountFor(quantityMl, pricePerLitrePaise) {
  return Math.round(quantityMl * pricePerLitrePaise / 1e3);
}
async function requirePricing(deps) {
  const pricing = await getPricing(deps);
  if (!pricing) {
    throw errors.unavailable(
      "pricing_not_configured",
      "Recharge pricing has not been configured by an administrator yet."
    );
  }
  return pricing;
}

// src/types/domain.ts
var SESSION_UNRESOLVED = [
  "pending",
  "active",
  "stopping",
  "reconciling"
];

// src/valve/service.ts
function isDeviceOnline(deps, device) {
  if (device.status !== "online") return false;
  if (!device.lastHeartbeat) return false;
  const age = deps.now().getTime() - device.lastHeartbeat.getTime();
  return age <= deps.config.thingsboard.offlineThresholdMs;
}
var ValveService = class {
  constructor(deps) {
    this.deps = deps;
  }
  deps;
  async start(user) {
    const { store, config, now } = this.deps;
    if (!user.deviceId) {
      throw errors.conflict("no_device", "Connect and pair your Valve device first.");
    }
    if (user.balanceMl < config.valve.minAuthorizedMl) {
      throw errors.conflict(
        "balance_too_low",
        `A minimum balance of ${config.valve.minAuthorizedMl} mL is required to start.`
      );
    }
    const device = await store.get(paths.device(user.deviceId));
    if (!device) throw errors.notFound("Assigned device was not found.");
    if (device.assignedUserId !== user.uid) {
      throw errors.forbidden("The assigned device belongs to another customer.");
    }
    if (!isDeviceOnline(this.deps, device)) {
      throw errors.conflict("device_offline", "Device is offline. Cannot start dispensing.");
    }
    if (device.activeSessionId) {
      throw errors.conflict(
        "session_active",
        "A dispensing session is already active on this device."
      );
    }
    const unresolved = await store.query("dispensingSessions", {
      filters: [
        { field: "userId", op: "==", value: user.uid },
        { field: "status", op: "in", value: SESSION_UNRESOLVED }
      ],
      limit: 5
    });
    if (unresolved.length > 0) {
      throw errors.conflict(
        "session_unresolved",
        "A previous session is still being reconciled. Try again shortly.",
        { sessionId: unresolved[0]?.sessionId }
      );
    }
    const sessionId = newId("ses");
    const commandId = newId("cmd");
    const at = now();
    const session = await store.runTransaction(async (tx) => {
      const freshUser = await tx.get(paths.user(user.uid));
      if (!freshUser) throw errors.notFound("Customer profile not found.");
      if (freshUser.status !== "active") throw errors.forbidden("Account is not active.");
      const freshDevice = await tx.get(paths.device(user.deviceId));
      if (!freshDevice) throw errors.notFound("Assigned device was not found.");
      if (freshDevice.assignedUserId !== freshUser.uid) {
        throw errors.forbidden("The assigned device belongs to another customer.");
      }
      if (freshDevice.activeSessionId) {
        throw errors.conflict("session_active", "A session already holds this device.");
      }
      const authorizedMl = Math.min(
        freshUser.balanceMl,
        config.valve.maxAuthorizedMlPerSession
      );
      if (authorizedMl < config.valve.minAuthorizedMl) {
        throw errors.conflict("balance_too_low", "Insufficient balance to start dispensing.");
      }
      const doc = {
        sessionId,
        deviceId: freshDevice.deviceId,
        userId: freshUser.uid,
        status: "pending",
        authorizedMl,
        consumedMl: 0,
        remainingAuthorizedMl: authorizedMl,
        lastProcessedSequence: 0,
        finalSequence: null,
        reconciled: false,
        startedAt: null,
        stoppedAt: null,
        stopReason: null,
        createdAt: at,
        updatedAt: at
      };
      tx.set(paths.session(sessionId), { ...doc });
      tx.set(paths.device(freshDevice.deviceId), {
        ...freshDevice,
        activeSessionId: sessionId,
        updatedAt: at
      });
      return doc;
    });
    let ack;
    try {
      ack = await this.deps.thingsboard.sendTwoWayRpc(
        device.thingsBoardDeviceUuid,
        "setValve",
        {
          state: "on",
          sessionId,
          authorizedMl: session.authorizedMl,
          openDurationMs: config.valve.openDurationMs,
          closedGapMs: config.valve.closedGapMs,
          commandId
        }
      );
    } catch (err) {
      await this.failPendingSession(session, "device_rpc_failed");
      throw err;
    }
    const acknowledged = ack.success === true && ack.sessionId === sessionId && (ack.valveState === "on" || ack.valveState === "opening");
    if (!acknowledged) {
      await this.failPendingSession(session, "device_no_ack");
      throw errors.upstream(
        "device_no_ack",
        "The device did not acknowledge the ON command. The valve was not reported open."
      );
    }
    const active = await this.markActive(session.sessionId);
    const latestDevice = await this.deps.store.get(paths.device(session.deviceId));
    if (latestDevice) {
      this.deps.hub.publishToUser(user.uid, {
        type: "device",
        device: publicDevice(latestDevice)
      });
      this.deps.hub.publishToAdmins({ type: "device", device: publicDevice(latestDevice) });
    }
    this.broadcastSession(active);
    return { session: active, acknowledged: true };
  }
  async stop(user) {
    const { store, now } = this.deps;
    if (!user.deviceId) throw errors.conflict("no_device", "No device is paired.");
    const device = await store.get(paths.device(user.deviceId));
    if (!device) throw errors.notFound("Assigned device was not found.");
    const sessionId = device.activeSessionId;
    if (!sessionId) {
      throw errors.conflict("no_active_session", "There is no active dispensing session.");
    }
    const session = await store.get(paths.session(sessionId));
    if (!session) throw errors.notFound("Active session was not found.");
    const stopping = await store.runTransaction(async (tx) => {
      const fresh = await tx.get(paths.session(sessionId));
      if (!fresh) throw errors.notFound("Active session was not found.");
      if (fresh.status === "completed" || fresh.status === "failed") return fresh;
      const next = {
        ...fresh,
        status: "stopping",
        stoppedAt: fresh.stoppedAt ?? now(),
        stopReason: fresh.stopReason ?? "user_off",
        updatedAt: now()
      };
      tx.set(paths.session(sessionId), { ...next });
      return next;
    });
    this.broadcastSession(stopping);
    const commandId = newId("cmd");
    let ack;
    try {
      ack = await this.deps.thingsboard.sendTwoWayRpc(
        device.thingsBoardDeviceUuid,
        "setValve",
        { state: "off", sessionId, commandId, reason: "user_off" }
      );
    } catch {
      return {
        confirmed: false,
        session: stopping,
        message: "OFF was requested but the device did not acknowledge. The valve fails closed when cloud connectivity is lost; state is unconfirmed."
      };
    }
    if (ack.success !== true || ack.valveState !== "off") {
      return {
        confirmed: false,
        session: stopping,
        message: "The device did not confirm the OFF command. State is unconfirmed."
      };
    }
    const finalSequence = typeof ack.finalSequence === "number" && Number.isInteger(ack.finalSequence) ? ack.finalSequence : null;
    const updated = await store.runTransaction(async (tx) => {
      const fresh = await tx.get(paths.session(sessionId));
      if (!fresh) throw errors.notFound("Active session was not found.");
      if (fresh.status === "completed") return fresh;
      const completed = finalSequence != null && fresh.lastProcessedSequence >= finalSequence;
      const next = {
        ...fresh,
        finalSequence: finalSequence ?? fresh.finalSequence,
        status: completed ? "completed" : "reconciling",
        reconciled: completed,
        stoppedAt: fresh.stoppedAt ?? now(),
        updatedAt: now()
      };
      tx.set(paths.session(sessionId), { ...next });
      if (completed) {
        const dev = await tx.get(paths.device(fresh.deviceId));
        if (dev && dev.activeSessionId === fresh.sessionId) {
          tx.set(paths.device(dev.deviceId), {
            ...dev,
            activeSessionId: null,
            valveState: "off",
            updatedAt: now()
          });
        }
      }
      return next;
    });
    this.broadcastSession(updated);
    return {
      confirmed: true,
      session: updated,
      message: updated.status === "completed" ? "Valve closed and session reconciled." : "Valve closed. Final dispensing events are being reconciled."
    };
  }
  async reconcile() {
    const { store, now } = this.deps;
    const pending = await store.query("dispensingSessions", {
      filters: [{ field: "status", op: "in", value: ["active", "stopping", "reconciling"] }],
      limit: 100
    });
    let completedCount = 0;
    for (const session of pending) {
      const finished = session.finalSequence != null && session.lastProcessedSequence >= session.finalSequence || session.remainingAuthorizedMl <= 0;
      if (!finished) continue;
      const updated = await store.runTransaction(async (tx) => {
        const fresh = await tx.get(paths.session(session.sessionId));
        if (!fresh || fresh.status === "completed" || fresh.status === "failed") return fresh;
        const next = {
          ...fresh,
          status: "completed",
          reconciled: true,
          finalSequence: fresh.finalSequence ?? Math.max(fresh.lastProcessedSequence, 1),
          stoppedAt: fresh.stoppedAt ?? now(),
          stopReason: fresh.stopReason ?? "allowance_exhausted",
          updatedAt: now()
        };
        tx.set(paths.session(fresh.sessionId), { ...next });
        const dev = await tx.get(paths.device(fresh.deviceId));
        if (dev && dev.activeSessionId === fresh.sessionId) {
          tx.set(paths.device(dev.deviceId), {
            ...dev,
            activeSessionId: null,
            valveState: "off",
            updatedAt: now()
          });
        }
        return next;
      });
      if (updated && updated.status === "completed") {
        completedCount += 1;
        this.broadcastSession(updated);
      }
    }
    return completedCount;
  }
  async emergencyOff(deviceId, actorUid) {
    const { store, now } = this.deps;
    const device = await store.get(paths.device(deviceId));
    if (!device) throw errors.notFound("Device not found.");
    const sessionId = device.activeSessionId;
    let ack;
    try {
      ack = await this.deps.thingsboard.sendTwoWayRpc(
        device.thingsBoardDeviceUuid,
        "setValve",
        {
          state: "off",
          sessionId: sessionId ?? "",
          commandId: newId("cmd"),
          reason: `admin_emergency_off:${actorUid}`
        }
      );
    } catch (err) {
      return {
        confirmed: false,
        device,
        sessionId,
        message: `Remote OFF could not be delivered: ${err.message}. Last known state is shown.`
      };
    }
    const confirmed = ack.success === true && ack.valveState === "off";
    if (sessionId) {
      const session = await store.get(paths.session(sessionId));
      if (session && session.status !== "completed" && session.status !== "failed") {
        await store.merge(paths.session(sessionId), {
          status: confirmed ? "reconciling" : "stopping",
          stopReason: "emergency_admin_off",
          stoppedAt: session.stoppedAt ?? now(),
          finalSequence: typeof ack.finalSequence === "number" ? ack.finalSequence : session.finalSequence,
          updatedAt: now()
        });
      }
    }
    const fresh = await store.get(paths.device(deviceId));
    const resultDevice = fresh ?? device;
    this.deps.hub.publishToAdmins({ type: "device", device: publicDevice(resultDevice) });
    if (resultDevice.assignedUserId) {
      this.deps.hub.publishToUser(resultDevice.assignedUserId, {
        type: "device",
        device: publicDevice(resultDevice)
      });
    }
    return {
      confirmed,
      device: resultDevice,
      sessionId,
      message: confirmed ? "Emergency OFF confirmed by the device." : "Emergency OFF was sent but not confirmed by the device."
    };
  }
  async currentSession(user) {
    const { store } = this.deps;
    if (user.deviceId) {
      const device = await store.get(paths.device(user.deviceId));
      if (device?.activeSessionId) {
        const session = await store.get(
          paths.session(device.activeSessionId)
        );
        if (session) return session;
      }
    }
    const unresolved = await store.query("dispensingSessions", {
      filters: [
        { field: "userId", op: "==", value: user.uid },
        { field: "status", op: "in", value: SESSION_UNRESOLVED }
      ],
      orderBy: { field: "createdAt", direction: "desc" },
      limit: 1
    });
    return unresolved[0] ?? null;
  }
  broadcastSession(session) {
    const message = { type: "session", session: publicSession(session) };
    this.deps.hub.publishToUser(session.userId, message);
    this.deps.hub.publishToAdmins(message);
  }
  async markActive(sessionId) {
    const { store, now } = this.deps;
    return store.runTransaction(async (tx) => {
      const fresh = await tx.get(paths.session(sessionId));
      if (!fresh) throw errors.notFound("Session not found.");
      const next = {
        ...fresh,
        status: "active",
        startedAt: fresh.startedAt ?? now(),
        updatedAt: now()
      };
      tx.set(paths.session(sessionId), { ...next });
      const dev = await tx.get(paths.device(fresh.deviceId));
      if (dev) {
        tx.set(paths.device(dev.deviceId), {
          ...dev,
          valveState: "opening",
          updatedAt: now()
        });
      }
      return next;
    });
  }
  async failPendingSession(session, reason) {
    const { store, now } = this.deps;
    await store.runTransaction(async (tx) => {
      const fresh = await tx.get(paths.session(session.sessionId));
      if (fresh && fresh.status === "pending") {
        tx.set(paths.session(session.sessionId), {
          ...fresh,
          status: "failed",
          stopReason: reason,
          stoppedAt: now(),
          reconciled: true,
          updatedAt: now()
        });
      }
      const dev2 = await tx.get(paths.device(session.deviceId));
      if (dev2 && dev2.activeSessionId === session.sessionId) {
        tx.set(paths.device(dev2.deviceId), {
          ...dev2,
          activeSessionId: null,
          valveState: "unknown",
          updatedAt: now()
        });
      }
    });
    const dev = await store.get(paths.device(session.deviceId));
    if (dev) {
      this.deps.hub.publishToUser(session.userId, {
        type: "device",
        device: publicDevice(dev)
      });
      this.deps.hub.publishToAdmins({ type: "device", device: publicDevice(dev) });
    }
    this.broadcastSession({
      ...session,
      status: "failed",
      stopReason: reason,
      stoppedAt: now()
    });
  }
};

// src/users/routes.ts
var registerSchema = z.object({
  fullName: z.string().trim().min(2, "Full name must be at least 2 characters.").max(80)
});
async function userRoutes(app) {
  app.post("/api/auth/register-profile", async (request) => {
    const deps = app.deps;
    const header = request.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw errors.unauthorized("Missing bearer token.");
    }
    let payload;
    try {
      payload = await deps.verifier.verify(header.slice(7).trim());
    } catch {
      throw errors.unauthorized("Invalid or expired authentication token.");
    }
    const email = payload.email;
    if (!email) {
      throw errors.badRequest(
        "email_required",
        "This account has no email address. Register with email and password."
      );
    }
    const body = parseBody(registerSchema, request.body ?? {});
    const existing = await deps.store.get(paths.user(payload.uid));
    if (existing) {
      return { created: false, profile: serializeUser(existing) };
    }
    const now = deps.now();
    const profile = {
      uid: payload.uid,
      fullName: body.fullName,
      email,
      role: "customer",
      status: "active",
      balanceMl: 0,
      totalEstimatedDispensedMl: 0,
      deviceId: null,
      createdAt: now,
      updatedAt: now
    };
    await deps.store.set(paths.user(profile.uid), { ...profile });
    return { created: true, profile: serializeUser(profile) };
  });
  app.get("/api/auth/me", { preHandler: [app.authenticate] }, async (request) => {
    const deps = app.deps;
    const user = authUser(request);
    const device = await getDeviceForUser(deps, user.profile);
    const session = await new ValveService(deps).currentSession(user.profile);
    const pricing = await getPricing(deps);
    return {
      profile: serializeUser(user.profile),
      role: user.role,
      emailVerified: user.emailVerified,
      device,
      session: session ? publicSession(session) : null,
      pricing: pricing ? {
        pricePerLitrePaise: pricing.pricePerLitrePaise,
        pricePerLitreInr: pricing.pricePerLitrePaise / 100,
        currency: pricing.currency,
        minimumRechargeLitres: pricing.minimumRechargeLitres,
        maximumRechargeLitres: pricing.maximumRechargeLitres,
        availableRechargePackages: pricing.availableRechargePackages,
        configured: true
      } : { configured: false }
    };
  });
  app.get("/api/customer/overview", { preHandler: [app.authenticate] }, async (request) => {
    const deps = app.deps;
    const user = authUser(request);
    const device = await getDeviceForUser(deps, user.profile);
    const session = await new ValveService(deps).currentSession(user.profile);
    const pricing = await getPricing(deps);
    const transactions = await deps.store.query("transactions", {
      filters: [{ field: "userId", op: "==", value: user.uid }],
      orderBy: { field: "createdAt", direction: "desc" },
      limit: 10
    });
    return {
      profile: serializeUser(user.profile),
      device,
      session: session ? publicSession(session) : null,
      pricing: pricing ? {
        pricePerLitrePaise: pricing.pricePerLitrePaise,
        pricePerLitreInr: pricing.pricePerLitrePaise / 100,
        currency: pricing.currency,
        minimumRechargeLitres: pricing.minimumRechargeLitres,
        maximumRechargeLitres: pricing.maximumRechargeLitres,
        availableRechargePackages: pricing.availableRechargePackages,
        configured: true
      } : { configured: false },
      recentTransactions: transactions,
      serverTime: deps.now().toISOString()
    };
  });
  app.get("/api/customer/transactions", { preHandler: [app.authenticate] }, async (request) => {
    const deps = app.deps;
    const user = authUser(request);
    const query = request.query;
    const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 100);
    const filters = [{ field: "userId", op: "==", value: user.uid }];
    if (query.type) filters.push({ field: "type", op: "==", value: query.type });
    const transactions = await deps.store.query("transactions", {
      filters,
      orderBy: { field: "createdAt", direction: "desc" },
      limit
    });
    return { transactions };
  });
  app.get("/api/customer/payments", { preHandler: [app.authenticate] }, async (request) => {
    const deps = app.deps;
    const user = authUser(request);
    const orders = await deps.store.query("rechargeOrders", {
      filters: [{ field: "userId", op: "==", value: user.uid }],
      orderBy: { field: "createdAt", direction: "desc" },
      limit: 50
    });
    const payments = await deps.store.query("payments", {
      filters: [{ field: "userId", op: "==", value: user.uid }],
      orderBy: { field: "createdAt", direction: "desc" },
      limit: 50
    });
    return { orders, payments };
  });
  app.get("/api/customer/history", { preHandler: [app.authenticate] }, async (request) => {
    const deps = app.deps;
    const user = authUser(request);
    const [transactions, orders] = await Promise.all([
      deps.store.query("transactions", {
        filters: [{ field: "userId", op: "==", value: user.uid }],
        orderBy: { field: "createdAt", direction: "desc" },
        limit: 100
      }),
      deps.store.query("rechargeOrders", {
        filters: [{ field: "userId", op: "==", value: user.uid }],
        orderBy: { field: "createdAt", direction: "desc" },
        limit: 50
      })
    ]);
    return { transactions, orders };
  });
}

// src/valve/routes.ts
import { z as z2 } from "zod";
async function valveRoutes(app) {
  const service = new ValveService(app.deps);
  app.post(
    "/api/valve/start",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 12, timeWindow: "1 minute" } }
    },
    async (request) => {
      const user = authUser(request);
      const result = await service.start(user.profile);
      const device = await getDeviceForUser(app.deps, user.profile);
      return {
        acknowledged: true,
        session: publicSession(result.session),
        device
      };
    }
  );
  app.post(
    "/api/valve/stop",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } }
    },
    async (request) => {
      const user = authUser(request);
      const result = await service.stop(user.profile);
      return {
        confirmed: result.confirmed,
        message: result.message,
        session: publicSession(result.session)
      };
    }
  );
  app.get("/api/valve/session", { preHandler: [app.authenticate] }, async (request) => {
    const user = authUser(request);
    const session = await service.currentSession(user.profile);
    return { session: session ? publicSession(session) : null };
  });
  app.get("/api/valve/status", { preHandler: [app.authenticate] }, async (request) => {
    const user = authUser(request);
    const device = await getDeviceForUser(app.deps, user.profile);
    const session = await service.currentSession(user.profile);
    return {
      profile: serializeUser(user.profile),
      device,
      session: session ? publicSession(session) : null,
      serverTime: app.deps.now().toISOString()
    };
  });
  app.get("/api/valve/config", { preHandler: [app.authenticate] }, async () => {
    return {
      openDurationMs: app.deps.config.valve.openDurationMs,
      closedGapMs: app.deps.config.valve.closedGapMs,
      mlPerSecond: 1e3
    };
  });
  app.post(
    "/api/valve/emergency-off",
    {
      preHandler: [app.authenticate, app.requireAdmin],
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } }
    },
    async (request) => {
      const admin = authUser(request);
      const body = parseBody(z2.object({ deviceId: z2.string().min(1) }), request.body ?? {});
      return service.emergencyOff(body.deviceId, admin.uid);
    }
  );
}

// src/devices/routes.ts
import { z as z3 } from "zod";
var challengeSchema = z3.object({
  deviceId: z3.string().trim().min(3).max(80),
  claimCode: z3.string().trim().min(6).max(64)
});
var assignSchema = z3.object({
  pairingToken: z3.string().min(10).max(2048)
});
async function deviceRoutes(app) {
  app.post(
    "/api/devices/pairing/challenge",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } }
    },
    async (request) => {
      const user = authUser(request);
      const body = parseBody(challengeSchema, request.body ?? {});
      const challenge = await createPairingChallenge(app.deps, user.uid, body.deviceId, body.claimCode);
      return {
        ...challenge,
        notice: "Wi-Fi credentials are sent only from the phone to the ESP8266 setup network. They never reach this server."
      };
    }
  );
  app.post(
    "/api/devices/assign",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } }
    },
    async (request) => {
      const user = authUser(request);
      const body = parseBody(assignSchema, request.body ?? {});
      const result = await claimDevice(app.deps, user.uid, body.pairingToken);
      app.deps.hub.publishToAdmins({
        type: "device",
        device: publicDevice(result.device)
      });
      return {
        assigned: true,
        device: publicDevice(result.device),
        previousDeviceId: result.previousDeviceId,
        message: "Device assigned. Confirm it comes online after it joins your Wi-Fi and sends its first heartbeat."
      };
    }
  );
  app.post(
    "/api/devices/provisioning/claim",
    { preHandler: [app.authenticate] },
    async (request) => {
      const user = authUser(request);
      const body = parseBody(assignSchema, request.body ?? {});
      const result = await claimDevice(app.deps, user.uid, body.pairingToken);
      return { assigned: true, device: publicDevice(result.device) };
    }
  );
  app.get("/api/devices/status", { preHandler: [app.authenticate] }, async (request) => {
    const user = authUser(request);
    const device = await getDeviceForUser(app.deps, user.profile);
    let deviceRecord = device;
    if (!deviceRecord && user.profile.deviceId) {
      deviceRecord = await app.deps.store.get(paths.device(user.profile.deviceId));
    }
    return { device: deviceRecord ? publicDevice(deviceRecord) : null };
  });
}

// src/payments/routes.ts
import { z as z5 } from "zod";

// src/payments/serialize.ts
function paymentOrderPayload(order) {
  return {
    orderId: order.orderId,
    userId: order.userId,
    quantityMl: order.quantityMl,
    amountPaise: order.amountPaise,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    creditedAt: order.creditedAt ? order.creditedAt.toISOString() : null
  };
}

// src/config/env.ts
import { z as z4 } from "zod";
var envSchema = z4.object({
  NODE_ENV: z4.enum(["development", "test", "production"]).default("development"),
  PORT: z4.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z4.string().default("info"),
  CORS_ORIGINS: z4.string().default(""),
  FIREBASE_PROJECT_ID: z4.string().min(1),
  FIREBASE_ADMIN_SERVICE_ACCOUNT_PATH: z4.string().default(""),
  THINGSBOARD_BASE_URL: z4.string().url().default("https://thingsboard.cloud"),
  THINGSBOARD_API_KEY: z4.string().default(""),
  THINGSBOARD_WEBHOOK_SECRET: z4.string().min(16),
  THINGSBOARD_DEVICE_OFFLINE_THRESHOLD_MS: z4.coerce.number().int().positive().default(45e3),
  THINGSBOARD_RPC_TIMEOUT_MS: z4.coerce.number().int().min(500).max(2e4).default(5e3),
  RAZORPAY_KEY_ID: z4.string().default(""),
  RAZORPAY_KEY_SECRET: z4.string().default(""),
  RAZORPAY_WEBHOOK_SECRET: z4.string().default(""),
  RAZORPAY_MODE: z4.enum(["test", "live"]).default("test"),
  PAIRING_TOKEN_SECRET: z4.string().min(16),
  VALVE_OPEN_DURATION_MS: z4.coerce.number().int().min(100).max(1e4).default(1e3),
  CYCLE_CLOSED_GAP_MS: z4.coerce.number().int().min(50).max(1e4).default(100),
  MAX_AUTHORIZED_ML_PER_SESSION: z4.coerce.number().int().positive().default(1e5),
  MIN_AUTHORIZED_ML: z4.coerce.number().int().positive().default(100)
});
function loadConfig(env = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid server configuration: ${issues}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    corsOrigins: e.CORS_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean),
    firebase: {
      projectId: e.FIREBASE_PROJECT_ID,
      serviceAccountPath: e.FIREBASE_ADMIN_SERVICE_ACCOUNT_PATH || null
    },
    thingsboard: {
      baseUrl: e.THINGSBOARD_BASE_URL.replace(/\/+$/, ""),
      apiKey: e.THINGSBOARD_API_KEY || null,
      webhookSecret: e.THINGSBOARD_WEBHOOK_SECRET,
      offlineThresholdMs: e.THINGSBOARD_DEVICE_OFFLINE_THRESHOLD_MS,
      rpcTimeoutMs: e.THINGSBOARD_RPC_TIMEOUT_MS
    },
    razorpay: {
      keyId: e.RAZORPAY_KEY_ID || null,
      keySecret: e.RAZORPAY_KEY_SECRET || null,
      webhookSecret: e.RAZORPAY_WEBHOOK_SECRET || null,
      mode: e.RAZORPAY_MODE
    },
    pairing: {
      tokenSecret: e.PAIRING_TOKEN_SECRET,
      challengeTtlMs: 10 * 60 * 1e3
    },
    valve: {
      openDurationMs: e.VALVE_OPEN_DURATION_MS,
      closedGapMs: e.CYCLE_CLOSED_GAP_MS,
      maxAuthorizedMlPerSession: e.MAX_AUTHORIZED_ML_PER_SESSION,
      minAuthorizedMl: e.MIN_AUTHORIZED_ML
    }
  };
}
function isRazorpayConfigured(config) {
  return Boolean(config.razorpay.keyId && config.razorpay.keySecret);
}

// src/payments/service.ts
async function createRechargeOrder(deps, user, quantityMl) {
  const pricing = await requirePricing(deps);
  assertQuantity(pricing, quantityMl);
  if (!isRazorpayConfigured(deps.config) || !deps.config.razorpay.keyId) {
    throw errors.unavailable(
      "razorpay_not_configured",
      "Online recharge is not configured yet. Contact an administrator."
    );
  }
  const amountPaise = amountFor(quantityMl, pricing.pricePerLitrePaise);
  if (amountPaise < 100) {
    throw errors.badRequest("amount_too_small", "Recharge amount must be at least 100 paise.");
  }
  const orderId = newId("ord");
  const providerOrder = await deps.payments.createOrder({
    amountPaise,
    receipt: orderId,
    notes: { orderId, userId: user.uid }
  });
  const order = {
    orderId,
    userId: user.uid,
    quantityMl,
    amountPaise,
    currency: "INR",
    razorpayOrderId: providerOrder.id,
    razorpayPaymentId: null,
    status: "created",
    createdAt: deps.now(),
    paidAt: null,
    creditedAt: null,
    failureReason: null
  };
  await deps.store.set(paths.rechargeOrder(orderId), { ...order });
  return {
    orderId,
    razorpayOrderId: providerOrder.id,
    quantityMl,
    amountPaise,
    currency: "INR",
    keyId: deps.config.razorpay.keyId,
    mode: deps.config.razorpay.mode,
    prefill: { name: user.fullName, email: user.email }
  };
}
async function verifyCheckoutPayment(deps, user, input) {
  const order = await findOrderByProviderId(deps, input.razorpayOrderId);
  if (!order) throw errors.notFound("Recharge order not found.");
  if (order.userId !== user.uid) {
    throw errors.forbidden("This recharge order belongs to another customer.");
  }
  if (order.creditedAt) {
    return {
      status: "paid",
      credited: false,
      balanceMl: user.balanceMl,
      order,
      message: "This payment was already credited."
    };
  }
  if (!deps.payments.verifyCheckoutSignature({
    orderId: input.razorpayOrderId,
    paymentId: input.razorpayPaymentId,
    signature: input.razorpaySignature
  })) {
    await markOrderFailed(deps, order, "signature_verification_failed");
    throw errors.badRequest("payment_signature_invalid", "Payment signature verification failed.");
  }
  const providerPayment = await deps.payments.fetchPayment(input.razorpayPaymentId);
  if (providerPayment.order_id !== input.razorpayOrderId) {
    throw errors.badRequest("payment_order_mismatch", "Payment does not belong to this order.");
  }
  if (providerPayment.amount !== order.amountPaise || providerPayment.currency !== "INR") {
    throw errors.badRequest("payment_amount_mismatch", "Payment amount does not match the order.");
  }
  if (providerPayment.status === "authorized" && !providerPayment.captured) {
    await deps.store.merge(paths.rechargeOrder(order.orderId), {
      status: "pending",
      razorpayPaymentId: providerPayment.id
    });
    return {
      status: "pending",
      credited: false,
      balanceMl: user.balanceMl,
      order: { ...order, status: "pending", razorpayPaymentId: providerPayment.id },
      message: "Payment is authorized but not captured yet. Balance will update when captured."
    };
  }
  if (!providerPayment.captured || providerPayment.status !== "captured") {
    await markOrderFailed(deps, order, `provider_status_${providerPayment.status}`);
    return {
      status: "failed",
      credited: false,
      balanceMl: user.balanceMl,
      order: { ...order, status: "failed" },
      message: `Payment was not captured (status: ${providerPayment.status}).`
    };
  }
  const credited = await creditOrder(deps, {
    order,
    providerPayment,
    source: "checkout",
    signatureValid: true
  });
  return {
    status: "paid",
    credited: credited.credited,
    balanceMl: credited.balanceMl,
    order: credited.order,
    message: credited.credited ? "Payment verified and water balance credited." : "Payment was already credited."
  };
}
async function creditOrder(deps, input) {
  const { order, providerPayment } = input;
  const at = deps.now();
  const result = await deps.store.runTransaction(async (tx) => {
    const freshOrder = await tx.get(paths.rechargeOrder(order.orderId));
    if (!freshOrder) throw errors.notFound("Recharge order not found.");
    if (freshOrder.creditedAt) {
      const existingUser = await tx.get(paths.user(freshOrder.userId));
      if (!existingUser) throw errors.notFound("Customer not found.");
      return {
        credited: false,
        balanceMl: existingUser.balanceMl,
        totalEstimatedDispensedMl: existingUser.totalEstimatedDispensedMl,
        order: freshOrder,
        userId: freshOrder.userId
      };
    }
    if (freshOrder.amountPaise !== providerPayment.amount) {
      throw errors.badRequest("payment_amount_mismatch", "Verified amount does not match the order.");
    }
    const user = await tx.get(paths.user(freshOrder.userId));
    if (!user) throw errors.notFound("Customer not found.");
    const existingPayment = await tx.get(paths.payment(providerPayment.id));
    if (existingPayment && existingPayment.userId !== freshOrder.userId) {
      throw errors.conflict("payment_conflict", "Payment ID is already linked to another account.");
    }
    const balanceAfter = user.balanceMl + freshOrder.quantityMl;
    const updatedOrder = {
      ...freshOrder,
      razorpayPaymentId: providerPayment.id,
      status: "paid",
      paidAt: freshOrder.paidAt ?? at,
      creditedAt: at,
      failureReason: null
    };
    const paymentDoc = {
      paymentId: providerPayment.id,
      userId: freshOrder.userId,
      provider: "razorpay",
      amountPaise: providerPayment.amount,
      currency: "INR",
      status: "captured",
      providerOrderId: providerPayment.order_id,
      providerPaymentId: providerPayment.id,
      verification: {
        signatureValid: input.signatureValid,
        statusFromProvider: providerPayment.status,
        captured: providerPayment.captured,
        verifiedAt: at,
        source: input.source
      },
      createdAt: existingPayment?.createdAt ?? at,
      updatedAt: at
    };
    tx.set(paths.user(user.uid), {
      ...user,
      balanceMl: balanceAfter,
      updatedAt: at
    });
    tx.set(paths.rechargeOrder(freshOrder.orderId), { ...updatedOrder });
    tx.set(paths.payment(providerPayment.id), { ...paymentDoc });
    const transactionId = newId("txn");
    tx.set(paths.transaction(transactionId), {
      transactionId,
      userId: user.uid,
      type: "recharge",
      deltaMl: freshOrder.quantityMl,
      balanceAfterMl: balanceAfter,
      referenceId: freshOrder.orderId,
      description: `Online recharge (${providerPayment.id})`,
      createdAt: at,
      createdBy: input.source === "webhook" ? "razorpay_webhook" : "razorpay_checkout"
    });
    return {
      credited: true,
      balanceMl: balanceAfter,
      order: updatedOrder,
      userId: user.uid,
      totalEstimatedDispensedMl: user.totalEstimatedDispensedMl
    };
  });
  deps.hub.publishToUser(result.userId, {
    type: "balance",
    balanceMl: result.balanceMl,
    totalEstimatedDispensedMl: result.totalEstimatedDispensedMl,
    updatedAt: at.toISOString()
  });
  deps.hub.publishToUser(result.userId, {
    type: "payment",
    order: paymentOrderPayload(result.order)
  });
  deps.hub.publishToAdmins({ type: "payment", order: paymentOrderPayload(result.order) });
  return { credited: result.credited, balanceMl: result.balanceMl, order: result.order };
}
async function handleRazorpayWebhook(deps, rawBody, signature) {
  if (!deps.payments.verifyWebhookSignature(rawBody, signature)) {
    throw errors.badRequest("invalid_webhook_signature", "Razorpay webhook signature is invalid.");
  }
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw errors.badRequest("invalid_webhook_body", "Webhook body is not valid JSON.");
  }
  const eventName = event.event ?? "";
  if (!eventName) throw errors.badRequest("invalid_webhook_body", "Webhook event name is missing.");
  if (eventName === "payment.captured" || eventName === "order.paid") {
    const entity = event.payload?.payment?.entity;
    if (!entity) return { handled: false, reason: "missing_payment_entity" };
    const orderId = String(entity.order_id ?? "");
    const paymentId = String(entity.id ?? "");
    const amount = Number(entity.amount ?? 0);
    const currency = String(entity.currency ?? "INR");
    const status = String(entity.status ?? "");
    if (!orderId || !paymentId) {
      return { handled: false, reason: "missing_payment_identity" };
    }
    const order = await findOrderByProviderId(deps, orderId);
    if (!order) return { handled: false, reason: "order_not_found" };
    if (currency !== "INR") return { handled: false, reason: "currency_mismatch" };
    if (!Number.isInteger(amount) || amount !== order.amountPaise) {
      return { handled: false, reason: "amount_mismatch" };
    }
    if (status !== "captured") {
      return { handled: false, reason: `payment_status_${status || "unknown"}` };
    }
    const credited = await creditOrder(deps, {
      order,
      providerPayment: {
        id: paymentId,
        order_id: orderId,
        amount,
        currency,
        status,
        captured: true
      },
      source: "webhook",
      signatureValid: true
    });
    return {
      handled: true,
      reason: credited.credited ? "credited" : "already_credited"
    };
  }
  if (eventName === "payment.failed") {
    const entity = event.payload?.payment?.entity;
    const orderId = entity ? String(entity.order_id ?? "") : "";
    if (!orderId) return { handled: false, reason: "missing_order" };
    const order = await findOrderByProviderId(deps, orderId);
    if (!order) return { handled: false, reason: "order_not_found" };
    if (!order.creditedAt) {
      await deps.store.merge(paths.rechargeOrder(order.orderId), {
        status: "failed",
        failureReason: String(entity?.error_description ?? "payment_failed"),
        razorpayPaymentId: String(entity?.id ?? "") || null
      });
      deps.hub.publishToUser(order.userId, {
        type: "payment",
        order: paymentOrderPayload({ ...order, status: "failed" })
      });
    }
    return { handled: true, reason: "marked_failed" };
  }
  if (eventName === "refund.processed" || eventName === "refund.created") {
    const entity = event.payload?.refund?.entity;
    const paymentId = entity ? String(entity.payment_id ?? "") : "";
    if (!paymentId) return { handled: false, reason: "missing_payment" };
    const payment = await deps.store.get(paths.payment(paymentId));
    if (!payment) return { handled: false, reason: "payment_not_found" };
    await deps.store.merge(paths.payment(paymentId), {
      status: "refunded",
      updatedAt: deps.now()
    });
    const order = await findOrderByProviderId(deps, payment.providerOrderId);
    if (order) {
      await deps.store.merge(paths.rechargeOrder(order.orderId), {
        status: "refunded",
        failureReason: `refund:${String(entity?.status ?? "processed")}`
      });
      deps.hub.publishToUser(order.userId, {
        type: "payment",
        order: paymentOrderPayload({ ...order, status: "refunded" })
      });
    }
    return { handled: true, reason: "refund_recorded" };
  }
  return { handled: false, reason: "ignored_event" };
}
async function findOrderByProviderId(deps, razorpayOrderId) {
  const results = await deps.store.query("rechargeOrders", {
    filters: [{ field: "razorpayOrderId", op: "==", value: razorpayOrderId }],
    limit: 1
  });
  return results[0] ?? null;
}
async function markOrderFailed(deps, order, reason) {
  await deps.store.merge(paths.rechargeOrder(order.orderId), {
    status: "failed",
    failureReason: reason
  });
  deps.hub.publishToUser(order.userId, {
    type: "payment",
    order: paymentOrderPayload({ ...order, status: "failed" })
  });
}
function assertQuantity(pricing, quantityMl) {
  if (!Number.isInteger(quantityMl) || quantityMl <= 0) {
    throw errors.badRequest("invalid_quantity", "Quantity must be a positive integer in mL.");
  }
  const minMl = pricing.minimumRechargeLitres * 1e3;
  const maxMl = pricing.maximumRechargeLitres * 1e3;
  if (quantityMl < minMl || quantityMl > maxMl) {
    throw errors.badRequest(
      "quantity_out_of_range",
      `Quantity must be between ${pricing.minimumRechargeLitres} L and ${pricing.maximumRechargeLitres} L.`
    );
  }
  if (quantityMl % 100 !== 0) {
    throw errors.badRequest("quantity_increment", "Quantity must be a multiple of 100 mL.");
  }
}

// src/payments/routes.ts
var createOrderSchema = z5.object({
  quantityMl: z5.number().int().positive().max(1e8)
});
var verifySchema = z5.object({
  razorpayOrderId: z5.string().min(3).max(120),
  razorpayPaymentId: z5.string().min(3).max(120),
  razorpaySignature: z5.string().min(10).max(512)
});
async function paymentRoutes(app) {
  app.get("/api/recharge/pricing", { preHandler: [app.authenticate] }, async () => {
    const pricing = await getPricing(app.deps);
    if (!pricing) {
      return { configured: false, paymentsEnabled: false };
    }
    return {
      configured: true,
      paymentsEnabled: Boolean(app.deps.config.razorpay.keyId),
      pricePerLitrePaise: pricing.pricePerLitrePaise,
      pricePerLitreInr: pricing.pricePerLitrePaise / 100,
      currency: pricing.currency,
      minimumRechargeLitres: pricing.minimumRechargeLitres,
      maximumRechargeLitres: pricing.maximumRechargeLitres,
      availableRechargePackages: pricing.availableRechargePackages,
      mode: app.deps.config.razorpay.mode
    };
  });
  app.post(
    "/api/payments/create-order",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } }
    },
    async (request) => {
      const user = authUser(request);
      const body = parseBody(createOrderSchema, request.body ?? {});
      return createRechargeOrder(app.deps, user.profile, body.quantityMl);
    }
  );
  app.post(
    "/api/payments/verify",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } }
    },
    async (request) => {
      const user = authUser(request);
      const body = parseBody(verifySchema, request.body ?? {});
      return verifyCheckoutPayment(app.deps, user.profile, body);
    }
  );
  app.get("/api/payments/:paymentId", { preHandler: [app.authenticate] }, async (request) => {
    const user = authUser(request);
    const { paymentId } = request.params;
    const payment = await app.deps.store.get(
      `payments/${paymentId}`
    );
    if (!payment) throw errors.notFound("Payment not found.");
    if (payment.userId !== user.uid && user.role !== "admin") {
      throw errors.forbidden();
    }
    return { payment };
  });
}

// src/admin/routes.ts
import { z as z6 } from "zod";

// src/admin/audit.ts
async function writeAudit(deps, input) {
  const log = {
    logId: newId("audit"),
    actorUid: input.actorUid,
    actorEmail: input.actorEmail,
    action: input.action,
    targetUserId: input.targetUserId ?? null,
    targetDeviceId: input.targetDeviceId ?? null,
    metadata: input.metadata ?? {},
    createdAt: deps.now()
  };
  await deps.store.set(paths.auditLog(log.logId), { ...log });
}

// src/admin/routes.ts
var creditSchema = z6.object({
  quantityMl: z6.number().int().positive().max(1e6),
  reason: z6.string().trim().max(160).optional()
});
var statusSchema = z6.object({ status: z6.enum(["active", "disabled"]) });
var assignSchema2 = z6.object({
  deviceId: z6.string().trim().min(3).max(80),
  uid: z6.string().trim().min(1).max(128).nullable()
});
var emergencySchema = z6.object({ deviceId: z6.string().trim().min(1).max(80) });
var registerDeviceSchema = z6.object({
  thingsBoardDeviceUuid: z6.string().trim().min(8).max(80),
  deviceName: z6.string().trim().min(2).max(80),
  hardwareModel: z6.string().trim().min(2).max(80).default("ESP8266 NodeMCU")
});
var pricingSchema = z6.object({
  pricePerLitrePaise: z6.number().int().min(1).max(1e6),
  minimumRechargeLitres: z6.number().int().min(1).max(1e5),
  maximumRechargeLitres: z6.number().int().min(1).max(1e5),
  availableRechargePackages: z6.array(z6.number().int().positive()).min(1).max(12)
});
async function adminRoutes(app) {
  const guard = { preHandler: [app.authenticate, app.requireAdmin] };
  const valveService = new ValveService(app.deps);
  app.get("/api/admin/overview", guard, async () => {
    const deps = app.deps;
    const [users, devices, orders, events, sessions] = await Promise.all([
      deps.store.query("users", { limit: 1e3 }),
      deps.store.query("devices", { limit: 500 }),
      deps.store.query("rechargeOrders", {
        orderBy: { field: "createdAt", direction: "desc" },
        limit: 200
      }),
      deps.store.query("dispensingEvents", {
        orderBy: { field: "processedAt", direction: "desc" },
        limit: 20
      }),
      deps.store.query("dispensingSessions", {
        orderBy: { field: "createdAt", direction: "desc" },
        limit: 20
      })
    ]);
    const customers = users.filter((entry) => entry.role === "customer");
    const paidOrders = orders.filter((order) => order.status === "paid");
    return {
      totals: {
        customers: customers.length,
        activeCustomers: customers.filter((entry) => entry.status === "active").length,
        balanceMl: customers.reduce((sum, entry) => sum + entry.balanceMl, 0),
        estimatedDispensedMl: customers.reduce(
          (sum, entry) => sum + entry.totalEstimatedDispensedMl,
          0
        ),
        onlineDevices: devices.filter((entry) => entry.status === "online").length,
        devices: devices.length,
        paidRechargePaise: paidOrders.reduce((sum, order) => sum + order.amountPaise, 0),
        pendingPayments: orders.filter(
          (order) => order.status === "created" || order.status === "pending"
        ).length
      },
      devices: devices.map(publicDevice),
      recentEvents: events,
      recentSessions: sessions,
      recentOrders: orders.slice(0, 10)
    };
  });
  app.get("/api/admin/customers", guard, async (request) => {
    const { search } = request.query;
    const users = await app.deps.store.query("users", {
      orderBy: { field: "createdAt", direction: "desc" },
      limit: 500
    });
    const needle = (search ?? "").trim().toLowerCase();
    const customers = users.filter((entry) => entry.role === "customer").filter(
      (entry) => !needle || entry.fullName.toLowerCase().includes(needle) || entry.email.toLowerCase().includes(needle) || entry.uid.toLowerCase().includes(needle)
    ).map(serializeUser);
    return { customers };
  });
  app.get("/api/admin/customers/:uid", guard, async (request) => {
    const { uid } = request.params;
    const deps = app.deps;
    const user = await deps.store.get(paths.user(uid));
    if (!user) throw errors.notFound("Customer not found.");
    const [device, transactions, sessions, orders] = await Promise.all([
      user.deviceId ? deps.store.get(paths.device(user.deviceId)) : null,
      deps.store.query("transactions", {
        filters: [{ field: "userId", op: "==", value: uid }],
        orderBy: { field: "createdAt", direction: "desc" },
        limit: 50
      }),
      deps.store.query("dispensingSessions", {
        filters: [{ field: "userId", op: "==", value: uid }],
        orderBy: { field: "createdAt", direction: "desc" },
        limit: 20
      }),
      deps.store.query("rechargeOrders", {
        filters: [{ field: "userId", op: "==", value: uid }],
        orderBy: { field: "createdAt", direction: "desc" },
        limit: 20
      })
    ]);
    return {
      customer: serializeUser(user),
      device: device ? publicDevice(device) : null,
      transactions,
      sessions,
      orders
    };
  });
  app.post("/api/admin/customers/:uid/credit", guard, async (request) => {
    const admin = authUser(request);
    const { uid } = request.params;
    const body = parseBody(creditSchema, request.body ?? {});
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
      throw errors.badRequest(
        "idempotency_key_required",
        "Provide an Idempotency-Key header (8-128 letters, digits, _ or -)."
      );
    }
    const deps = app.deps;
    const now = deps.now();
    const transactionId = `cash_${sha256Hex(key).slice(0, 40)}`;
    const result = await deps.store.runTransaction(async (tx) => {
      const user = await tx.get(paths.user(uid));
      if (!user) throw errors.notFound("Customer not found.");
      if (user.role !== "customer") {
        throw errors.badRequest("invalid_target", "Only customer accounts can be credited.");
      }
      const existing = await tx.get(paths.transaction(transactionId));
      if (existing) {
        return { duplicate: true, balanceMl: user.balanceMl, transaction: existing, user };
      }
      const balanceAfter = user.balanceMl + body.quantityMl;
      const auditLogId = newId("audit");
      const record = {
        transactionId,
        userId: uid,
        type: "cash_credit",
        deltaMl: body.quantityMl,
        balanceAfterMl: balanceAfter,
        referenceId: `cash:${key}`,
        description: body.reason ? `Cash credit: ${body.reason}` : "Cash credit",
        createdAt: now,
        createdBy: admin.uid
      };
      tx.set(paths.user(uid), { ...user, balanceMl: balanceAfter, updatedAt: now });
      tx.set(paths.transaction(transactionId), { ...record });
      tx.set(`auditLogs/${auditLogId}`, {
        logId: auditLogId,
        actorUid: admin.uid,
        actorEmail: admin.email ?? "",
        action: "customer.credit",
        targetUserId: uid,
        targetDeviceId: null,
        metadata: { quantityMl: body.quantityMl, idempotencyKey: key },
        createdAt: now
      });
      return { duplicate: false, balanceMl: balanceAfter, transaction: record, user };
    });
    deps.hub.publishToUser(uid, {
      type: "balance",
      balanceMl: result.balanceMl,
      totalEstimatedDispensedMl: result.user.totalEstimatedDispensedMl,
      updatedAt: now.toISOString()
    });
    return {
      credited: !result.duplicate,
      duplicate: result.duplicate,
      balanceMl: result.balanceMl,
      transaction: result.transaction
    };
  });
  app.patch("/api/admin/customers/:uid/status", guard, async (request) => {
    const admin = authUser(request);
    const { uid } = request.params;
    const body = parseBody(statusSchema, request.body ?? {});
    const deps = app.deps;
    const user = await deps.store.get(paths.user(uid));
    if (!user) throw errors.notFound("Customer not found.");
    await deps.store.merge(paths.user(uid), {
      status: body.status,
      updatedAt: deps.now()
    });
    await writeAudit(deps, {
      actorUid: admin.uid,
      actorEmail: admin.email ?? "",
      action: "customer.status",
      targetUserId: uid,
      metadata: { status: body.status }
    });
    const updated = { ...user, status: body.status };
    return { customer: serializeUser(updated) };
  });
  app.post("/api/admin/device/assign", guard, async (request) => {
    const admin = authUser(request);
    const body = parseBody(assignSchema2, request.body ?? {});
    const deps = app.deps;
    const now = deps.now();
    const result = await deps.store.runTransaction(async (tx) => {
      const device = await tx.get(paths.device(body.deviceId));
      if (!device) throw errors.notFound("Device not found.");
      if (device.activeSessionId) {
        throw errors.conflict("session_active", "Stop the active session before reassigning.");
      }
      let targetUser = null;
      if (body.uid) {
        targetUser = await tx.get(paths.user(body.uid));
        if (!targetUser) throw errors.notFound("Customer not found.");
        if (targetUser.role !== "customer") {
          throw errors.badRequest("invalid_target", "Devices are assigned to customers.");
        }
        if (targetUser.deviceId && targetUser.deviceId !== device.deviceId) {
          const previous = await tx.get(paths.device(targetUser.deviceId));
          if (previous) {
            tx.set(paths.device(previous.deviceId), {
              ...previous,
              assignedUserId: null,
              activeSessionId: null,
              updatedAt: now
            });
          }
        }
        tx.set(paths.user(targetUser.uid), {
          ...targetUser,
          deviceId: device.deviceId,
          updatedAt: now
        });
      } else if (device.assignedUserId) {
        const previousUser = await tx.get(paths.user(device.assignedUserId));
        if (previousUser && previousUser.deviceId === device.deviceId) {
          tx.set(paths.user(previousUser.uid), {
            ...previousUser,
            deviceId: null,
            updatedAt: now
          });
        }
      }
      const updated = {
        ...device,
        assignedUserId: body.uid,
        claimUsedAt: body.uid ? device.claimUsedAt ?? now : device.claimUsedAt,
        updatedAt: now
      };
      tx.set(paths.device(device.deviceId), { ...updated });
      return { device: updated };
    });
    await writeAudit(deps, {
      actorUid: admin.uid,
      actorEmail: admin.email ?? "",
      action: "device.assign",
      targetUserId: body.uid,
      targetDeviceId: body.deviceId,
      metadata: { assigned: body.uid != null }
    });
    deps.hub.publishToAdmins({ type: "device", device: publicDevice(result.device) });
    return { device: publicDevice(result.device) };
  });
  app.post("/api/admin/device/emergency-off", guard, async (request) => {
    const admin = authUser(request);
    const body = parseBody(emergencySchema, request.body ?? {});
    const result = await valveService.emergencyOff(body.deviceId, admin.uid);
    await writeAudit(app.deps, {
      actorUid: admin.uid,
      actorEmail: admin.email ?? "",
      action: "device.emergency_off",
      targetDeviceId: body.deviceId,
      metadata: { confirmed: result.confirmed, sessionId: result.sessionId }
    });
    return result;
  });
  app.get("/api/admin/devices", guard, async () => {
    const devices = await app.deps.store.query("devices", {
      orderBy: { field: "createdAt", direction: "desc" },
      limit: 200
    });
    return { devices: devices.map(publicDevice) };
  });
  app.post(
    "/api/admin/devices",
    {
      preHandler: [app.authenticate, app.requireAdmin],
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } }
    },
    async (request) => {
      const admin = authUser(request);
      const body = parseBody(registerDeviceSchema, request.body ?? {});
      const deps = app.deps;
      const duplicate = await deps.store.query("devices", {
        filters: [
          { field: "thingsBoardDeviceUuid", op: "==", value: body.thingsBoardDeviceUuid }
        ],
        limit: 1
      });
      if (duplicate.length > 0) {
        throw errors.conflict("device_exists", "That ThingsBoard device UUID is already registered.");
      }
      const now = deps.now();
      const deviceId = newDeviceId();
      const claimCode = generateClaimCode();
      const device = {
        deviceId,
        thingsBoardDeviceUuid: body.thingsBoardDeviceUuid,
        deviceName: body.deviceName,
        hardwareModel: body.hardwareModel ?? "ESP8266 NodeMCU",
        assignedUserId: null,
        status: "unknown",
        valveState: "unknown",
        lastHeartbeat: null,
        firmwareVersion: null,
        relayState: "unknown",
        activeSessionId: null,
        wifiRssi: null,
        claimCodeHash: hashClaimCode(claimCode),
        claimUsedAt: null,
        createdAt: now,
        updatedAt: now
      };
      await deps.store.set(paths.device(deviceId), { ...device });
      await writeAudit(deps, {
        actorUid: admin.uid,
        actorEmail: admin.email ?? "",
        action: "device.register",
        targetDeviceId: deviceId,
        metadata: { thingsBoardDeviceUuid: body.thingsBoardDeviceUuid }
      });
      return {
        device: publicDevice(device),
        claimCode,
        label: {
          deviceId,
          claimCode,
          qrPayload: `valve://pair?deviceId=${encodeURIComponent(deviceId)}&claimCode=${encodeURIComponent(claimCode)}`,
          warning: "The claim code is shown once. Print it on the device label and keep it private."
        }
      };
    }
  );
  app.get("/api/admin/payments", guard, async () => {
    const [orders, payments] = await Promise.all([
      app.deps.store.query("rechargeOrders", {
        orderBy: { field: "createdAt", direction: "desc" },
        limit: 100
      }),
      app.deps.store.query("payments", {
        orderBy: { field: "createdAt", direction: "desc" },
        limit: 100
      })
    ]);
    return { orders, payments };
  });
  app.get("/api/admin/consumption", guard, async () => {
    const events = await app.deps.store.query("dispensingEvents", {
      orderBy: { field: "processedAt", direction: "desc" },
      limit: 100
    });
    return { events };
  });
  app.patch("/api/admin/pricing", guard, async (request) => {
    const admin = authUser(request);
    const body = parseBody(pricingSchema, request.body ?? {});
    if (body.maximumRechargeLitres < body.minimumRechargeLitres) {
      throw errors.badRequest(
        "invalid_range",
        "Maximum recharge litres must be greater than or equal to the minimum."
      );
    }
    const packages = [...new Set(body.availableRechargePackages)].sort((a, b) => a - b);
    for (const litres of packages) {
      if (litres < body.minimumRechargeLitres || litres > body.maximumRechargeLitres) {
        throw errors.badRequest(
          "invalid_package",
          `Package ${litres} L is outside the configured recharge range.`
        );
      }
    }
    const now = app.deps.now();
    const pricing = {
      pricePerLitrePaise: body.pricePerLitrePaise,
      currency: "INR",
      minimumRechargeLitres: body.minimumRechargeLitres,
      maximumRechargeLitres: body.maximumRechargeLitres,
      availableRechargePackages: packages,
      updatedAt: now,
      updatedBy: admin.uid
    };
    await app.deps.store.set(paths.pricing(), { ...pricing });
    await writeAudit(app.deps, {
      actorUid: admin.uid,
      actorEmail: admin.email ?? "",
      action: "pricing.update",
      metadata: {
        pricePerLitrePaise: body.pricePerLitrePaise,
        minimumRechargeLitres: body.minimumRechargeLitres,
        maximumRechargeLitres: body.maximumRechargeLitres
      }
    });
    return { pricing };
  });
  app.get("/api/admin/pricing", guard, async () => {
    const pricing = await getPricing(app.deps);
    return { pricing };
  });
  app.get("/api/admin/audit", guard, async () => {
    const logs = await app.deps.store.query("auditLogs", {
      orderBy: { field: "createdAt", direction: "desc" },
      limit: 100
    });
    return { logs };
  });
  app.get("/api/admin/sessions", guard, async (request) => {
    const { status } = request.query;
    const filters = status ? [{ field: "status", op: "==", value: status }] : [];
    const sessions = await app.deps.store.query("dispensingSessions", {
      filters,
      orderBy: { field: "createdAt", direction: "desc" },
      limit: 100
    });
    return { sessions };
  });
}

// src/realtime/routes.ts
async function realtimeRoutes(app) {
  app.get("/ws", { websocket: true }, async (socket, request) => {
    const deps = app.deps;
    const token = request.query.token;
    if (!token) {
      socket.close(4401, "unauthorized");
      return;
    }
    let uid;
    let admin;
    try {
      const payload = await deps.verifier.verify(token);
      uid = payload.uid;
      admin = payload.admin;
    } catch {
      socket.close(4401, "unauthorized");
      return;
    }
    const profile = await deps.store.get(paths.user(uid));
    if (!profile || profile.status !== "active") {
      socket.close(4403, "forbidden");
      return;
    }
    const role = admin && profile.role === "admin" ? "admin" : "customer";
    deps.hub.register(uid, role, socket);
    const ping = setInterval(() => {
      if (socket.readyState === 1) {
        try {
          socket.ping();
        } catch {
        }
      }
    }, 3e4);
    if (typeof ping.unref === "function") ping.unref();
    socket.on("close", () => {
      clearInterval(ping);
      deps.hub.unregister(socket);
    });
    socket.on("error", () => {
      clearInterval(ping);
      deps.hub.unregister(socket);
    });
  });
}

// src/webhooks/thingsboard.ts
import { z as z7 } from "zod";

// src/metering/accounting.ts
var EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{3,160}$/;
function validateEventInput(deps, input) {
  if (!EVENT_ID_PATTERN.test(input.eventId)) {
    throw errors.badRequest("invalid_event_id", "Event ID format is invalid.");
  }
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw errors.badRequest("invalid_sequence", "Sequence must be a positive integer.");
  }
  if (!Number.isInteger(input.quantityMl) || input.quantityMl <= 0) {
    throw errors.badRequest("invalid_quantity", "Quantity must be a positive integer (mL).");
  }
  if (!Number.isInteger(input.valveOpenDurationMs) || input.valveOpenDurationMs <= 0) {
    throw errors.badRequest("invalid_duration", "Valve open duration must be a positive integer.");
  }
  if (input.quantityMl !== input.valveOpenDurationMs) {
    throw errors.badRequest(
      "quantity_duration_mismatch",
      "Estimated quantity must equal measured relay-energized milliseconds."
    );
  }
  const openDuration = deps.config.valve.openDurationMs;
  if (input.valveOpenDurationMs > openDuration + 250) {
    throw errors.badRequest(
      "duration_exceeds_cycle",
      `Valve open duration exceeds the configured cycle (${openDuration} ms).`
    );
  }
  if (input.type === "full_cycle" && input.valveOpenDurationMs < Math.floor(openDuration * 0.8)) {
    throw errors.badRequest(
      "invalid_full_cycle",
      "A full cycle must reflect approximately the configured open duration."
    );
  }
  if (input.type === "partial_cycle" && input.valveOpenDurationMs > openDuration) {
    throw errors.badRequest(
      "invalid_partial_cycle",
      "A partial cycle cannot exceed the configured open duration."
    );
  }
}
async function processDispensingEvent(deps, input) {
  validateEventInput(deps, input);
  const at = deps.now();
  return deps.store.runTransaction(async (tx) => {
    const device = await tx.get(paths.device(input.deviceId));
    if (!device) throw errors.notFound("Unknown device.");
    if (device.thingsBoardDeviceUuid !== input.thingsBoardDeviceUuid) {
      throw errors.forbidden("Telemetry device identity does not match the device record.");
    }
    const session = await tx.get(paths.session(input.sessionId));
    if (!session) throw errors.notFound("Unknown dispensing session.");
    if (session.deviceId !== device.deviceId || session.userId !== input.userId) {
      throw errors.conflict(
        "session_mismatch",
        "Event does not belong to this device/session pairing."
      );
    }
    const user = await tx.get(paths.user(session.userId));
    if (!user) throw errors.notFound("Unknown customer for this session.");
    if (device.assignedUserId !== user.uid) {
      throw errors.forbidden("Device is not assigned to this customer.");
    }
    const existing = await tx.get(paths.event(input.eventId));
    if (existing) {
      if (existing.sessionId !== session.sessionId) {
        throw errors.conflict("event_conflict", "Event ID already used by another session.");
      }
      return {
        duplicate: true,
        eventId: input.eventId,
        userId: user.uid,
        deviceId: device.deviceId,
        sessionId: session.sessionId,
        sequence: existing.sequence,
        quantityMl: existing.quantityMl,
        balanceMl: user.balanceMl,
        totalEstimatedDispensedMl: user.totalEstimatedDispensedMl,
        consumedMl: session.consumedMl,
        remainingAuthorizedMl: session.remainingAuthorizedMl,
        sessionStatus: session.status,
        sessionCompleted: session.status === "completed"
      };
    }
    if (session.status === "completed" || session.status === "failed") {
      throw errors.conflict(
        "session_closed",
        `Session is already ${session.status}; the event cannot be applied.`
      );
    }
    const expectedSequence = session.lastProcessedSequence + 1;
    if (input.sequence !== expectedSequence) {
      throw errors.conflict(
        "sequence_out_of_order",
        `Expected sequence ${expectedSequence}, received ${input.sequence}.`,
        { expectedSequence }
      );
    }
    const remainingBefore = session.authorizedMl - session.consumedMl;
    if (remainingBefore <= 0) {
      throw errors.conflict("allowance_exhausted", "Session allowance is already exhausted.");
    }
    if (input.quantityMl > remainingBefore) {
      throw errors.conflict(
        "allowance_exceeded",
        "Event quantity exceeds the remaining authorized allowance.",
        { remainingBefore }
      );
    }
    if (input.quantityMl > user.balanceMl) {
      throw errors.conflict("insufficient_balance", "Customer balance cannot cover this event.");
    }
    const balanceAfter = user.balanceMl - input.quantityMl;
    const consumedMl = session.consumedMl + input.quantityMl;
    const remainingAuthorizedMl = session.authorizedMl - consumedMl;
    const sessionCompleted = input.final || remainingAuthorizedMl <= 0;
    const sessionStatus = sessionCompleted ? "completed" : session.status === "pending" ? "active" : session.status;
    tx.set(paths.user(user.uid), {
      ...user,
      balanceMl: balanceAfter,
      totalEstimatedDispensedMl: user.totalEstimatedDispensedMl + input.quantityMl,
      updatedAt: at
    });
    tx.set(paths.session(session.sessionId), {
      ...session,
      status: sessionStatus,
      consumedMl,
      remainingAuthorizedMl,
      lastProcessedSequence: input.sequence,
      finalSequence: sessionCompleted ? Math.max(session.finalSequence ?? input.sequence, input.sequence) : session.finalSequence,
      reconciled: sessionCompleted,
      stoppedAt: sessionCompleted ? session.stoppedAt ?? at : session.stoppedAt,
      stopReason: sessionCompleted ? input.stopReason ?? session.stopReason ?? "allowance_exhausted" : session.stopReason,
      updatedAt: at
    });
    if (sessionCompleted && device.activeSessionId === session.sessionId) {
      tx.set(paths.device(device.deviceId), {
        ...device,
        activeSessionId: null,
        valveState: "off",
        updatedAt: at
      });
    }
    const eventDoc = {
      eventId: input.eventId,
      sessionId: session.sessionId,
      deviceId: device.deviceId,
      userId: user.uid,
      sequence: input.sequence,
      quantityMl: input.quantityMl,
      type: input.type,
      valveOpenDurationMs: input.valveOpenDurationMs,
      processedAt: at,
      balanceAfterMl: balanceAfter,
      status: "processed",
      stopReason: input.stopReason,
      bootId: input.bootId
    };
    tx.set(paths.event(input.eventId), { ...eventDoc });
    const transactionId = newId("txn");
    tx.set(paths.transaction(transactionId), {
      transactionId,
      userId: user.uid,
      type: "consumption",
      deltaMl: -input.quantityMl,
      balanceAfterMl: balanceAfter,
      referenceId: input.eventId,
      description: `Estimated water dispensed: ${input.quantityMl} mL (${input.type.replace("_", " ")})`,
      createdAt: at,
      createdBy: "device"
    });
    return {
      duplicate: false,
      eventId: input.eventId,
      userId: user.uid,
      deviceId: device.deviceId,
      sessionId: session.sessionId,
      sequence: input.sequence,
      quantityMl: input.quantityMl,
      balanceMl: balanceAfter,
      totalEstimatedDispensedMl: user.totalEstimatedDispensedMl + input.quantityMl,
      consumedMl,
      remainingAuthorizedMl,
      sessionStatus,
      sessionCompleted
    };
  });
}

// src/webhooks/thingsboard.ts
var bodySchema = z7.object({
  originatorId: z7.string().min(1).optional(),
  thingsBoardDeviceUuid: z7.string().min(1).optional(),
  deviceUuid: z7.string().min(1).optional(),
  eventType: z7.string().min(1),
  telemetry: z7.record(z7.unknown()).optional()
}).passthrough();
var consumptionSchema = z7.object({
  sessionId: z7.string().min(1).max(160),
  eventId: z7.string().min(3).max(160),
  sequence: z7.coerce.number().int().positive(),
  quantityMl: z7.coerce.number().int().positive(),
  valveOpenDurationMs: z7.coerce.number().int().positive(),
  type: z7.enum(["full_cycle", "partial_cycle"]),
  final: z7.coerce.boolean().optional(),
  stopReason: z7.string().max(80).nullable().optional(),
  bootId: z7.string().max(64).nullable().optional()
});
var VALVE_STATES = ["off", "opening", "closed", "unknown"];
function mapValveState(value) {
  return typeof value === "string" && VALVE_STATES.includes(value) ? value : "unknown";
}
async function thingsboardWebhookRoutes(app) {
  app.post(
    "/api/webhooks/thingsboard/telemetry",
    { bodyLimit: 16 * 1024 },
    async (request, reply) => {
      const deps = app.deps;
      const provided = request.headers["x-valve-webhook-secret"];
      if (typeof provided !== "string" || !safeEqual(provided, deps.config.thingsboard.webhookSecret)) {
        throw errors.unauthorized("Invalid webhook secret.");
      }
      const body = bodySchema.parse(request.body ?? {});
      const flat = { ...body.telemetry, ...body };
      const uuidCandidate = typeof body.originatorId === "string" && body.originatorId || typeof body.thingsBoardDeviceUuid === "string" && body.thingsBoardDeviceUuid || typeof body.deviceUuid === "string" && body.deviceUuid || "";
      if (!uuidCandidate) {
        throw errors.badRequest("missing_device_identity", "originatorId is required.");
      }
      const devices = await deps.store.query("devices", {
        filters: [{ field: "thingsBoardDeviceUuid", op: "==", value: uuidCandidate }],
        limit: 1
      });
      const device = devices[0];
      if (!device) {
        throw errors.forbidden("Telemetry device is not registered.");
      }
      switch (body.eventType) {
        case "consumption_event":
          return handleConsumption(app, device, flat, reply);
        case "heartbeat":
        case "state":
          return handleHeartbeat(app, device, flat);
        default:
          throw errors.badRequest("unsupported_event_type", `Unsupported eventType: ${body.eventType}`);
      }
    }
  );
}
async function handleHeartbeat(app, device, flat) {
  const deps = app.deps;
  const now = deps.now();
  const valveState = mapValveState(flat.valveState);
  const relayState = flat.relayState === "on" || flat.relayState === true ? "on" : flat.relayState === "off" || flat.relayState === false ? "off" : "unknown";
  const wifiRssi = typeof flat.wifiRssi === "number" && Number.isFinite(flat.wifiRssi) ? Math.round(flat.wifiRssi) : null;
  const firmwareVersion = typeof flat.firmwareVersion === "string" ? flat.firmwareVersion.slice(0, 40) : null;
  await deps.store.merge(paths.device(device.deviceId), {
    status: "online",
    lastHeartbeat: now,
    valveState,
    relayState,
    wifiRssi,
    firmwareVersion: firmwareVersion ?? device.firmwareVersion,
    updatedAt: now
  });
  const updated = {
    ...device,
    status: "online",
    lastHeartbeat: now,
    valveState,
    relayState,
    wifiRssi,
    firmwareVersion: firmwareVersion ?? device.firmwareVersion
  };
  const abortedSessionId = typeof flat.abortedSessionId === "string" ? flat.abortedSessionId : "";
  if (abortedSessionId) {
    const session = await deps.store.get(
      paths.session(abortedSessionId)
    );
    if (session && session.deviceId === device.deviceId && session.status !== "completed" && session.status !== "failed") {
      const reportedFinal = Number(flat.finalSequence);
      const finalSequence = Number.isInteger(reportedFinal) ? reportedFinal : session.finalSequence;
      const completed = finalSequence != null && session.lastProcessedSequence >= finalSequence;
      const reconciledSession = {
        ...session,
        finalSequence,
        status: completed ? "completed" : "reconciling",
        reconciled: completed,
        stoppedAt: session.stoppedAt ?? now,
        stopReason: session.stopReason ?? (typeof flat.stopReason === "string" ? flat.stopReason : "device_aborted"),
        updatedAt: now
      };
      await deps.store.set(paths.session(session.sessionId), {
        ...reconciledSession
      });
      if (completed) {
        await deps.store.merge(paths.device(device.deviceId), {
          activeSessionId: null,
          valveState: "off",
          updatedAt: now
        });
        updated.activeSessionId = null;
        updated.valveState = "off";
      }
      const sessionMessage = {
        type: "session",
        session: publicSession(reconciledSession)
      };
      deps.hub.publishToUser(reconciledSession.userId, sessionMessage);
      deps.hub.publishToAdmins(sessionMessage);
    }
  }
  deps.hub.publishToAdmins({ type: "device", device: publicDevice(updated) });
  if (device.assignedUserId) {
    deps.hub.publishToUser(device.assignedUserId, {
      type: "device",
      device: publicDevice(updated)
    });
  }
  return { ok: true, deviceId: device.deviceId, status: "online" };
}
async function handleConsumption(app, device, flat, reply) {
  const deps = app.deps;
  if (!device.assignedUserId) {
    throw errors.conflict("device_unassigned", "Device is not assigned to a customer.");
  }
  const parsed = consumptionSchema.safeParse(flat);
  if (!parsed.success) {
    throw errors.badRequest(
      "invalid_consumption_event",
      parsed.error.issues.map((issue) => issue.message).join("; ")
    );
  }
  const data = parsed.data;
  const result = await processDispensingEvent(deps, {
    deviceId: device.deviceId,
    thingsBoardDeviceUuid: device.thingsBoardDeviceUuid,
    sessionId: data.sessionId,
    userId: device.assignedUserId,
    eventId: data.eventId,
    sequence: data.sequence,
    quantityMl: data.quantityMl,
    valveOpenDurationMs: data.valveOpenDurationMs,
    type: data.type,
    final: data.final === true,
    stopReason: data.stopReason ?? null,
    bootId: data.bootId ?? null
  });
  const at = deps.now();
  deps.hub.publishToUser(result.userId, {
    type: "dispensing",
    eventId: result.eventId,
    sessionId: result.sessionId,
    quantityMl: result.quantityMl,
    consumedMl: result.consumedMl,
    remainingAuthorizedMl: result.remainingAuthorizedMl,
    balanceMl: result.balanceMl,
    sequence: result.sequence,
    at: at.toISOString()
  });
  deps.hub.publishToUser(result.userId, {
    type: "balance",
    balanceMl: result.balanceMl,
    totalEstimatedDispensedMl: result.totalEstimatedDispensedMl,
    updatedAt: at.toISOString()
  });
  const session = await deps.store.get(paths.session(result.sessionId));
  if (session) {
    const message = { type: "session", session: publicSession(session) };
    deps.hub.publishToUser(result.userId, message);
    deps.hub.publishToAdmins(message);
  }
  deps.hub.publishToAdmins({
    type: "dispensing",
    eventId: result.eventId,
    sessionId: result.sessionId,
    quantityMl: result.quantityMl,
    consumedMl: result.consumedMl,
    remainingAuthorizedMl: result.remainingAuthorizedMl,
    balanceMl: result.balanceMl,
    sequence: result.sequence,
    at: at.toISOString()
  });
  try {
    await deps.thingsboard.sendTwoWayRpc(device.thingsBoardDeviceUuid, "ackConsumptionEvent", {
      eventId: result.eventId,
      sessionId: result.sessionId,
      sequence: result.sequence,
      success: true,
      duplicate: result.duplicate,
      balanceAfterMl: result.balanceMl,
      sessionCompleted: result.sessionCompleted
    });
  } catch (err) {
    app.log.warn(
      { deviceId: device.deviceId, eventId: result.eventId, err: err.message },
      "Event committed but device acknowledgement RPC failed"
    );
  }
  reply.code(200);
  return {
    ok: true,
    duplicate: result.duplicate,
    eventId: result.eventId,
    sessionId: result.sessionId,
    sequence: result.sequence,
    balanceMl: result.balanceMl,
    consumedMl: result.consumedMl,
    remainingAuthorizedMl: result.remainingAuthorizedMl,
    sessionStatus: result.sessionStatus
  };
}

// src/webhooks/razorpay.ts
async function razorpayWebhookRoutes(app) {
  app.post("/api/webhooks/razorpay", { bodyLimit: 64 * 1024 }, async (request, reply) => {
    const signature = request.headers["x-razorpay-signature"];
    if (typeof signature !== "string") {
      throw errors.unauthorized("Missing Razorpay webhook signature.");
    }
    const raw = request.rawBody;
    if (!raw) {
      throw errors.badRequest("invalid_webhook_body", "Raw webhook body is unavailable.");
    }
    const result = await handleRazorpayWebhook(app.deps, raw, signature);
    reply.code(200);
    return { ok: true, ...result };
  });
}

// src/app.ts
async function buildApp(deps, options = {}) {
  const isTest = deps.config.env === "test";
  const app = Fastify({
    logger: options.logger === false || isTest ? false : {
      level: deps.config.logLevel,
      redact: {
        paths: [
          "req.headers.authorization",
          'req.headers["x-valve-webhook-secret"]',
          'req.headers["x-razorpay-signature"]',
          "req.headers.cookie",
          'res.headers["set-cookie"]'
        ],
        censor: "[redacted]"
      }
    },
    bodyLimit: 256 * 1024,
    trustProxy: true,
    disableRequestLogging: false
  });
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, body, done) => {
      const raw = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
      request.rawBody = raw;
      if (!raw.trim()) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(raw));
      } catch {
        const err = new Error("Request body is not valid JSON.");
        err.statusCode = 400;
        err.code = "FST_ERR_CTP_INVALID_JSON";
        done(err);
      }
    }
  );
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  });
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, deps.config.corsOrigins.includes(origin));
    },
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
    maxAge: 600
  });
  await app.register(rateLimit, {
    max: isTest ? 1e5 : 300,
    timeWindow: "1 minute"
  });
  await app.register(websocket, {
    options: { maxPayload: 64 * 1024 }
  });
  await registerAuth(app, deps);
  app.get("/health", async () => ({
    status: "ok",
    service: "valve-backend",
    time: deps.now().toISOString(),
    thingsboardConfigured: Boolean(deps.config.thingsboard.apiKey),
    paymentsConfigured: Boolean(
      deps.config.razorpay.keyId && deps.config.razorpay.keySecret
    )
  }));
  app.setNotFoundHandler(async (_request, reply) => {
    reply.code(404).send({ error: { code: "not_found", message: "Route not found." } });
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...error.details ? { details: error.details } : {}
        }
      });
      return;
    }
    if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE" || error.statusCode === 413) {
      reply.code(413).send({
        error: { code: "body_too_large", message: "Request body is too large." }
      });
      return;
    }
    if (error.code === "FST_ERR_CTP_INVALID_JSON") {
      reply.code(400).send({
        error: { code: "invalid_json", message: "Request body is not valid JSON." }
      });
      return;
    }
    if (error.statusCode === 429) {
      reply.code(429).send({
        error: { code: "rate_limited", message: "Too many requests. Try again shortly." }
      });
      return;
    }
    if (typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500) {
      reply.code(error.statusCode).send({
        error: { code: "bad_request", message: error.message }
      });
      return;
    }
    request.log.error({ err: error }, "Unhandled request error");
    reply.code(500).send({
      error: { code: "internal_error", message: "An unexpected error occurred." }
    });
  });
  await app.register(userRoutes);
  await app.register(valveRoutes);
  await app.register(deviceRoutes);
  await app.register(paymentRoutes);
  await app.register(adminRoutes);
  await app.register(realtimeRoutes);
  await app.register(thingsboardWebhookRoutes);
  await app.register(razorpayWebhookRoutes);
  return app;
}

// src/firebase/admin.ts
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp
} from "firebase-admin/app";
function initFirebaseAdmin(config) {
  if (getApps().length > 0) return getApp();
  if (config.firebase.serviceAccountPath) {
    const path = resolve(config.firebase.serviceAccountPath);
    const raw = readFileSync(path, "utf8");
    const credentials = JSON.parse(raw);
    if (typeof credentials.project_id !== "string" || typeof credentials.client_email !== "string" || typeof credentials.private_key !== "string") {
      throw new Error(
        `Service account file at ${path} is missing project_id, client_email or private_key.`
      );
    }
    return initializeApp({
      credential: cert({
        projectId: credentials.project_id,
        clientEmail: credentials.client_email,
        privateKey: credentials.private_key
      }),
      projectId: config.firebase.projectId
    });
  }
  return initializeApp({
    credential: applicationDefault(),
    projectId: config.firebase.projectId
  });
}

// src/store/firestore.ts
var FirestoreStore = class {
  constructor(db) {
    this.db = db;
  }
  db;
  async get(path) {
    const snapshot = await this.db.doc(path).get();
    if (!snapshot.exists) return null;
    return { id: snapshot.id, ...plain(snapshot.data() ?? {}) };
  }
  async set(path, data) {
    await this.db.doc(path).set(data);
  }
  async merge(path, data) {
    await this.db.doc(path).set(data, { merge: true });
  }
  async delete(path) {
    await this.db.doc(path).delete();
  }
  async query(collection, options = {}) {
    let query = this.db.collection(collection);
    for (const filter of options.filters ?? []) {
      query = query.where(filter.field, filter.op, filter.value);
    }
    if (options.orderBy) {
      query = query.orderBy(options.orderBy.field, options.orderBy.direction);
    }
    if (options.limit != null) query = query.limit(options.limit);
    try {
      const snapshot = await query.get();
      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...plain(doc.data())
      }));
    } catch (err) {
      if (err?.code === 9 || typeof err?.message === "string" && err.message.includes("requires an index")) {
        let fallbackQuery = this.db.collection(collection);
        for (const filter of options.filters ?? []) {
          fallbackQuery = fallbackQuery.where(filter.field, filter.op, filter.value);
        }
        const snapshot = await fallbackQuery.limit(Math.max(options.limit ?? 100, 100)).get();
        let docs = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...plain(doc.data())
        }));
        if (options.orderBy) {
          const { field, direction } = options.orderBy;
          docs.sort((a, b) => {
            const va = a[field] instanceof Date ? a[field].getTime() : a[field] ?? 0;
            const vb = b[field] instanceof Date ? b[field].getTime() : b[field] ?? 0;
            return direction === "desc" ? vb > va ? 1 : vb < va ? -1 : 0 : va > vb ? 1 : va < vb ? -1 : 0;
          });
        }
        if (options.limit != null) {
          docs = docs.slice(0, options.limit);
        }
        return docs;
      }
      throw err;
    }
  }
  async runTransaction(fn) {
    return this.db.runTransaction(async (transaction) => {
      const tx = {
        get: async (path) => {
          const ref = this.db.doc(path);
          const snapshot = await transaction.get(ref);
          if (!snapshot.exists) return null;
          return { id: snapshot.id, ...plain(snapshot.data() ?? {}) };
        },
        set: (path, data) => {
          transaction.set(this.db.doc(path), data);
        },
        merge: (path, data) => {
          transaction.set(this.db.doc(path), data, { merge: true });
        },
        delete: (path) => {
          transaction.delete(this.db.doc(path));
        }
      };
      return fn(tx);
    });
  }
};
function plain(value) {
  if (value === null || typeof value !== "object") return {};
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = convert(entry);
  }
  return out;
}
function convert(value) {
  if (value === null || value === void 0) return value;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    const maybeTimestamp = value;
    if (typeof maybeTimestamp.toDate === "function") {
      return maybeTimestamp.toDate();
    }
    if (Array.isArray(value)) return value.map(convert);
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = convert(entry);
    }
    return out;
  }
  return value;
}

// src/thingsboard/client.ts
var HttpThingsBoardClient = class {
  constructor(config) {
    this.config = config;
  }
  config;
  async sendTwoWayRpc(deviceUuid, method, params) {
    const { baseUrl, apiKey, rpcTimeoutMs } = this.config.thingsboard;
    if (!apiKey) {
      throw errors.unavailable(
        "thingsboard_not_configured",
        "THINGSBOARD_API_KEY is not configured on the server."
      );
    }
    const url = `${baseUrl}/api/rpc/twoway/${encodeURIComponent(deviceUuid)}`;
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Authorization": `ApiKey ${apiKey}`
        },
        body: JSON.stringify({ method, params, timeout: rpcTimeoutMs }),
        signal: AbortSignal.timeout(rpcTimeoutMs + 2e3)
      });
    } catch (err) {
      throw errors.upstream(
        "thingsboard_unreachable",
        `ThingsBoard RPC request failed: ${err.message}`
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw errors.upstream(
        "thingsboard_auth_failed",
        "ThingsBoard rejected the server API key."
      );
    }
    const text = await response.text();
    if (!response.ok) {
      throw errors.upstream(
        "thingsboard_rpc_failed",
        `ThingsBoard RPC failed with status ${response.status}.`,
        { body: text.slice(0, 500) }
      );
    }
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
      return { success: false, raw: text };
    } catch {
      return { success: false, raw: text };
    }
  }
};

// src/payments/provider.ts
var RazorpayProvider = class {
  constructor(config, fetchImpl = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.mode = config.razorpay.mode;
  }
  config;
  fetchImpl;
  mode;
  authHeader() {
    const { keyId, keySecret } = this.config.razorpay;
    if (!keyId || !keySecret) {
      throw errors.unavailable(
        "razorpay_not_configured",
        "Razorpay server credentials are not configured."
      );
    }
    return `Basic ${Buffer.from(`${keyId}:${keySecret}`, "utf8").toString("base64")}`;
  }
  async request(path, init) {
    let response;
    try {
      response = await this.fetchImpl(`https://api.razorpay.com/v1${path}`, {
        ...init,
        headers: {
          Authorization: this.authHeader(),
          "Content-Type": "application/json",
          ...init.headers ?? {}
        },
        signal: AbortSignal.timeout(15e3)
      });
    } catch (err) {
      throw errors.upstream(
        "razorpay_unreachable",
        `Could not reach Razorpay: ${err.message}`
      );
    }
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const description = body && typeof body === "object" && "error" in body ? String(body.error?.description ?? "") : "";
      throw errors.upstream(
        "razorpay_api_error",
        `Razorpay API error (${response.status})${description ? `: ${description}` : ""}.`
      );
    }
    return body;
  }
  async createOrder(input) {
    const order = await this.request("/orders", {
      method: "POST",
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: "INR",
        receipt: input.receipt,
        notes: input.notes
      })
    });
    return {
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      status: order.status
    };
  }
  async fetchPayment(paymentId) {
    const payment = await this.request(`/payments/${encodeURIComponent(paymentId)}`, { method: "GET" });
    return {
      id: payment.id,
      order_id: payment.order_id,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      captured: payment.captured === true || payment.status === "captured"
    };
  }
  verifyCheckoutSignature(input) {
    const { keySecret } = this.config.razorpay;
    if (!keySecret) return false;
    const expected = hmacSha256Hex(keySecret, `${input.orderId}|${input.paymentId}`);
    return safeEqual(expected, input.signature.trim().toLowerCase());
  }
  verifyWebhookSignature(rawBody, signature) {
    const { webhookSecret } = this.config.razorpay;
    if (!webhookSecret || !signature) return false;
    return safeEqual(hmacSha256Hex(webhookSecret, rawBody), signature.trim());
  }
};

// src/realtime/hub.ts
var OPEN = 1;
var Hub = class {
  connections = /* @__PURE__ */ new Set();
  register(uid, role, socket) {
    this.connections.add({ uid, role, socket });
    this.send(socket, {
      type: "ready",
      serverTime: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  unregister(socket) {
    for (const connection of this.connections) {
      if (connection.socket === socket) this.connections.delete(connection);
    }
  }
  publishToUser(uid, message) {
    for (const connection of this.connections) {
      if (connection.uid === uid) this.send(connection.socket, message);
    }
  }
  publishToAdmins(message) {
    for (const connection of this.connections) {
      if (connection.role === "admin") this.send(connection.socket, message);
    }
  }
  connectionCount() {
    return this.connections.size;
  }
  send(socket, message) {
    if (socket.readyState !== OPEN) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      this.unregister(socket);
    }
  }
};

// src/server.ts
async function main() {
  const config = loadConfig();
  initFirebaseAdmin(config);
  const db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });
  const deps = {
    config,
    store: new FirestoreStore(db),
    verifier: new (await import("./tokens-AOEH7JTM.js")).FirebaseTokenVerifier(),
    thingsboard: new HttpThingsBoardClient(config),
    payments: new RazorpayProvider(config),
    hub: new Hub(),
    now: () => /* @__PURE__ */ new Date()
  };
  const app = await buildApp(deps);
  const valve = new ValveService(deps);
  const intervals = [
    setInterval(() => {
      valve.reconcile().catch((err) => app.log.error({ err }, "Session reconciliation failed"));
    }, 5e3),
    setInterval(() => {
      refreshDeviceStatuses(deps).catch(
        (err) => app.log.error({ err }, "Device status refresh failed")
      );
    }, 15e3)
  ];
  for (const interval of intervals) interval.unref();
  const shutdown = async (signal) => {
    app.log.info({ signal }, "Shutting down");
    for (const interval of intervals) clearInterval(interval);
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "Shutdown failed");
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(
    {
      port: config.port,
      env: config.env,
      thingsboard: Boolean(config.thingsboard.apiKey),
      razorpay: Boolean(config.razorpay.keyId)
    },
    "Valve backend listening"
  );
}
main().catch((err) => {
  console.error("Fatal startup error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
//# sourceMappingURL=server.js.map