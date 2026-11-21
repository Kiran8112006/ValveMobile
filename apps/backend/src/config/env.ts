import { z } from 'zod';

/**
 * Server configuration. Secrets are read only from the environment and never
 * returned to clients or written to logs.
 */
export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  logLevel: string;
  corsOrigins: string[];
  firebase: {
    projectId: string;
    serviceAccountPath: string | null;
  };
  thingsboard: {
    baseUrl: string;
    apiKey: string | null;
    webhookSecret: string;
    offlineThresholdMs: number;
    rpcTimeoutMs: number;
  };
  razorpay: {
    keyId: string | null;
    keySecret: string | null;
    webhookSecret: string | null;
    mode: 'test' | 'live';
  };
  pairing: {
    tokenSecret: string;
    challengeTtlMs: number;
  };
  valve: {
    openDurationMs: number;
    closedGapMs: number;
    maxAuthorizedMlPerSession: number;
    minAuthorizedMl: number;
  };
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGINS: z.string().default(''),
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_ADMIN_SERVICE_ACCOUNT_PATH: z.string().default(''),
  THINGSBOARD_BASE_URL: z.string().url().default('https://thingsboard.cloud'),
  THINGSBOARD_API_KEY: z.string().default(''),
  THINGSBOARD_WEBHOOK_SECRET: z.string().min(16),
  THINGSBOARD_DEVICE_OFFLINE_THRESHOLD_MS: z.coerce.number().int().positive().default(45000),
  THINGSBOARD_RPC_TIMEOUT_MS: z.coerce.number().int().min(500).max(20000).default(5000),
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),
  RAZORPAY_MODE: z.enum(['test', 'live']).default('test'),
  PAIRING_TOKEN_SECRET: z.string().min(16),
  VALVE_OPEN_DURATION_MS: z.coerce.number().int().min(100).max(10000).default(1000),
  CYCLE_CLOSED_GAP_MS: z.coerce.number().int().min(50).max(10000).default(100),
  MAX_AUTHORIZED_ML_PER_SESSION: z.coerce.number().int().positive().default(100000),
  MIN_AUTHORIZED_ML: z.coerce.number().int().positive().default(100),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid server configuration: ${issues}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    corsOrigins: e.CORS_ORIGINS.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    firebase: {
      projectId: e.FIREBASE_PROJECT_ID,
      serviceAccountPath: e.FIREBASE_ADMIN_SERVICE_ACCOUNT_PATH || null,
    },
    thingsboard: {
      baseUrl: e.THINGSBOARD_BASE_URL.replace(/\/+$/, ''),
      apiKey: e.THINGSBOARD_API_KEY || null,
      webhookSecret: e.THINGSBOARD_WEBHOOK_SECRET,
      offlineThresholdMs: e.THINGSBOARD_DEVICE_OFFLINE_THRESHOLD_MS,
      rpcTimeoutMs: e.THINGSBOARD_RPC_TIMEOUT_MS,
    },
    razorpay: {
      keyId: e.RAZORPAY_KEY_ID || null,
      keySecret: e.RAZORPAY_KEY_SECRET || null,
      webhookSecret: e.RAZORPAY_WEBHOOK_SECRET || null,
      mode: e.RAZORPAY_MODE,
    },
    pairing: {
      tokenSecret: e.PAIRING_TOKEN_SECRET,
      challengeTtlMs: 10 * 60 * 1000,
    },
    valve: {
      openDurationMs: e.VALVE_OPEN_DURATION_MS,
      closedGapMs: e.CYCLE_CLOSED_GAP_MS,
      maxAuthorizedMlPerSession: e.MAX_AUTHORIZED_ML_PER_SESSION,
      minAuthorizedMl: e.MIN_AUTHORIZED_ML,
    },
  };
}

export function isRazorpayConfigured(config: AppConfig): boolean {
  return Boolean(config.razorpay.keyId && config.razorpay.keySecret);
}
