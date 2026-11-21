import { useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { RefreshCw, Signal, Wifi, WifiOff } from 'lucide-react-native';
import { colors, radius, spacing, typography } from '../../constants/theme';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtime } from '../../contexts/RealtimeContext';
import { inr, litres } from '../../services/format';
import type { Device, DispensingSession } from '../../types/domain';

export default function DeviceScreen() {
  const { role } = useAuth();
  const { refresh, devices, recentSessions, socketStatus } = useRealtime();

  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const deviceStats = useMemo(() => {
    if (!devices) return { online: 0, totalAuthorized: 0, totalConsumed: 0 };
    const online = devices.filter((d: Device) => d.status === 'online').length;
    const totalAuthorized = (recentSessions || []).reduce(
      (sum, s) => sum + (s.authorizedMl ?? 0),
      0
    );
    const totalConsumed = (recentSessions || []).reduce(
      (sum, s) => sum + (s.consumedMl ?? 0),
      0
    );
    return { online, totalAuthorized, totalConsumed };
  }, [devices, recentSessions]);

  const activeSession = useMemo(() => {
    if (!selectedDevice?.activeSessionId) return null;
    return (recentSessions || []).find(
      (s) => s.sessionId === selectedDevice.activeSessionId
    );
  }, [selectedDevice, recentSessions]);

  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingTop: 10 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Device Status</Text>
        <TouchableOpacity style={styles.actions} onPress={handleRefresh}>
          <RefreshCw size={16} color={colors.primary} />
          <Text style={styles.refresh}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {/* Connection status */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Connection</Text>
        <Text style={styles.statusLabel}>
          {socketStatus === 'open' ? 'WebSocket live' : 'Disconnected'}
        </Text>
      </View>

      {/* Device list */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>All Paired Devices</Text>
        {devices && devices.length > 0 ? (
          <View style={styles.list}>
            {devices.map((device) => {
              const isSelected = selectedDevice?.deviceId === device.deviceId;
              const isOnline = device.status === 'online';
              return (
                <TouchableOpacity
                  key={device.deviceId}
                  style={[styles.deviceItem, isSelected && styles.selectedDevice]}
                  onPress={() => setSelectedDevice(device)}
                >
                  <Text style={styles.deviceLabel}>
                    {device.deviceName || device.deviceId} • {isOnline ? 'Online' : 'Offline'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <Text style={styles.emptyState}>No devices found</Text>
        )}
      </View>

      {/* Selected device details */}
      {selectedDevice ? (
        <View style={[styles.section, { marginTop: 20 }]}>
          <Text style={styles.sectionTitle}>Device Details</Text>
          <View style={styles.detailsGrid}>
            <View style={styles.detailBox}>
              <Text style={styles.detailLabel}>Device ID</Text>
              <Text style={styles.detailValue}>{selectedDevice.deviceId}</Text>
            </View>
            <View style={styles.detailBox}>
              <Text style={styles.detailLabel}>Status</Text>
              <Text
                style={[
                  styles.detailValue,
                  { color: selectedDevice.status === 'online' ? colors.success : colors.danger },
                ]}
              >
                {selectedDevice.status}
              </Text>
            </View>
            <View style={styles.detailBox}>
              <Text style={styles.detailLabel}>Valve State</Text>
              <Text style={styles.detailValue}>{selectedDevice.valveState}</Text>
            </View>
            <View style={styles.detailBox}>
              <Text style={styles.detailLabel}>Relay State</Text>
              <Text style={styles.detailValue}>{selectedDevice.relayState}</Text>
            </View>
            <View style={styles.detailBox}>
              <Text style={styles.detailLabel}>RSSI</Text>
              <Text style={styles.detailValue}>
                {selectedDevice.wifiRssi != null ? `${selectedDevice.wifiRssi} dBm` : '—'}
              </Text>
            </View>
            <View style={styles.detailBox}>
              <Text style={styles.detailLabel}>Firmware</Text>
              <Text style={styles.detailValue}>
                {selectedDevice.firmwareVersion || '—'}
              </Text>
            </View>
            <View style={styles.detailBox}>
              <Text style={styles.detailLabel}>Assigned User</Text>
              <Text style={styles.detailValue}>
                {selectedDevice.assignedUserId || 'None'}
              </Text>
            </View>
          </View>

          {/* Active Session info */}
          {activeSession ? (
            <View style={styles.detailsCard}>
              <Text style={styles.sectionTitle}>Active Session</Text>
              <View style={styles.sessionInfo}>
                <Text style={styles.infoLabel}>Session ID</Text>
                <Text style={styles.infoValue}>{activeSession.sessionId}</Text>
              </View>
              <View style={styles.sessionInfo}>
                <Text style={styles.infoLabel}>Authorized</Text>
                <Text style={styles.infoValue}>{litres(activeSession.authorizedMl)} L</Text>
              </View>
              <View style={styles.sessionInfo}>
                <Text style={styles.infoLabel}>Consumed</Text>
                <Text style={styles.infoValue}>{litres(activeSession.consumedMl)} L</Text>
              </View>
              <View style={styles.sessionInfo}>
                <Text style={styles.infoLabel}>Remaining</Text>
                <Text style={styles.infoValue}>
                  {litres(Math.max(activeSession.remainingAuthorizedMl, 0))} L
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Summary at bottom */}
      {devices && devices.length > 0 ? (
        <View style={[styles.section, { marginTop: 24 }]}>
          <Text style={styles.sectionTitle}>Summary</Text>
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{deviceStats.online}</Text>
              <Text style={styles.statLabel}>Online</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{litres(deviceStats.totalConsumed)} L</Text>
              <Text style={styles.statLabel}>Total consumed</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{litres(deviceStats.totalAuthorized)} L</Text>
              <Text style={styles.statLabel}>Total authorized</Text>
            </View>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1F2937',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  refresh: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '500',
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
    color: '#1F2937',
    marginBottom: 8,
  },
  statusLabel: {
    fontSize: 14,
    color: '#6B7280',
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
    marginBottom: 12,
  },
  list: { marginTop: 4 },
  deviceItem: {
    padding: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
    borderRadius: 6,
  },
  deviceLabel: {
    fontSize: 14,
    color: '#1F2937',
  },
  emptyState: {
    color: '#9CA3AF',
    fontSize: 14,
    paddingVertical: 12,
    textAlign: 'center',
  },
  selectedDevice: {
    backgroundColor: '#E0F2FE',
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  detailBox: {
    flex: 1,
    minWidth: 120,
  },
  detailLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  detailsCard: {
    backgroundColor: '#F9FAFB',
    padding: 14,
    borderRadius: 8,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  sessionInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  infoLabel: {
    fontSize: 12,
    color: '#6B7280',
    width: 80,
  },
  infoValue: {
    fontSize: 14,
    color: '#111827',
    flex: 1,
    textAlign: 'right',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 12,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
  },
  statLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
});
