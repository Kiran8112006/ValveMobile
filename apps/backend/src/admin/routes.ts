import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authUser } from '../auth/plugin.js';
import type {
  DeviceDoc,
  DispensingEventDoc,
  DispensingSessionDoc,
  RechargeOrderDoc,
  TransactionDoc,
  UserDoc,
} from '../types/domain.js';
import { paths, type QueryFilter } from '../store/types.js';
import { errors } from '../utils/errors.js';
import { parseBody } from '../utils/validate.js';
import { newId } from '../utils/ids.js';
import { sha256Hex } from '../utils/security.js';
import { serializeUser } from '../users/serialize.js';
import { publicDevice } from '../types/realtime.js';
import { writeAudit } from './audit.js';
import { ValveService } from '../valve/service.js';
import { generateClaimCode, hashClaimCode, newDeviceId } from '../devices/service.js';
import { getPricing } from '../recharge/pricing.js';

const creditSchema = z.object({
  quantityMl: z.number().int().positive().max(1_000_000),
  reason: z.string().trim().max(160).optional(),
});

const statusSchema = z.object({ status: z.enum(['active', 'disabled']) });

const assignSchema = z.object({
  deviceId: z.string().trim().min(3).max(80),
  uid: z.string().trim().min(1).max(128).nullable(),
});

const emergencySchema = z.object({ deviceId: z.string().trim().min(1).max(80) });

const registerDeviceSchema = z.object({
  thingsBoardDeviceUuid: z.string().trim().min(8).max(80),
  deviceName: z.string().trim().min(2).max(80),
  hardwareModel: z.string().trim().min(2).max(80).default('ESP8266 NodeMCU'),
});

