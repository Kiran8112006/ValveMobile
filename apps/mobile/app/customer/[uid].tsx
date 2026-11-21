import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, radius, spacing, typography } from '../../constants/theme';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtime } from '../../contexts/RealtimeContext';
import { inr, litres } from '../../services/format';

export default function CustomerScreen() {
  const { uid } = useLocalSearchParams<{ uid: string }>();
  const { role, profile, signOut } = useAuth();

  if (role === 'admin') {
    return null;
  }

  if (role !== 'customer' || !uid || profile?.uid !== uid) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <Text style={styles.error}>Access denied: invalid customer or UID mismatch</Text>
      </View>
    );
  }

  const { refresh, devices, recentSessions, recentTransactions } = useRealtime();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const stats = useMemo(() => {
    const sessions = recentSessions?.length ?? 0;
    const totalConsumed = recentSessions?.reduce(
      (sum, s) => sum + (s.consumedMl ?? 0),
      0
    ) ?? 0;
    const balance = profile?.balanceMl ?? 0;
    return {
      sessions,
      consumedLitres: litres(totalConsumed),
      balanceLitres: litres(balance),
    };
  }, [recentSessions, profile]);

  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingTop: 10 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>My Account</Text>
        <Text style={styles.uidLabel}>UID: {uid}</Text>
      </View>

      {/* Balance */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Water Balance</Text>
        <Text style={styles.balanceValue}>{stats.balanceLitres} L</Text>
        <Text style={styles.balanceHint}>Available water</Text>
      </View>

      {/* Usage summary */}
      <View style={[styles.section, { marginTop: 16 }]}>
        <Text style={styles.sectionTitle}>Usage Summary</Text>
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{stats.sessions}</Text>
            <Text style={styles.statLabel}>Sessions</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{stats.consumedLitres} L</Text>
            <Text style={styles.statLabel}>Total consumed</Text>
          </View>
        </View>
      </View>

      {/* Log out */}
      <View style={[styles.section, { marginTop: 30 }]}>
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
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  uidLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 8,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
  },
  balanceValue: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
  },
  balanceHint: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  section: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  statBox: {
    flex: 1,
    padding: 12,
    backgroundColor: '#F9FAFB',
    borderRadius: 6,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
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
  error: {
    color: colors.danger,
    fontSize: 16,
    textAlign: 'center',
  },
});
