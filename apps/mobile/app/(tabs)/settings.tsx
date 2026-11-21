import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, radius, spacing, typography } from '../../constants/theme';
import { useAuth } from '../../contexts/AuthContext';
import { apiRequest } from '../../services/api';

export default function SettingsScreen() {
  const { signOut } = useAuth();
  const [autoReconnect, setAutoReconnect] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [supportMode, setSupportMode] = useState(false);
  const [changePassword, setChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [serverTime, setServerTime] = useState<string>('—');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchServerTime = async () => {
    try {
      setLoading(true);
      const res = await apiRequest<{ serverTime: string }>('/api/system/time');
      setServerTime(res.serverTime || new Date().toISOString());
    } catch {
      setServerTime(new Date().toISOString());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchServerTime();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchServerTime();
    setRefreshing(false);
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingTop: 10 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      {/* Realtime settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Realtime Settings</Text>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Auto-reconnect</Text>
          <Switch
            value={autoReconnect}
            onValueChange={setAutoReconnect}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Notifications</Text>
          <Switch
            value={notifications}
            onValueChange={setNotifications}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>
      </View>

      {/* Server info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Server Time</Text>
        <Text style={styles.value}>{loading ? 'Loading server time…' : serverTime}</Text>
      </View>

      {/* Support mode */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Support Mode</Text>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Debug logging for troubleshooting</Text>
          <Switch
            value={supportMode}
            onValueChange={setSupportMode}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>
        <Text style={styles.supportNote}>
          {supportMode ? 'Debug logs enabled' : 'Debug logs disabled'}
        </Text>
      </View>

      {/* Log out */}
      <View style={[styles.section, { marginTop: 24 }]}>
        <TouchableOpacity
          onPress={() =>
            Alert.alert('Log out', 'Are you sure you want to log out?', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Log out',
                style: 'destructive',
                onPress: () => void signOut(),
              },
            ])
          }
          style={styles.logoutButton}
        >
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 40,
    paddingBottom: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1F2937',
  },
  section: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    marginBottom: 12,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 16,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  settingLabel: {
    fontSize: 14,
    color: '#374151',
    flex: 1,
  },
  logoutButton: {
    backgroundColor: colors.danger,
    padding: 12,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  logoutText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  value: {
    fontFamily: 'monospace',
    color: '#111827',
    fontSize: 14,
  },
  supportNote: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
});
