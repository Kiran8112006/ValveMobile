import { router } from 'expo-router';
import {
  AlertTriangle,
  Droplets,
  History,
  PlugZap,
  Power,
  Radio,
  Wifi,
  WifiOff,
} from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../../constants/theme';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtime } from '../../contexts/RealtimeContext';
import { useLiveEstimate } from '../../hooks/useLiveEstimate';
import { apiRequest, errorMessage } from '../../services/api';
import { dateTime, litres, relative } from '../../services/format';
import {
  checkDirectDevice,
  DirectStatus,
  startDirectValve,
  stopDirectValve,
  topupDirectBalance,
} from '../../services/localValve';
import type { DispensingSession, Transaction } from '../../types/domain';
import { AppButton, Card, KeyValue, Notice, Pill, Screen, SectionTitle, styles as ui } from '../ui';

const UNRESOLVED = ['pending', 'active', 'stopping', 'reconciling'];

export function HomeScreen() {
  const { profile, refreshProfile } = useAuth();
  const {
    balanceMl,
    totalEstimatedDispensedMl,
    session,
    device,
    lastConfirmedAt,
    socketStatus,
    refresh,
    setSession,
  } = useRealtime();
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Direct ESP8266 SoftAP State
  const [directStatus, setDirectStatus] = useState<DirectStatus | null>(null);
  const [isDirectMode, setIsDirectMode] = useState(false);
  const [directTopupBusy, setDirectTopupBusy] = useState(false);

  // Poll direct ESP8266 Wi-Fi
  useEffect(() => {
    let active = true;
    const probe = async () => {
      const status = await checkDirectDevice();
      if (!active) return;
      if (status) {
        setIsDirectMode(true);
        setDirectStatus(status);
      } else {
        setIsDirectMode(false);
        setDirectStatus(null);
      }
    };
    void probe();
    const interval = setInterval(probe, isDirectMode && directStatus?.sessionActive ? 1000 : 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isDirectMode, directStatus?.sessionActive]);

  const effectiveBalance = isDirectMode && directStatus ? directStatus.balanceMl : (balanceMl ?? profile?.balanceMl ?? 0);
  const totalDispensed = isDirectMode && directStatus ? directStatus.totalDispensedMl : (totalEstimatedDispensedMl ?? profile?.totalEstimatedDispensedMl ?? 0);
  const liveMl = useLiveEstimate(session, device, lastConfirmedAt);
  const unresolved = Boolean(session && UNRESOLVED.includes(session.status));
  const deviceOnline = device?.status === 'online';
  const directDispensing = Boolean(isDirectMode && directStatus && (directStatus.valveState === 'on' || directStatus.sessionActive));
  const valveOpen = isDirectMode ? directDispensing : (device?.valveState === 'opening' && unresolved);

  const loadRecent = async () => {
    try {
      const data = await apiRequest<{ transactions: Transaction[] }>(
        '/api/customer/transactions?limit=20',
      );
      setRecent(data.transactions.filter((entry) => entry.type === 'consumption').slice(0, 4));
    } catch {
      /* recent list is non-critical */
    }
  };

  useEffect(() => {
    void loadRecent();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    if (isDirectMode) {
      const updated = await checkDirectDevice();
      if (updated) setDirectStatus(updated);
    }
    await Promise.all([refresh(), loadRecent(), refreshProfile()]);
    setRefreshing(false);
  };

  const startValve = async () => {
    setStarting(true);
    setActionError(null);
    setActionMessage(null);
    try {
      if (isDirectMode) {
        await startDirectValve();
        setActionMessage('ESP8266 acknowledged ON command via Direct Wi-Fi. Dispensing started.');
        const updated = await checkDirectDevice();
        if (updated) setDirectStatus(updated);
      } else {
        const result = await apiRequest<{ session: DispensingSession }>('/api/valve/start', {
          method: 'POST',
        });
        setSession(result.session);
        setActionMessage('Device acknowledged the ON command. Dispensing authorized.');
        await refresh();
      }
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setStarting(false);
    }
  };

  const stopValve = async () => {
    setStopping(true);
    setActionError(null);
    setActionMessage(null);
    try {
      if (isDirectMode) {
        const result = await stopDirectValve();
        setActionMessage(`Valve closed directly. Dispensed ${litres(result.consumedMl)} L.`);
        const updated = await checkDirectDevice();
        if (updated) setDirectStatus(updated);
      } else {
        const result = await apiRequest<{
          confirmed: boolean;
          message: string;
          session: DispensingSession;
        }>('/api/valve/stop', { method: 'POST' });
        setSession(result.session);
        if (result.confirmed) {
          setActionMessage(result.message);
        } else {
          setActionError(result.message);
        }
        await refresh();
        await loadRecent();
      }
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setStopping(false);
    }
  };

  const topupDirect = async () => {
    setDirectTopupBusy(true);
    setActionError(null);
    try {
      const res = await topupDirectBalance(50000);
      setActionMessage(`Added 50.00 L to ESP8266. New local balance: ${litres(res.balanceMl)} L.`);
      const updated = await checkDirectDevice();
      if (updated) setDirectStatus(updated);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setDirectTopupBusy(false);
    }
  };

  const connectionLabel = isDirectMode
    ? 'Direct Wi-Fi'
    : socketStatus === 'open'
    ? 'Live'
    : socketStatus === 'connecting'
    ? 'Connecting'
    : 'Offline';
  const connectionTone = isDirectMode
    ? 'success'
    : socketStatus === 'open'
    ? 'success'
    : socketStatus === 'connecting'
    ? 'warning'
    : 'danger';

  const valveLabel = useMemo(() => {
    if (isDirectMode && directStatus) {
      if (directStatus.valveState === 'on' || directStatus.relayEnergized) {
        return 'Valve OPEN (Direct Wi-Fi) — Dispensing in progress';
      }
      return 'Connected to ESP8266 Direct Wi-Fi — Ready';
    }
    if (!device) return 'No device paired';
    if (!deviceOnline) return 'Device offline';
    if (valveOpen) return 'Valve open — estimated dispensing in progress';
    if (session && UNRESOLVED.includes(session.status)) return 'Session active';
    if (device.valveState === 'unknown') return 'Valve state unknown';
    return 'Ready';
  }, [isDirectMode, directStatus, device, deviceOnline, session, valveOpen]);

  const canStart = isDirectMode
    ? effectiveBalance >= 100 && !directDispensing && !starting && !stopping
    : Boolean(device) && deviceOnline && effectiveBalance >= 100 && !unresolved && !starting && !stopping;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <View style={styles.topRow}>
        <View>
          <Text style={styles.brand}>Valve</Text>
          <Text style={styles.greeting}>
            Hello{profile?.fullName ? `, ${profile.fullName.split(' ')[0]}` : ''}
          </Text>
        </View>
        <Pill label={connectionLabel} tone={connectionTone} />
      </View>

      <Card style={styles.balanceCard}>
        <View style={styles.balanceHeader}>
          <Text style={styles.balanceLabel}>Available water</Text>
          <View style={styles.dropIcon}>
            <Droplets size={20} color={colors.primary} />
          </View>
        </View>
        <Text style={styles.balanceValue} accessibilityLabel={`${litres(effectiveBalance)} litres available`}>
          {litres(effectiveBalance)} <Text style={styles.balanceUnit}>L</Text>
        </Text>
        <Text style={styles.balanceHint}>
          {isDirectMode ? 'Direct hardware prepaid balance on ESP8266' : 'Prepaid balance · estimated consumption'}
        </Text>
        {isDirectMode ? (
          <AppButton
            label="+50 L to ESP8266"
            variant="secondary"
            loading={directTopupBusy}
            onPress={topupDirect}
            style={styles.rechargeButton}
          />
        ) : (
          <AppButton
            label="Recharge water"
            variant="secondary"
            onPress={() => router.push('/(tabs)/recharge')}
            style={styles.rechargeButton}
          />
        )}
      </Card>

      <Card>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Valve control</Text>
          <Pill
            label={
              isDirectMode
                ? 'Direct Wi-Fi'
                : deviceOnline
                ? 'Device online'
                : device
                ? 'Device offline'
                : 'Not paired'
            }
            tone={isDirectMode || deviceOnline ? 'success' : device ? 'danger' : 'neutral'}
          />
        </View>
        <Text style={styles.valveState}>{valveLabel}</Text>

        {isDirectMode && directStatus && (directStatus.sessionActive || directStatus.relayEnergized) ? (
          <View style={styles.sessionBox}>
            <Text style={styles.sessionLabel}>Water dispensed (Direct Wi-Fi)</Text>
            <Text style={styles.sessionValue}>{litres(directStatus.consumedMl)} L</Text>
            <View style={styles.sessionMetaRow}>
              <Text style={styles.sessionMeta}>
                Authorized {litres(directStatus.authorizedMl)} L
              </Text>
              <Text style={styles.sessionMeta}>
                Remaining {litres(Math.max(directStatus.authorizedMl - directStatus.consumedMl, 0))} L
              </Text>
            </View>
            <Text style={styles.sessionRate}>
              ≈ 1.00 L per second. Direct hardware flow control over local ESP8266 Wi-Fi.
            </Text>
          </View>
        ) : unresolved && session ? (
          <View style={styles.sessionBox}>
            <Text style={styles.sessionLabel}>Estimated water dispensed</Text>
            <Text style={styles.sessionValue}>{litres(liveMl)} L</Text>
            <View style={styles.sessionMetaRow}>
              <Text style={styles.sessionMeta}>
                Authorized {litres(session.authorizedMl)} L
              </Text>
              <Text style={styles.sessionMeta}>
                Remaining {litres(Math.max(session.remainingAuthorizedMl, 0))} L
              </Text>
            </View>
            <Text style={styles.sessionRate}>
              ≈ 1.00 L per second of valve-open time. Confirmed by the backend at each
              one-second cycle; the figure above may include a provisional local estimate.
            </Text>
          </View>
        ) : null}

        <View style={styles.controls}>
          <AppButton
            label="START"
            onPress={startValve}
            loading={starting}
            disabled={!canStart}
            icon={<Power size={20} color="#FFFFFF" />}
            style={styles.controlButton}
          />
          <AppButton
            label="STOP"
            variant="danger"
            onPress={stopValve}
            loading={stopping}
            disabled={isDirectMode ? (!directDispensing || stopping) : (!unresolved || stopping)}
            icon={<Power size={20} color="#FFFFFF" />}
            style={styles.controlButton}
          />
        </View>

        {isDirectMode ? (
          <Notice tone="info">
            Direct Mode: Connected to ESP8266 Wi-Fi (192.168.4.1). Operating offline without internet.
          </Notice>
        ) : !deviceOnline ? (
          <Notice tone="warning">
            {device
              ? 'Device is not reporting a cloud heartbeat. To operate offline, join the "Valve-Water-Dispenser" Wi-Fi on your phone.'
              : 'Pair your ESP8266 device or join its Wi-Fi network.'}
          </Notice>
        ) : null}
        {effectiveBalance < 100 && !valveOpen ? (
          <Notice tone="warning">Recharge at least 0.10 L to start dispensing.</Notice>
        ) : null}
        {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
        {actionMessage ? <Notice tone="success">{actionMessage}</Notice> : null}
        {!unresolved && session?.status === 'completed' && !isDirectMode ? (
          <Notice>
            Last session used {litres(session.consumedMl)} L estimated
            {session.stopReason ? ` · stopped: ${session.stopReason.replace(/_/g, ' ')}` : ''}.
          </Notice>
        ) : null}
      </Card>

      <Card>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Device</Text>
          <Wifi size={18} color={isDirectMode || deviceOnline ? colors.success : colors.faint} />
        </View>
        {isDirectMode && directStatus ? (
          <View>
            <KeyValue label="Connection" value="Direct ESP8266 SoftAP" />
            <KeyValue label="Device ID" value={directStatus.deviceId || 'valve-esp8266-001'} />
            <KeyValue label="Direct IP" value="192.168.4.1" />
            <KeyValue label="Valve State" value={directStatus.valveState.toUpperCase()} />
            <KeyValue label="Relay" value={directStatus.relayEnergized ? 'Energized (Open)' : 'De-energized (Closed)'} />
            <KeyValue label="Total Dispensed" value={`${litres(totalDispensed)} L`} />
          </View>
        ) : device ? (
          <View>
            <KeyValue label="Device" value={device.deviceName} />
            <KeyValue label="Device ID" value={device.deviceId} />
            <KeyValue label="Last heartbeat" value={relative(device.lastHeartbeat)} />
            <KeyValue label="Wi-Fi signal" value={device.wifiRssi != null ? `${device.wifiRssi} dBm` : '—'} />
            <KeyValue label="Firmware" value={device.firmwareVersion ?? '—'} />
            <KeyValue label="Total estimated dispensed" value={`${litres(totalDispensed)} L`} />
          </View>
        ) : (
          <View style={styles.noDevice}>
            <WifiOff size={22} color={colors.muted} />
            <Text style={styles.noDeviceText}>
              No device is paired to this account yet.
            </Text>
          </View>
        )}
        {!isDirectMode ? (
          <AppButton
            label={device ? 'Re-pair or connect another device' : 'Connect device'}
            variant="ghost"
            icon={<PlugZap size={18} color={colors.primary} />}
            onPress={() => router.push('/connect-device')}
          />
        ) : null}
      </Card>

      <View>
        <SectionTitle hint="Estimated from valve-open time">Recent usage</SectionTitle>
        <Card style={styles.recentCard}>
          {recent.length === 0 ? (
            <View style={styles.emptyRecent}>
              <AlertTriangle size={18} color={colors.faint} />
              <Text style={styles.emptyRecentText}>No dispensing recorded yet.</Text>
            </View>
          ) : (
            recent.map((entry) => (
              <View key={entry.transactionId} style={styles.recentRow}>
                <View style={styles.recentIcon}>
                  <Droplets size={16} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.recentTitle}>{litres(Math.abs(entry.deltaMl))} L estimated</Text>
                  <Text style={styles.recentMeta}>{dateTime(entry.createdAt)}</Text>
                </View>
                <Text style={styles.recentBalance}>{litres(entry.balanceAfterMl)} L left</Text>
              </View>
            ))
          )}
          <AppButton
            label="View history"
            variant="ghost"
            icon={<History size={18} color={colors.primary} />}
            onPress={() => router.push('/(tabs)/history')}
          />
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  brand: { fontSize: typography.title, fontWeight: '700', color: colors.ink },
  greeting: { fontSize: typography.small, color: colors.muted, marginTop: 2 },
  balanceCard: { backgroundColor: colors.primary, borderColor: colors.primary },
  balanceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  balanceLabel: { color: '#CFE9EA', fontSize: typography.small, fontWeight: '600' },
  dropIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceValue: {
    color: '#FFFFFF',
    fontSize: typography.display + 6,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  balanceUnit: { fontSize: typography.heading, fontWeight: '600', color: '#CFE9EA' },
  balanceHint: { color: '#CFE9EA', fontSize: typography.tiny, marginTop: 2 },
  rechargeButton: { marginTop: spacing.lg, backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: typography.heading, fontWeight: '600', color: colors.ink },
  valveState: { fontSize: typography.small, color: colors.muted, marginTop: spacing.xs },
  sessionBox: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: 2,
  },
  sessionLabel: { fontSize: typography.tiny, color: colors.muted, fontWeight: '600' },
  sessionValue: { fontSize: 34, fontWeight: '700', color: colors.ink },
  sessionMetaRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs },
  sessionMeta: { fontSize: typography.tiny, color: colors.muted },
  sessionRate: { fontSize: typography.tiny, color: colors.faint, marginTop: spacing.sm, lineHeight: 16 },
  controls: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  controlButton: { flex: 1, minHeight: 62 },
  noDevice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: spacing.md },
  noDeviceText: { flex: 1, fontSize: typography.small, color: colors.muted },
  recentCard: { gap: spacing.xs },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  recentIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentTitle: { fontSize: typography.small, fontWeight: '600', color: colors.ink },
  recentMeta: { fontSize: typography.tiny, color: colors.faint },
  recentBalance: { fontSize: typography.tiny, color: colors.muted },
  emptyRecent: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  emptyRecentText: { fontSize: typography.small, color: colors.muted },
});
