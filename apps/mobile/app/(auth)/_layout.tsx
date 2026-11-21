import { Redirect, Stack } from 'expo-router';
import { LoadingView } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';

export default function AuthLayout() {
  const { initializing, user } = useAuth();
  if (initializing) return <LoadingView label="Starting Valve…" />;
  if (user) return <Redirect href="/(tabs)" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
