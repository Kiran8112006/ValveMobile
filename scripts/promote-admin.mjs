// Admin Promotion Script
// Promotes a user to admin by adding the 'admin' custom claim AND updating Firestore.
// Run with: node scripts/promote-admin.mjs <uid-or-email>

import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require = createRequire(path.resolve(__dirname, '../apps/backend/package.json'));
const dotenv = require('dotenv');
const admin = require('firebase-admin');

// Load env from apps/backend/.env
dotenv.config({ path: path.resolve(__dirname, '../apps/backend/.env') });

const serviceAccountPath =
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY ||
  path.resolve(__dirname, '../apps/backend/secrets/serviceAccountKey.json');

if (!fs.existsSync(serviceAccountPath)) {
  console.error(`Error: Service account file not found at ${serviceAccountPath}`);
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id,
  });
}

const auth = admin.auth();
const db = admin.firestore();

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/promote-admin.mjs <uid-or-email>');
  process.exit(1);
}

async function promote() {
  let userRecord;
  try {
    if (target.includes('@')) {
      userRecord = await auth.getUserByEmail(target);
    } else {
      userRecord = await auth.getUser(target);
    }
  } catch (err) {
    console.error(`✗ User not found in Firebase Auth: ${err.message}`);
    process.exit(1);
  }

  const uid = userRecord.uid;
  console.log(`Found user: ${userRecord.email || uid} (UID: ${uid})`);

  // 1. Set admin custom claim in Firebase Auth
  const currentClaims = userRecord.customClaims || {};
  await auth.setCustomUserClaims(uid, {
    ...currentClaims,
    admin: true,
  });
  console.log('✓ Firebase Auth custom claims updated: { admin: true }');

  // 2. Update role in Firestore 'users' collection
  const userRef = db.collection('users').doc(uid);
  const userDoc = await userRef.get();
  if (userDoc.exists) {
    await userRef.update({ role: 'admin', updatedAt: new Date() });
    console.log('✓ Firestore user document updated: role = "admin"');
  } else {
    await userRef.set({
      uid,
      email: userRecord.email || '',
      fullName: userRecord.displayName || userRecord.email?.split('@')[0] || 'Admin',
      role: 'admin',
      status: 'active',
      balanceMl: 50000,
      totalEstimatedDispensedMl: 0,
      deviceId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log('✓ Created Firestore user document with role = "admin" and 50 L starter balance');
  }

  console.log(`\n🎉 Success! User ${userRecord.email || uid} is now an Administrator.`);
  process.exit(0);
}

promote().catch((err) => {
  console.error('✗ Failed to promote user:', err);
  process.exit(1);
});
