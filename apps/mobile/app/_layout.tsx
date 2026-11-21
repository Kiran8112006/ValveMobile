import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '../constants/theme';
import { AuthProvider } from '../contexts/AuthContext';
import { RealtimeProvider } from '../contexts/RealtimeContext';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <RealtimeProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
              headerStyle: { backgroundColor: colors.background },
              headerTintColor: colors.ink,
              headerTitleStyle: { fontWeight: '600' },
              headerShadowVisible: false,
            }}
          >
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="connect-device"
              options={{ headerShown: true, title: 'Connect device', presentation: 'modal' }}
            />
            <Stack.Screen
              name="customer/[uid]"
              options={{ headerShown: true, title: 'Customer' }}
            />
          </Stack>
        </RealtimeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
