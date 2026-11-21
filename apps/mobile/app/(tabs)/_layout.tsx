import { Redirect, Tabs } from 'expo-router';
import { Cpu, History, House, Settings, User, Users, Wallet } from 'lucide-react-native';
import { ActivityIndicator, Text, View } from 'react-native';
import { AppButton, LoadingView } from '../../components/ui';
import { colors } from '../../constants/theme';
import { useAuth } from '../../contexts/AuthContext';

export default function TabsLayout() {
  const { initializing, user, profile, profileError, role, signOut, refreshProfile } = useAuth();

  if (initializing) return <LoadingView label="Starting Valve…" />;
  if (!user) return <Redirect href="/(auth)/login" />;
  if (!profile) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
        {profileError ? (
          <>
            <Text style={{ fontSize: 16, color: colors.ink, textAlign: 'center' }}>{profileError}</Text>
            <AppButton label="Try again" onPress={() => void refreshProfile()} />
            <AppButton label="Sign out" variant="secondary" onPress={() => void signOut()} />
          </>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </View>
    );
  }

  const isAdmin = role === 'admin';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 62,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: isAdmin ? 'Overview' : 'Home',
          tabBarIcon: ({ color, size }) => <House color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="recharge"
        options={{
          title: 'Recharge',
          href: isAdmin ? null : undefined,
          tabBarIcon: ({ color, size }) => <Wallet color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, size }) => <History color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="customers"
        options={{
          title: 'Customers',
          href: isAdmin ? undefined : null,
          tabBarIcon: ({ color, size }) => <Users color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="device"
        options={{
          title: 'Device',
          href: isAdmin ? undefined : null,
          tabBarIcon: ({ color, size }) => <Cpu color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          href: isAdmin ? null : undefined,
          tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          href: isAdmin ? undefined : null,
          tabBarIcon: ({ color, size }) => <Settings color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
