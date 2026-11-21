import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { colors } from '../constants/theme';
import { useAuth } from '../contexts/AuthContext';

export default function Index() {
  const { initializing, user } = useAuth();
  if (initializing) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  return <Redirect href={user ? '/(tabs)' : '/(auth)/login'} />;
}
