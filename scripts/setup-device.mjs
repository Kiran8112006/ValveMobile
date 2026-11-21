// Setup / Register Device Script
// Directly registers the ThingsBoard device and assigns it to a user if requested.
// Run with: node scripts/setup-device.mjs [user-email-or-uid]

import crypto from 'crypto';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require = createRequire(path.resolve(__dirname, '../apps/backend/package.json'));
const dotenv = require('dotenv');
const admin = require('firebase-admin');

dotenv.config({ path: path.resolve(__dirname, '../apps/backend/.env') });

const serviceAccountPath =
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY ||
  path.resolve(__dirname, '../apps/backend/secrets/serviceAccountKey.json');

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id,
  });
}

const db = admin.firestore();
const auth = admin.auth();

const THINGSBOARD_UUID = '9933f590-d818-11f1-856c-272ac0c064f4';
const DEVICE_ID = 'valve-esp8266-001';

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

async function setup() {
  const targetUser = process.argv[2];
  let assignedUid = null;

  if (targetUser) {
    try {
      const u = targetUser.includes('@')
        ? await auth.getUserByEmail(targetUser)
        : await auth.getUser(targetUser);
      assignedUid = u.uid;
      console.log(`Assigning device to user: ${u.email || u.uid} (${assignedUid})`);
    } catch (err) {
      console.warn(`Warning: Could not find user "${targetUser}": ${err.message}`);
    }
  }

  const now = new Date();
  const deviceRef = db.collection('devices').doc(DEVICE_ID);
  const existing = await deviceRef.get();

  const deviceData = {
    deviceId: DEVICE_ID,
    thingsBoardDeviceUuid: THINGSBOARD_UUID,
    deviceName: 'Main Valve (ESP8266)',
    hardwareModel: 'ESP8266 NodeMCU',
    assignedUserId: assignedUid || existing.data()?.assignedUserId || null,
    status: 'online',
    valveState: 'closed',
    lastHeartbeat: now,
    firmwareVersion: '1.0.0',
    relayState: 'off',
    activeSessionId: null,
    wifiRssi: -50,
    claimCodeHash: sha256Hex('123456'),
    claimUsedAt: assignedUid ? now : null,
    updatedAt: now,
  };

  if (!existing.exists) {
    deviceData.createdAt = now;
  }

  await deviceRef.set(deviceData, { merge: true });
  console.log(`✓ Device "${DEVICE_ID}" (ThingsBoard UUID: ${THINGSBOARD_UUID}) configured in Firestore.`);

  if (assignedUid) {
    const userRef = db.collection('users').doc(assignedUid);
    await userRef.set(
      {
        deviceId: DEVICE_ID,
        balanceMl: 50000, // 50 Litres starter balance
        updatedAt: now,
      },
      { merge: true }
    );
    console.log(`✓ User ${assignedUid} assigned to device ${DEVICE_ID} with 50 L balance!`);
  }

  console.log('\n✅ Device setup complete.');
  process.exit(0);
}

setup().catch((err) => {
  console.error('✗ Device setup failed:', err);
  process.exit(1);
});
