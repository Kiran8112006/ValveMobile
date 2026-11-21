import type { AppConfig } from '../config/env.js';
import type { PaymentProvider, RealtimeHub, ThingsBoardClient, TokenVerifier } from './deps.js';
import type { Store } from '../store/types.js';

export interface AppDeps {
  config: AppConfig;
  store: Store;
  verifier: TokenVerifier;
  thingsboard: ThingsBoardClient;
  payments: PaymentProvider;
  hub: RealtimeHub;
  now: () => Date;
}

export type BuildAppDeps = AppDeps;
