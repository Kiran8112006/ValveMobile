import { useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtime } from '../../contexts/RealtimeContext';
import { inr, litres } from '../../services/format';
import type { Device, DispensingSession, Transaction } from '../../types/domain';

export function AdminOverviewScreen() {
  const { role } = useAuth();
  if (role !== 'admin') return null;

  const { balanceMl, refresh, devices, recentTransactions, recentSessions, pricing } = useRealtime();
  const [refreshing, setRefreshing] = useState(false);

  const totalEstimatedDispensedMl = useMemo(() => {
    if (!recentTransactions) return 0;
    return recentTransactions.reduce((sum, t) => sum + (t.deltaMl ?? 0), 0);
  }, [recentTransactions]);

  const onlineDevices = useMemo(() => {
    if (!devices) return 0;
    return devices.filter((d: Device) => d.status === 'online').length;
  }, [devices]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const renderPricing = () => {
    if (!pricing || !pricing.configured) return null;
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Price per litre</Text>
        <Text style={styles.price}>{inr(pricing.pricePerLitrePaise)} / litre</Text>
        <Text style={styles.hint}>
          {pricing.mode === 'test' ? 'Razorpay Test Mode' : 'Razorpay Live Mode'}
        </Text>
      </View>
    );
  };

  const renderBalance = () => {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Server balance</Text>
        <Text style={styles.balanceValue}>{litres(balanceMl ?? 0)} L</Text>
        <Text style={styles.balanceHint}>Available water (estimated)</Text>
      </View>
    );
  };

  const renderTotalDispensed = () => {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Total dispensed</Text>
        <Text style={styles.balanceValue}>{litres(totalEstimatedDispensedMl)} L</Text>
        <Text style={styles.balanceHint}>Estimated from all sessions</Text>
      </View>
    );
  };

  const renderDevices = () => {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Devices</Text>
        <Text style={styles.balanceValue}>
          {onlineDevices} online · {devices?.length ?? 0} total
        </Text>
        <Text style={styles.balanceHint}>from realtime list</Text>
      </View>
    );
  };

  const renderRecentSessions = () => {
    if (!recentSessions?.length) return null;
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Recent sessions</Text>
        <View style={styles.list}>
          {recentSessions.slice(0, 5).map((session: DispensingSession, i: number) => (
            <View key={session.sessionId || i} style={styles.listItem}>
              <Text style={styles.listItemText}>{session.authorizedMl} mL authorized</Text>
              <Text style={styles.listItemDetail}>
                {session.stopReason || 'stopped'} · {session.startedAt}
              </Text>
            </View>
          ))}
        </View>
      </View>
    );
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingTop: 10 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Overview</Text>
      </View>

      {renderPricing()}
      {renderBalance()}
      {renderTotalDispensed()}
      {renderDevices()}
      {renderRecentSessions()}
    </ScrollView>
  );
}

export default AdminOverviewScreen;

const styles = StyleSheet.create({
  section: {
    backgroundColor: '#F3F4F6',
    padding: 12,
    marginBottom: 16,
    borderRadius: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 12,
  },
  card: {
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
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
  },
  price: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    marginTop: 4,
  },
  hint: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  balanceValue: {
    fontSize: 32,
    fontWeight: '700',
    color: '#111827',
    marginTop: 4,
  },
  balanceHint: {
    fontSize: 12,
    color: '#6B7280',
  },
  list: { marginTop: 8 },
  listItem: {
    padding: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  listItemText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1F2937',
  },
  listItemDetail: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
});
