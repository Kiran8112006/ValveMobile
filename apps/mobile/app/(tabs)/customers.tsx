import { useEffect, useState } from 'react';
import {
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Droplets, Plus, Search, Wifi, WifiOff } from 'lucide-react-native';
import { colors, radius, spacing, typography } from '../../constants/theme';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtime } from '../../contexts/RealtimeContext';
import { formatMl } from '../../services/format';
import type { Device, Transaction } from '../../types/domain';

export default function CustomersScreen() {
  const { user, profile } = useAuth();
  const { refresh, devices } = useRealtime();

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'lastLogin' | 'balance'>('name');
  const [sortDesc, setSortDesc] = useState(false);
  const [filterByStatus, setFilterByStatus] = useState<'all' | 'active' | 'suspended'>('all');
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [showingNewCustomer, setShowingNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const filteredDevices = (devices || []).filter((d) => {
    if (filterByStatus === 'active') return d.status === 'online';
    if (filterByStatus === 'suspended') return d.status !== 'online';
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        (d.deviceName || '').toLowerCase().includes(q) ||
        (d.deviceId || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const sortedDevices = [...filteredDevices].sort((a, b) => {
    let aVal: string | number, bVal: string | number;
    if (sortBy === 'name') {
      aVal = (a.deviceName || a.deviceId).toLowerCase();
      bVal = (b.deviceName || b.deviceId).toLowerCase();
      return sortDesc ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
    } else if (sortBy === 'lastLogin') {
      aVal = a.lastHeartbeat ? new Date(a.lastHeartbeat).getTime() : 0;
      bVal = b.lastHeartbeat ? new Date(b.lastHeartbeat).getTime() : 0;
      return sortDesc ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number);
    }
    return 0;
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Customers</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => setShowingNewCustomer(true)}
        >
          <Plus size={16} color="#FFFFFF" />
          <Text style={styles.addButtonText}>Add</Text>
        </TouchableOpacity>
      </View>

      {/* Search and filters */}
      <View style={styles.filterRow}>
        <View style={styles.searchBox}>
          <Search size={16} color={colors.faint} />
          <TextInput
            style={styles.filterInput}
            placeholder="Search by name or ID..."
            placeholderTextColor={colors.faint}
            value={search}
            onChangeText={setSearch}
          />
        </View>
        <View style={styles.filterTabs}>
          <TouchableOpacity
            style={[styles.tabBtn, filterByStatus === 'all' && styles.tabBtnActive]}
            onPress={() => setFilterByStatus('all')}
          >
            <Text style={[styles.tabText, filterByStatus === 'all' && styles.tabTextActive]}>
              All
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, filterByStatus === 'active' && styles.tabBtnActive]}
            onPress={() => setFilterByStatus('active')}
          >
            <Text style={[styles.tabText, filterByStatus === 'active' && styles.tabTextActive]}>
              Active
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, filterByStatus === 'suspended' && styles.tabBtnActive]}
            onPress={() => setFilterByStatus('suspended')}
          >
            <Text style={[styles.tabText, filterByStatus === 'suspended' && styles.tabTextActive]}>
              Offline
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Devices list */}
      <FlatList
        data={sortedDevices}
        keyExtractor={(item) => item.deviceId}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No customers found</Text>
            <Text style={styles.emptySubtitle}>
              {filterByStatus !== 'all' ? 'Try adjusting your filters.' : 'Devices will appear here once connected.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const isOnline = item.status === 'online';
          return (
            <TouchableOpacity
              style={styles.deviceItem}
              onPress={() => setSelectedDevice(item.deviceId)}
            >
              <View style={styles.deviceLeft}>
                <View style={[styles.deviceIconBox, isOnline ? styles.iconOnline : styles.iconOffline]}>
                  {isOnline ? (
                    <Wifi size={18} color={colors.success} />
                  ) : (
                    <WifiOff size={18} color={colors.faint} />
                  )}
                </View>
                <View>
                  <Text style={styles.deviceName}>{item.deviceName || item.deviceId}</Text>
                  <Text style={styles.deviceId}>{item.deviceId}</Text>
                </View>
              </View>
              <View style={styles.deviceRight}>
                <Text style={styles.deviceStatus}>
                  {isOnline ? 'Online' : 'Offline'}
                </Text>
                <Text style={styles.deviceLastSeen}>
                  {item.lastHeartbeat ? new Date(item.lastHeartbeat).toLocaleDateString() : 'Never'}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }}
        contentContainerStyle={{ paddingBottom: 24 }}
      />

      {/* New customer modal */}
      {showingNewCustomer ? (
        <Modal
          visible={showingNewCustomer}
          transparent
          animationType="fade"
          onRequestClose={() => setShowingNewCustomer(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalBody}>
              <Text style={styles.modalTitle}>Add Customer</Text>
              <Text style={styles.modalSubtitle}>Enter customer name or account identifier</Text>
              <TextInput
                value={newCustomerName}
                onChangeText={setNewCustomerName}
                placeholder="Customer name"
                placeholderTextColor={colors.faint}
                style={styles.modalInput}
              />
              <View style={styles.modalActions}>
                <TouchableOpacity
                  onPress={() => setShowingNewCustomer(false)}
                  style={styles.modalBtn}
                >
                  <Text style={styles.modalBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setShowingNewCustomer(false);
                    setNewCustomerName('');
                  }}
                  style={styles.modalBtnPrimary}
                >
                  <Text style={styles.modalBtnPrimaryText}>Create</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: spacing.md,
  },
  title: {
    fontSize: typography.title,
    fontWeight: '700',
    color: colors.ink,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: typography.small,
    fontWeight: '600',
  },
  filterRow: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  filterInput: {
    flex: 1,
    height: 42,
    fontSize: typography.body,
    color: colors.ink,
  },
  filterTabs: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  tabBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  tabBtnActive: {
    backgroundColor: colors.primarySoft,
  },
  tabText: {
    fontSize: typography.small,
    color: colors.muted,
    fontWeight: '500',
  },
  tabTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  emptyState: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    gap: spacing.xs,
  },
  emptyTitle: {
    fontSize: typography.body,
    fontWeight: '600',
    color: colors.ink,
  },
  emptySubtitle: {
    fontSize: typography.small,
    color: colors.muted,
  },
  deviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  deviceLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  deviceIconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconOnline: {
    backgroundColor: colors.successSoft,
  },
  iconOffline: {
    backgroundColor: colors.surfaceMuted,
  },
  deviceName: {
    fontSize: typography.body,
    fontWeight: '600',
    color: colors.ink,
  },
  deviceId: {
    fontSize: typography.tiny,
    color: colors.muted,
  },
  deviceRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  deviceStatus: {
    fontSize: typography.small,
    fontWeight: '600',
    color: colors.ink,
  },
  deviceLastSeen: {
    fontSize: typography.tiny,
    color: colors.muted,
  },
  separator: {
    height: spacing.sm,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  modalBody: {
    width: '100%',
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  modalTitle: {
    fontSize: typography.heading,
    fontWeight: '700',
    color: colors.ink,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: typography.small,
    color: colors.muted,
    textAlign: 'center',
  },
  modalInput: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: typography.body,
    color: colors.ink,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  modalBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  modalBtnText: {
    color: colors.muted,
    fontSize: typography.body,
    fontWeight: '500',
  },
  modalBtnPrimary: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  modalBtnPrimaryText: {
    color: '#FFFFFF',
    fontSize: typography.body,
    fontWeight: '600',
  },
});
