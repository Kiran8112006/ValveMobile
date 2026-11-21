import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
  type App,
} from 'firebase-admin/app';
import type { AppConfig } from '../config/env.js';

/**
 * Firebase Admin initialization.
 *
 * Local development: set FIREBASE_ADMIN_SERVICE_ACCOUNT_PATH to a JSON key kept
 * outside Git (apps/backend/secrets/serviceAccountKey.json).
 * Cloud Run: omit it and use the attached service identity via Application
 * Default Credentials.
 */
export function initFirebaseAdmin(config: AppConfig): App {
  if (getApps().length > 0) return getApp();

  if (config.firebase.serviceAccountPath) {
    const path = resolve(config.firebase.serviceAccountPath);
    const raw = readFileSync(path, 'utf8');
    const credentials = JSON.parse(raw) as Record<string, string>;
    if (
      typeof credentials.project_id !== 'string' ||
      typeof credentials.client_email !== 'string' ||
      typeof credentials.private_key !== 'string'
    ) {
      throw new Error(
        `Service account file at ${path} is missing project_id, client_email or private_key.`,
      );
    }
    return initializeApp({
      credential: cert({
        projectId: credentials.project_id,
        clientEmail: credentials.client_email,
        privateKey: credentials.private_key,
      }),
      projectId: config.firebase.projectId,
    });
  }

  return initializeApp({
    credential: applicationDefault(),
    projectId: config.firebase.projectId,
  });
}
