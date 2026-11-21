import 'dotenv/config';
import { getFirestore } from 'firebase-admin/firestore';
import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { initFirebaseAdmin } from './firebase/admin.js';
import { FirestoreStore } from './store/firestore.js';
import { HttpThingsBoardClient } from './thingsboard/client.js';
import { RazorpayProvider } from './payments/provider.js';
import { Hub } from './realtime/hub.js';
import type { AppDeps } from './types/app.js';
import { ValveService } from './valve/service.js';
import { refreshDeviceStatuses } from './devices/service.js';

async function main(): Promise<void> {
  const config = loadConfig();
  initFirebaseAdmin(config);
  const db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });

  const deps: AppDeps = {
    config,
    store: new FirestoreStore(db),
    verifier: new (await import('./auth/tokens.js')).FirebaseTokenVerifier(),
    thingsboard: new HttpThingsBoardClient(config),
    payments: new RazorpayProvider(config),
    hub: new Hub(),
    now: () => new Date(),
  };

  const app = await buildApp(deps);
  const valve = new ValveService(deps);

  const intervals: NodeJS.Timeout[] = [
    setInterval(() => {
      valve.reconcile().catch((err) => app.log.error({ err }, 'Session reconciliation failed'));
    }, 5000),
    setInterval(() => {
      refreshDeviceStatuses(deps).catch((err) =>
        app.log.error({ err }, 'Device status refresh failed'),
      );
    }, 15_000),
  ];
  for (const interval of intervals) interval.unref();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down');
    for (const interval of intervals) clearInterval(interval);
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Shutdown failed');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(
    {
      port: config.port,
      env: config.env,
      thingsboard: Boolean(config.thingsboard.apiKey),
      razorpay: Boolean(config.razorpay.keyId),
    },
    'Valve backend listening',
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
