import Constants from 'expo-constants';
import { LogOut, MailCheck, ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton, Card, KeyValue, Notice, Pill, Screen, SectionTitle } from '../../components/ui';
import { colors, spacing, typography } from '../../constants/theme';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtime } from '../../contexts/RealtimeContext';
import { errorMessage } from '../../services/api';
import { dateTime } from '../../services/format';

export default function ProfileScreen() {
  const { profile, emailVerified, resendVerification, signOut, refreshProfile } = useAuth();
  const { device } = useRealtime();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resend = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await resendVerification();
      setMessage('Verification email sent. Check your inbox.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View>
        <Text style={styles.title}>Profile</Text>
        <Text style={styles.subtitle}>Your account and paired device.</Text>
      </View>

      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Card>
        <View style={styles.rowBetween}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(profile?.fullName ?? 'V').slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <Pill
            label={profile?.status === 'active' ? 'Active account' : 'Disabled'}
            tone={profile?.status === 'active' ? 'success' : 'danger'}
          />
        </View>
        <Text style={styles.name}>{profile?.fullName ?? '—'}</Text>
        <Text style={styles.email}>{profile?.email ?? '—'}</Text>
        <View style={styles.verifyRow}>
          <MailCheck size={16} color={emailVerified ? colors.success : colors.warning} />
          <Text style={styles.verifyText}>
            {emailVerified ? 'Email verified' : 'Email not verified'}
          </Text>
          {!emailVerified ? (
            <AppButton label="Resend" variant="ghost" onPress={resend} loading={busy} />
          ) : null}
        </View>
      </Card>

      <Card>
        <SectionTitle>Account</SectionTitle>
        <KeyValue label="Role" value={profile?.role === 'admin' ? 'Administrator' : 'Customer'} />
        <KeyValue label="Account status" value={profile?.status ?? '—'} />
        <KeyValue label="Member since" value={dateTime(profile?.createdAt)} />
        <KeyValue label="Estimated total dispensed" value={`${profile?.totalEstimatedDispensedLitres ?? '0.00'} L`} />
      </Card>

      <Card>
        <SectionTitle>Device</SectionTitle>
        {device ? (
          <>
            <KeyValue label="Name" value={device.deviceName} />
            <KeyValue label="Device ID" value={device.deviceId} />
            <KeyValue label="Connectivity" value={device.status} />
            <KeyValue label="Firmware" value={device.firmwareVersion ?? '—'} />
            <KeyValue label="Last heartbeat" value={device.lastHeartbeat ? dateTime(device.lastHeartbeat) : '—'} />
          </>
        ) : (
          <Text style={styles.muted}>No device is paired to this account.</Text>
        )}
      </Card>

      <Card>
        <View style={styles.securityRow}>
          <ShieldCheck size={18} color={colors.primary} />
          <Text style={styles.securityText}>
            Valve never stores card numbers, UPI PINs or Wi-Fi passwords on the server. Consumption
            is an estimate based on valve-open time, not a flow sensor reading.
          </Text>
        </View>
      </Card>

      <AppButton
        label="Sign out"
        variant="secondary"
        icon={<LogOut size={18} color={colors.primary} />}
        onPress={() => void signOut()}
      />
      <AppButton label="Refresh profile" variant="ghost" onPress={() => void refreshProfile()} />
      <Text style={styles.version}>Valve {Constants.expoConfig?.version ?? '1.0.0'}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.title, fontWeight: '700', color: colors.ink },
  subtitle: { fontSize: typography.small, color: colors.muted, marginTop: 2 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: typography.heading, fontWeight: '700', color: colors.primary },
  name: { fontSize: typography.heading, fontWeight: '700', color: colors.ink, marginTop: spacing.md },
  email: { fontSize: typography.small, color: colors.muted },
  verifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  verifyText: { fontSize: typography.small, color: colors.muted, flex: 1 },
  muted: { fontSize: typography.small, color: colors.muted },
  securityRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  securityText: { flex: 1, fontSize: typography.tiny, color: colors.muted, lineHeight: 18 },
  version: { textAlign: 'center', fontSize: typography.tiny, color: colors.faint },
});