const pricingSchema = z.object({
  pricePerLitrePaise: z.number().int().min(1).max(1_000_000),
  minimumRechargeLitres: z.number().int().min(1).max(100_000),
  maximumRechargeLitres: z.number().int().min(1).max(100_000),
  availableRechargePackages: z.array(z.number().int().positive()).min(1).max(12),
});

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const guard = { preHandler: [app.authenticate, app.requireAdmin] };
  const valveService = new ValveService(app.deps);

  app.get('/api/admin/overview', guard, async () => {
    const deps = app.deps;
    const [users, devices, orders, events, sessions] = await Promise.all([
      deps.store.query<UserDoc>('users', { limit: 1000 }),
      deps.store.query<DeviceDoc>('devices', { limit: 500 }),
      deps.store.query<RechargeOrderDoc>('rechargeOrders', {
        orderBy: { field: 'createdAt', direction: 'desc' },
        limit: 200,
      }),
      deps.store.query<DispensingEventDoc>('dispensingEvents', {
        orderBy: { field: 'processedAt', direction: 'desc' },
        limit: 20,
      }),
      deps.store.query<DispensingSessionDoc>('dispensingSessions', {
        orderBy: { field: 'createdAt', direction: 'desc' },
        limit: 20,
      }),
    ]);

    const customers = users.filter((entry) => entry.role === 'customer');
    const paidOrders = orders.filter((order) => order.status === 'paid');
    return {
      totals: {
        customers: customers.length,
        activeCustomers: customers.filter((entry) => entry.status === 'active').length,
        balanceMl: customers.reduce((sum, entry) => sum + entry.balanceMl, 0),
        estimatedDispensedMl: customers.reduce(
          (sum, entry) => sum + entry.totalEstimatedDispensedMl,
          0,
        ),
        onlineDevices: devices.filter((entry) => entry.status === 'online').length,
        devices: devices.length,
        paidRechargePaise: paidOrders.reduce((sum, order) => sum + order.amountPaise, 0),
        pendingPayments: orders.filter(
          (order) => order.status === 'created' || order.status === 'pending',
        ).length,
      },
      devices: devices.map(publicDevice),
      recentEvents: events,
      recentSessions: sessions,
      recentOrders: orders.slice(0, 10),
    };
  });

  app.get('/api/admin/customers', guard, async (request) => {
    const { search } = request.query as { search?: string };
    const users = await app.deps.store.query<UserDoc>('users', {
      orderBy: { field: 'createdAt', direction: 'desc' },
      limit: 500,
    });
    const needle = (search ?? '').trim().toLowerCase();
    const customers = users
      .filter((entry) => entry.role === 'customer')
      .filter(
        (entry) =>
          !needle ||
          entry.fullName.toLowerCase().includes(needle) ||
          entry.email.toLowerCase().includes(needle) ||
          entry.uid.toLowerCase().includes(needle),
      )
      .map(serializeUser);
    return { customers };
  });

  app.get('/api/admin/customers/:uid', guard, async (request) => {
    const { uid } = request.params as { uid: string };
    const deps = app.deps;
    const user = await deps.store.get<UserDoc>(paths.user(uid));
    if (!user) throw errors.notFound('Customer not found.');
    const [device, transactions, sessions, orders] = await Promise.all([
      user.deviceId ? deps.store.get<DeviceDoc>(paths.device(user.deviceId)) : null,
      deps.store.query<TransactionDoc>('transactions', {
        filters: [{ field: 'userId', op: '==', value: uid }],
        orderBy: { field: 'createdAt', direction: 'desc' },
        limit: 50,
      }),
      deps.store.query<DispensingSessionDoc>('dispensingSessions', {
        filters: [{ field: 'userId', op: '==', value: uid }],
        orderBy: { field: 'createdAt', direction: 'desc' },
        limit: 20,
      }),
      deps.store.query<RechargeOrderDoc>('rechargeOrders', {
        filters: [{ field: 'userId', op: '==', value: uid }],
        orderBy: { field: 'createdAt', direction: 'desc' },
        limit: 20,
      }),
    ]);
    return {
      customer: serializeUser(user),
      device: device ? publicDevice(device) : null,
      transactions,
      sessions,
      orders,
    };
  });

  app.post('/api/admin/customers/:uid/credit', guard, async (request) => {
    const admin = authUser(request);
    const { uid } = request.params as { uid: string };
    const body = parseBody(creditSchema, request.body ?? {});
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
      throw errors.badRequest(
        'idempotency_key_required',
        'Provide an Idempotency-Key header (8-128 letters, digits, _ or -).',
      );
    }

    const deps = app.deps;
    const now = deps.now();
    const transactionId = `cash_${sha256Hex(key).slice(0, 40)}`;

    const result = await deps.store.runTransaction(async (tx) => {
      const user = await tx.get<UserDoc>(paths.user(uid));
      if (!user) throw errors.notFound('Customer not found.');
      if (user.role !== 'customer') {
        throw errors.badRequest('invalid_target', 'Only customer accounts can be credited.');
      }
      const existing = await tx.get<TransactionDoc>(paths.transaction(transactionId));
      if (existing) {
        return { duplicate: true, balanceMl: user.balanceMl, transaction: existing, user };
      }
      const balanceAfter = user.balanceMl + body.quantityMl;
      const auditLogId = newId('audit');
      const record: TransactionDoc = {
        transactionId,
        userId: uid,
        type: 'cash_credit',
        deltaMl: body.quantityMl,
        balanceAfterMl: balanceAfter,
        referenceId: `cash:${key}`,
        description: body.reason ? `Cash credit: ${body.reason}` : 'Cash credit',
        createdAt: now,
        createdBy: admin.uid,
      };
      tx.set(paths.user(uid), { ...user, balanceMl: balanceAfter, updatedAt: now });
      tx.set(paths.transaction(transactionId), { ...record });
      tx.set(`auditLogs/${auditLogId}`, {
        logId: auditLogId,
        actorUid: admin.uid,
        actorEmail: admin.email ?? '',
        action: 'customer.credit',
        targetUserId: uid,
        targetDeviceId: null,
        metadata: { quantityMl: body.quantityMl, idempotencyKey: key },
        createdAt: now,
      });
      return { duplicate: false, balanceMl: balanceAfter, transaction: record, user };
    });

    deps.hub.publishToUser(uid, {
      type: 'balance',
      balanceMl: result.balanceMl,
      totalEstimatedDispensedMl: result.user.totalEstimatedDispensedMl,
      updatedAt: now.toISOString(),
    });
    return {
      credited: !result.duplicate,
      duplicate: result.duplicate,
      balanceMl: result.balanceMl,
      transaction: result.transaction,
    };
  });

  app.patch('/api/admin/customers/:uid/status', guard, async (request) => {
    const admin = authUser(request);
    const { uid } = request.params as { uid: string };
    const body = parseBody(statusSchema, request.body ?? {});
    const deps = app.deps;
    const user = await deps.store.get<UserDoc>(paths.user(uid));
    if (!user) throw errors.notFound('Customer not found.');
    await deps.store.merge(paths.user(uid), {
      status: body.status,
      updatedAt: deps.now(),
    });
    await writeAudit(deps, {
      actorUid: admin.uid,
      actorEmail: admin.email ?? '',
      action: 'customer.status',
      targetUserId: uid,
      metadata: { status: body.status },
    });
    const updated = { ...user, status: body.status };
    return { customer: serializeUser(updated) };
  });

  app.post('/api/admin/device/assign', guard, async (request) => {
    const admin = authUser(request);
    const body = parseBody(assignSchema, request.body ?? {});
    const deps = app.deps;
    const now = deps.now();
    const result = await deps.store.runTransaction(async (tx) => {
      const device = await tx.get<DeviceDoc>(paths.device(body.deviceId));
      if (!device) throw errors.notFound('Device not found.');
      if (device.activeSessionId) {
        throw errors.conflict('session_active', 'Stop the active session before reassigning.');
      }
      let targetUser: UserDoc | null = null;
      if (body.uid) {
        targetUser = await tx.get<UserDoc>(paths.user(body.uid));
        if (!targetUser) throw errors.notFound('Customer not found.');
        if (targetUser.role !== 'customer') {
          throw errors.badRequest('invalid_target', 'Devices are assigned to customers.');
        }
        if (targetUser.deviceId && targetUser.deviceId !== device.deviceId) {
          const previous = await tx.get<DeviceDoc>(paths.device(targetUser.deviceId));
          if (previous) {
            tx.set(paths.device(previous.deviceId), {
              ...previous,
              assignedUserId: null,
              activeSessionId: null,
              updatedAt: now,
            });
          }
        }
        tx.set(paths.user(targetUser.uid), {
          ...targetUser,
          deviceId: device.deviceId,
          updatedAt: now,
        });
      } else if (device.assignedUserId) {
        const previousUser = await tx.get<UserDoc>(paths.user(device.assignedUserId));
        if (previousUser && previousUser.deviceId === device.deviceId) {
          tx.set(paths.user(previousUser.uid), {
            ...previousUser,
            deviceId: null,
            updatedAt: now,
          });
        }
      }
      const updated: DeviceDoc = {
        ...device,
        assignedUserId: body.uid,
        claimUsedAt: body.uid ? (device.claimUsedAt ?? now) : device.claimUsedAt,
        updatedAt: now,
      };
      tx.set(paths.device(device.deviceId), { ...updated });
      return { device: updated };
    });

    await writeAudit(deps, {
      actorUid: admin.uid,
      actorEmail: admin.email ?? '',
      action: 'device.assign',
      targetUserId: body.uid,
      targetDeviceId: body.deviceId,
      metadata: { assigned: body.uid != null },
    });
    deps.hub.publishToAdmins({ type: 'device', device: publicDevice(result.device) });
    return { device: publicDevice(result.device) };
  });

  app.post('/api/admin/device/emergency-off', guard, async (request) => {
    const admin = authUser(request);
    const body = parseBody(emergencySchema, request.body ?? {});
    const result = await valveService.emergencyOff(body.deviceId, admin.uid);
    await writeAudit(app.deps, {
      actorUid: admin.uid,
      actorEmail: admin.email ?? '',
      action: 'device.emergency_off',
      targetDeviceId: body.deviceId,
      metadata: { confirmed: result.confirmed, sessionId: result.sessionId },
    });
    return result;
  });

  app.get('/api/admin/devices', guard, async () => {
    const devices = await app.deps.store.query<DeviceDoc>('devices', {
      orderBy: { field: 'createdAt', direction: 'desc' },
      limit: 200,
    });
    return { devices: devices.map(publicDevice) };
  });

  app.post(
    '/api/admin/devices',
    {
      preHandler: [app.authenticate, app.requireAdmin],
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request) => {
      const admin = authUser(request);
      const body = parseBody(registerDeviceSchema, request.body ?? {});
      const deps = app.deps;
      const duplicate = await deps.store.query<DeviceDoc>('devices', {
        filters: [
          { field: 'thingsBoardDeviceUuid', op: '==', value: body.thingsBoardDeviceUuid },
        ],
        limit: 1,
      });
      if (duplicate.length > 0) {
        throw errors.conflict('device_exists', 'That ThingsBoard device UUID is already registered.');
      }
      const now = deps.now();
      const deviceId = newDeviceId();
      const claimCode = generateClaimCode();
      const device: DeviceDoc = {
        deviceId,
        thingsBoardDeviceUuid: body.thingsBoardDeviceUuid,
        deviceName: body.deviceName,
        hardwareModel: body.hardwareModel ?? 'ESP8266 NodeMCU',
        assignedUserId: null,
        status: 'unknown',
        valveState: 'unknown',
        lastHeartbeat: null,
        firmwareVersion: null,
        relayState: 'unknown',
        activeSessionId: null,
        wifiRssi: null,
        claimCodeHash: hashClaimCode(claimCode),
        claimUsedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await deps.store.set(paths.device(deviceId), { ...device });
      await writeAudit(deps, {
        actorUid: admin.uid,
        actorEmail: admin.email ?? '',
        action: 'device.register',
        targetDeviceId: deviceId,
        metadata: { thingsBoardDeviceUuid: body.thingsBoardDeviceUuid },
      });
      return {
        device: publicDevice(device),
        claimCode,
        label: {
          deviceId,
          claimCode,
          qrPayload: `valve://pair?deviceId=${encodeURIComponent(deviceId)}&claimCode=${encodeURIComponent(claimCode)}`,
          warning: 'The claim code is shown once. Print it on the device label and keep it private.',
        },
      };
    },
  );

  app.get('/api/admin/payments', guard, async () => {
    const [orders, payments] = await Promise.all([
      app.deps.store.query('rechargeOrders', {
        orderBy: { field: 'createdAt', direction: 'desc' },
        limit: 100,
      }),
      app.deps.store.query('payments', {
        orderBy: { field: 'createdAt', direction: 'desc' },
        limit: 100,
      }),
    ]);
    return { orders, payments };
  });

  app.get('/api/admin/consumption', guard, async () => {
    const events = await app.deps.store.query<DispensingEventDoc>('dispensingEvents', {
      orderBy: { field: 'processedAt', direction: 'desc' },
      limit: 100,
    });
    return { events };
  });

  app.patch('/api/admin/pricing', guard, async (request) => {
    const admin = authUser(request);
    const body = parseBody(pricingSchema, request.body ?? {});
    if (body.maximumRechargeLitres < body.minimumRechargeLitres) {
      throw errors.badRequest(
        'invalid_range',
        'Maximum recharge litres must be greater than or equal to the minimum.',
      );
    }
    const packages = [...new Set(body.availableRechargePackages)].sort((a, b) => a - b);
    for (const litres of packages) {
      if (litres < body.minimumRechargeLitres || litres > body.maximumRechargeLitres) {
        throw errors.badRequest(
          'invalid_package',
          `Package ${litres} L is outside the configured recharge range.`,
        );
      }
    }
    const now = app.deps.now();
    const pricing = {
      pricePerLitrePaise: body.pricePerLitrePaise,
      currency: 'INR' as const,
      minimumRechargeLitres: body.minimumRechargeLitres,
      maximumRechargeLitres: body.maximumRechargeLitres,
      availableRechargePackages: packages,
      updatedAt: now,
      updatedBy: admin.uid,
    };
    await app.deps.store.set(paths.pricing(), { ...pricing });
    await writeAudit(app.deps, {
      actorUid: admin.uid,
      actorEmail: admin.email ?? '',
      action: 'pricing.update',
      metadata: {
        pricePerLitrePaise: body.pricePerLitrePaise,
        minimumRechargeLitres: body.minimumRechargeLitres,
        maximumRechargeLitres: body.maximumRechargeLitres,
      },
    });
    return { pricing };
  });

  app.get('/api/admin/pricing', guard, async () => {
    const pricing = await getPricing(app.deps);
    return { pricing };
  });

  app.get('/api/admin/audit', guard, async () => {
    const logs = await app.deps.store.query('auditLogs', {
      orderBy: { field: 'createdAt', direction: 'desc' },
      limit: 100,
    });
    return { logs };
  });

  app.get('/api/admin/sessions', guard, async (request) => {
    const { status } = request.query as { status?: string };
    const filters: QueryFilter[] = status ? [{ field: 'status', op: '==', value: status }] : [];
    const sessions = await app.deps.store.query<DispensingSessionDoc>('dispensingSessions', {
      filters,
      orderBy: { field: 'createdAt', direction: 'desc' },
      limit: 100,
    });
    return { sessions };
  });
}
