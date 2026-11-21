/**
 * Firebase's React Native auth build exports getReactNativePersistence, but the
 * wrapper package's `exports` map does not expose it to TypeScript. Metro's
 * `react-native` export condition resolves the RN build at runtime; this
 * augmentation supplies the missing type.
 */
import type { Persistence, ReactNativeAsyncStorage } from '@firebase/auth';

declare module '@firebase/auth' {
  export function getReactNativePersistence(storage: ReactNativeAsyncStorage): Persistence;
}
