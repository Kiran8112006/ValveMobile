import { useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtime } from '../../contexts/RealtimeContext';
import { inr, litres } from '../../services/format';
import type { Device, DispensingSession, Transaction } from '../../types/domain';

const DATE_FILTERS: Array<{ label: string; value: 'all' | 'today' | 'this-week' | 'this-month' }> = [
  { label: 'All', value: 'all' },
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'this-week' },
  { label: 'This Month', value: 'this-month' },
];

export function AdminHistoryScreen() {
  const { role } = useAuth();
  if (role !== 'admin') return null;

  const { refresh, recentSessions, devices, recentTransactions } = useRealtime();
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'this-week' | 'this-month'>('all');
  const [refreshing, setRefreshing] = useState(false);

  const filteredSessions = useMemo(() => {
    if (!recentSessions) return [];
    return recentSessions.filter((session: DispensingSession) => {
      if (dateFilter === 'all') return true;
      if (!session.startedAt) return false;
      const date = new Date(session.startedAt);
      const now = new Date();
      if (dateFilter === 'today') {
        return date.toDateString() === now.toDateString();
      }
      if (dateFilter === 'this-week') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return date >= weekAgo;
      }
      if (dateFilter === 'this-month') {
        return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
      }
      return true;
    });
  }, [recentSessions, dateFilter]);

  const onlineDevices = useMemo(() => {
    if (!devices) return 0;
    return devices.filter((d: Device) => d.status === 'online').length;
  }, [devices]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingTop: 10 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
        <View style={styles.filters}>
          {DATE_FILTERS.map((item) => (
            <TouchableOpacity
              key={item.value}
              style={[styles.filterButton, dateFilter === item.value && styles.filterButtonActive]}
              onPress={() => setDateFilter(item.value)}
            >
              <Text
                style={[
                  styles.filterButtonText,
                  dateFilter === item.value && styles.filterButtonTextActive,
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Sessions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Dispensing Sessions</Text>
        {filteredSessions.length === 0 ? (
          <Text style={styles.emptyState}>No sessions found</Text>
        ) : (
          <View style={styles.list}>
            {filteredSessions.map((session: DispensingSession, i: number) => (
              <View key={session.sessionId || i} style={styles.sessionItem}>
                <View style={styles.sessionHeader}>
                  <Text style={styles.sessionId}>Session {session.sessionId || i + 1}</Text>
                  <Text style={styles.sessionStatus}>
                    {session.status}: {session.authorizedMl} mL authorized, {session.consumedMl} mL consumed
                  </Text>
                </View>
                <View style={styles.sessionDetails}>
                  <Text style={styles.detailLabel}>Start:</Text>
                  <Text style={styles.detailValue}>
                    {session.startedAt ? new Date(session.startedAt).toLocaleString() : 'N/A'}
                  </Text>
                  <Text style={styles.detailLabel}>Stop:</Text>
                  <Text style={styles.detailValue}>
                    {session.stoppedAt ? new Date(session.stoppedAt).toLocaleString() : 'N/A'}
                  </Text>
                  <Text style={styles.detailLabel}>Reason:</Text>
                  <Text style={styles.detailValue}>{session.stopReason || 'completed'}</Text>
                  <Text style={styles.detailLabel}>Remaining:</Text>
                  <Text style={styles.detailValue}>{session.remainingAuthorizedMl} mL</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Transactions */}
      <View style={[styles.section, { marginTop: 20 }]}>
        <Text style={styles.sectionTitle}>Recent Transactions</Text>
        {recentTransactions?.length === 0 ? (
          <Text style={styles.emptyState}>No transactions found</Text>
        ) : (
          <View style={styles.list}>
            {recentTransactions?.slice(0, 20).map((tx: Transaction, i: number) => (
              <View key={tx.id || tx.transactionId || i} style={styles.transactionItem}>
                <Text style={styles.transactionType}>
                  {tx.type}: {litres(tx.deltaMl)} L
                </Text>
                <Text style={styles.transactionDetails}>
                  Balance: {litres(tx.balanceAfterMl)} L | {tx.createdAt}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Devices */}
      <View style={[styles.section, { marginTop: 20 }]}>
        <Text style={styles.sectionTitle}>Devices</Text>
        {devices && devices.length > 0 ? (
          <View style={styles.list}>
            {devices.map((device: Device, i: number) => (
              <View key={device.deviceId || i} style={styles.deviceItem}>
                <Text style={styles.deviceId}>{device.deviceId || 'unknown'}</Text>
                <Text style={styles.deviceStatus}>Status: {device.status}</Text>
                <Text style={styles.deviceDetail}>
                  Valve: {device.valveState} · Relay: {device.relayState}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.emptyState}>No devices paired</Text>
        )}
      </View>

      {/* Summary stats at bottom */}
      <View style={[styles.section, { marginTop: 20 }]}>
        <Text style={styles.sectionTitle}>Summary</Text>
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{filteredSessions.length}</Text>
            <Text style={styles.statLabel}>Sessions</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{onlineDevices} online</Text>
            <Text style={styles.statLabel}>Devices</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

export default AdminHistoryScreen;

const styles = StyleSheet.create({
  header: {
    marginBottom: 20,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
  },
  filters: {
    flexDirection: 'row',
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
  },
  filterButtonActive: {
    backgroundColor: '#0B6E75',
  },
  filterButtonText: {
    fontSize: 12,
    color: '#4B5563',
    fontWeight: '500',
  },
  filterButtonTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
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
  list: {
    gap: 12,
  },
  sessionItem: {
    padding: 12,
    backgroundColor: '#F9FAFB',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  sessionHeader: {
    marginBottom: 8,
  },
  sessionId: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  sessionStatus: {
    fontSize: 12,
    color: '#4B5563',
    marginTop: 2,
  },
  sessionDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  detailLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  detailValue: {
    fontSize: 12,
    color: '#111827',
    fontWeight: '500',
    marginRight: 8,
  },
  transactionItem: {
    padding: 10,
    backgroundColor: '#F9FAFB',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  transactionType: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  transactionDetails: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  deviceItem: {
    padding: 10,
    backgroundColor: '#F9FAFB',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  deviceId: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  deviceStatus: {
    fontSize: 12,
    color: '#4B5563',
    marginTop: 2,
  },
  deviceDetail: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  emptyState: {
    color: '#9CA3AF',
    fontSize: 14,
    paddingVertical: 12,
    textAlign: 'center',
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
});
