import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { CheckCircle2, QrCode, Wifi } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton, Card, Field, Notice, Pill, Screen, SectionTitle } from '../components/ui';
import { colors, radius, spacing, typography } from '../constants/theme';
import { useAuth } from '../contexts/AuthContext';
import { apiRequest, errorMessage } from '../services/api';
import {
  defaultSetupSsid,
  joinDeviceSetupNetwork,
  leaveDeviceSetupNetwork,
  parsePairingPayload,
  provisionDevice,
} from '../services/wifi';
import type { Device } from '../types/domain';

type Step = 1 | 2 | 3 | 4;

export default function ConnectDeviceScreen() {
  const { refreshProfile } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [step, setStep] = useState<Step>(1);

  const [deviceId, setDeviceId] = useState('');
  const [claimCode, setClaimCode] = useState('');
  const [apSsid, setApSsid] = useState('');
  const [apPassword, setApPassword] = useState('');
  const [devicePairingToken, setDevicePairingToken] = useState('');
  const [pairingToken, setPairingToken] = useState('');
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [assigned, setAssigned] = useState(false);
  const [online, setOnline] = useState(false);
  const [polling, setPolling] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      void leaveDeviceSetupNetwork(apSsid || undefined);
    };
  }, [apSsid]);

  const applyLabel = (payload: Partial<{
    deviceId: string;
    claimCode: string;
    apSsid: string;
    apPassword: string;
    pairingToken: string;
  }>) => {
    if (payload.deviceId) setDeviceId(payload.deviceId);
    if (payload.claimCode) setClaimCode(payload.claimCode);
    if (payload.apSsid) setApSsid(payload.apSsid);
    if (payload.apPassword) setApPassword(payload.apPassword);
    if (payload.pairingToken) setDevicePairingToken(payload.pairingToken);
    setScanning(false);
    setError(null);
  };

  const scanLabel = async () => {
    setError(null);
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setError('Camera permission is required to scan the label, or enter the details manually.');
        return;
      }
    }
    setScanning(true);
  };

  const authorize = async () => {
    setError(null);
    setMessage(null);
    if (!deviceId.trim() || !claimCode.trim()) {
      setError('Enter the device ID and claim code printed on the label.');
      return;
    }
    if (!apSsid.trim()) setApSsid(defaultSetupSsid(deviceId.trim()));
    if (!apPassword || !devicePairingToken) {
      setError('Enter the setup network password and pairing token from the device label.');
      return;
    }
    setBusy(true);
    try {
      const challenge = await apiRequest<{ pairingToken: string; setupApPrefix: string }>(
        '/api/devices/pairing/challenge',
        {
          method: 'POST',
          body: { deviceId: deviceId.trim(), claimCode: claimCode.trim() },
        },
      );
      setPairingToken(challenge.pairingToken);
      setStep(2);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const joinSetupNetwork = async () => {
    setError(null);
    setBusy(true);
    try {
      await joinDeviceSetupNetwork(apSsid.trim(), apPassword);
      setJoined(true);
      setStep(3);
      setMessage(
        'Phone joined the device setup network. Android may warn that it has no internet; keep the connection.',
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const sendWifi = async () => {
    setError(null);
    setMessage(null);
    if (!wifiSsid.trim()) {
      setError('Enter the Wi-Fi network or hotspot name.');
      return;
    }
    setBusy(true);
    try {
      await provisionDevice({
        ssid: wifiSsid.trim(),
        password: wifiPassword,
        pairingToken: devicePairingToken,
      });
      const assignment = await apiRequest<{ assigned: boolean; device: Device }>(
        '/api/devices/assign',
        { method: 'POST', body: { pairingToken } }
      );
      setAssigned(assignment.assigned);
      setStep(4);
      setMessage('Wi-Fi details accepted. Device is restarting and joining your network.');
      await refreshProfile();
      startPolling();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const startPolling = () => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    setPolling(true);
    let attempts = 0;
    const check = async () => {
      attempts += 1;
      try {
        const status = await apiRequest<{ device: Device | null }>('/api/devices/status');
        if (status.device?.status === 'online') {
          setOnline(true);
          setPolling(false);
          if (pollTimer.current) clearInterval(pollTimer.current);
          pollTimer.current = null;
          await refreshProfile();
          return;
        }
      } catch {
        /* keep polling */
      }
      if (attempts >= 20 && pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
        setPolling(false);
      }
    };
    void check();
    pollTimer.current = setInterval(() => void check(), 5000);
  };

  const reset = () => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = null;
    setStep(1);
    setPairingToken('');
    setAssigned(false);
    setOnline(false);
    setJoined(false);
    setMessage(null);
    setError(null);
    void leaveDeviceSetupNetwork(apSsid || undefined);
  };

  const onBarcodeScanned = ({ data }: { data: string }) => {
    const parsed = parsePairingPayload(data);
    if (parsed) {
      applyLabel(parsed);
    } else {
      setError('That QR code is not a Valve device label. Try again or enter details manually.');
      setScanning(false);
    }
  };

  if (scanning) {
    return (
      <View style={styles.scannerWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onBarcodeScanned}
        />
        <View style={styles.scannerOverlay}>
          <Text style={styles.scannerText}>Point the camera at the device label QR code.</Text>
          <AppButton label="Cancel" variant="secondary" onPress={() => setScanning(false)} />
        </View>
      </View>
    );
  }

  return (
    <Screen>
      <View style={styles.steps}>
        {[1, 2, 3, 4].map((value) => (
          <View key={value} style={styles.stepItem}>
            <View style={[styles.stepDot, step >= value && styles.stepDotActive]}>
              {step > value ? (
                <CheckCircle2 size={14} color="#FFFFFF" />
              ) : (
                <Text style={[styles.stepNumber, step >= value && styles.stepNumberActive]}>{value}</Text>
              )}
            </View>
            <Text style={[styles.stepLabel, step >= value && styles.stepLabelActive]}>
              {['Details', 'Join AP', 'Wi-Fi', 'Online'][value - 1]}
            </Text>
          </View>
        ))}
      </View>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}

      {step === 1 ? (
        <>
          <Card>
            <Text style={styles.cardTitle}>Read the device label</Text>
            <Text style={styles.body}>
              The QR label contains the device ID, one-time claim code, setup network name and
              password, and the device pairing token. Nothing on the label is sent to the server
              except the device ID and claim code.
            </Text>
            <AppButton
              label="Scan QR label"
              variant="secondary"
              icon={<QrCode size={18} color={colors.primary} />}
              onPress={() => void scanLabel()}
              style={{ marginTop: spacing.md }}
            />
          </Card>

          <Card>
            <SectionTitle>Or enter the details manually</SectionTitle>
            <View style={styles.form}>
              <Field
                label="Device ID"
                value={deviceId}
                onChangeText={(value) => {
                  setDeviceId(value);
                  if (!apSsid) setApSsid(defaultSetupSsid(value));
                }}
                placeholder="valve-esp8266-001"
              />
              <Field
                label="Claim code"
                value={claimCode}
                onChangeText={setClaimCode}
                placeholder="From the backend/admin label"
              />
              <Field label="Setup network (SSID)" value={apSsid} onChangeText={setApSsid} placeholder="Valve-ESP8266-XXXX" />
              <Field
                label="Setup network password"
                value={apPassword}
                onChangeText={setApPassword}
                secure
                placeholder="From the device label"
              />
              <Field
                label="Device pairing token"
                value={devicePairingToken}
                onChangeText={setDevicePairingToken}
                secure
                placeholder="From the device label"
              />
            </View>
            <AppButton label="Authorize pairing" onPress={authorize} loading={busy} style={{ marginTop: spacing.md }} />
          </Card>
          <Notice tone="warning">
            If your phone is providing the hotspot you want the device to join, it cannot also join
            the device setup network at the same time. Use a separate phone hotspot or a router.
          </Notice>
        </>
      ) : null}

      {step === 2 ? (
        <Card>
          <Text style={styles.cardTitle}>Join the device setup network</Text>
          <View style={styles.apBox}>
            <Wifi size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.apName}>{apSsid}</Text>
              <Text style={styles.apHint}>Protected WPA2 network · no internet (expected)</Text>
            </View>
          </View>
          <Text style={styles.body}>
            Android may ask whether to stay connected to a network without internet — choose
            "Keep connection" so the phone can reach 192.168.4.1. On iOS, approve the hotspot
            configuration prompt.
          </Text>
          <AppButton label="Join setup network" onPress={joinSetupNetwork} loading={busy} style={{ marginTop: spacing.md }} />
          <AppButton label="Back" variant="ghost" onPress={() => setStep(1)} />
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Your Wi-Fi</Text>
            <Pill label={joined ? 'Joined setup network' : 'Not joined'} tone={joined ? 'success' : 'warning'} />
          </View>
          <Text style={styles.body}>
            These credentials go directly from this phone to the ESP8266. They are never sent to
            the Valve backend, Firebase, ThingsBoard or any log.
          </Text>
          <View style={styles.form}>
            <Field
              label="Wi-Fi / hotspot name"
              value={wifiSsid}
              onChangeText={setWifiSsid}
              placeholder="Home Wi-Fi"
              autoCapitalize="none"
            />
            <Field
              label="Wi-Fi password"
              value={wifiPassword}
              onChangeText={setWifiPassword}
              secure
              placeholder="Leave empty for an open network"
            />
          </View>
          <AppButton label="Send to device" onPress={sendWifi} loading={busy} style={{ marginTop: spacing.md }} />
          <AppButton label="Back" variant="ghost" onPress={() => setStep(2)} />
        </Card>
      ) : null}

      {step === 4 ? (
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Pairing</Text>
            <Pill
              label={online ? 'Device online' : polling ? 'Waiting for heartbeat' : 'Not yet online'}
              tone={online ? 'success' : 'warning'}
            />
          </View>
          <Text style={styles.body}>
            {online
              ? 'The backend received a heartbeat from this device. Pairing is complete.'
              : assigned
                ? 'The device is assigned to your account. The backend has not received a heartbeat yet. Keep this screen open while it reconnects, or retry below.'
                : 'Waiting for assignment.'}
          </Text>
          {!online ? (
            <AppButton
              label={polling ? 'Checking again…' : 'Check status again'}
              onPress={() => {
                setOnline(false);
                startPolling();
              }}
              loading={polling}
              style={{ marginTop: spacing.md }}
            />
          ) : null}
          {online ? (
            <AppButton
              label="Done"
              onPress={() => router.replace('/(tabs)')}
              style={{ marginTop: spacing.md }}
            />
          ) : null}
          {online ? null : (
            <AppButton
              label="Pair another device"
              variant="ghost"
              onPress={reset}
            />
          )}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scannerWrap: { flex: 1, backgroundColor: '#000000' },
  scannerOverlay: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xxl,
    gap: spacing.md,
  },
  scannerText: { color: '#FFFFFF', fontSize: typography.body, textAlign: 'center' },
  steps: { flexDirection: 'row', justifyContent: 'space-between' },
  stepItem: { alignItems: 'center', gap: spacing.xs, flex: 1 },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: { backgroundColor: colors.primary },
  stepNumber: { fontSize: typography.tiny, fontWeight: '700', color: colors.muted },
  stepNumberActive: { color: '#FFFFFF' },
  stepLabel: { fontSize: 10, color: colors.faint, fontWeight: '600' },
  stepLabelActive: { color: colors.primary },
  cardTitle: { fontSize: typography.heading, fontWeight: '600', color: colors.ink },
  body: { fontSize: typography.small, color: colors.muted, lineHeight: 20, marginTop: spacing.sm },
  form: { gap: spacing.md, marginTop: spacing.md },
  apBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  apName: { fontSize: typography.body, fontWeight: '600', color: colors.ink },
  apHint: { fontSize: typography.tiny, color: colors.muted },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});