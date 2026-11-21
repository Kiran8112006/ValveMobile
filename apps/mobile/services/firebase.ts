import { createAsyncStorage } from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getReactNativePersistence, initializeAuth } from '@firebase/auth';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
};

export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);

export const app: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

/**
 * React Native has no localStorage, so Auth is initialized explicitly with an
 * AsyncStorage-backed persistence. This keeps users signed in across restarts
 * and works in a development build (Expo Go is not supported).
 */
const storage = createAsyncStorage('valve-auth');

export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(storage),
});
