import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CreditCard, Droplets } from 'lucide-react-native';
import { AppButton, Card, Field, Notice, Pill, Screen, SectionTitle } from '../../components/ui';
import { colors, radius, spacing, typography } from '../../constants/theme';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtime } from '../../contexts/RealtimeContext';
import { apiRequest, errorMessage } from '../../services/api';
import { inr, litres } from '../../services/format';
import { openRazorpayCheckout } from '../../services/payments';
import type { CreateOrderResponse, PricingConfig } from '../../types/domain';

export default function RechargeScreen() {
  const { profile } = useAuth();
  const { balanceMl, refresh, socketStatus } = useRealtime();
  const [pricing, setPricing] = useState<PricingConfig | null>(null);
  const [selectedLitres, setSelectedLitres] = useState<number | null>(null);
  const [customLitres, setCustomLitres] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiRequest<PricingConfig>('/api/recharge/pricing')
      .then((data) => {
        if (!active) return;
        setPricing(data);
        if (data.availableRechargePackages?.length) {
          setSelectedLitres(data.availableRechargePackages[0] ?? null);
        }
      })
      .catch((err) => active && setError(errorMessage(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const quantityMl = useMemo(() => {
    if (customLitres.trim()) {
      const value = Number(customLitres);
      if (!Number.isFinite(value)) return 0;
      return Math.round(value * 1000);
    }
    return (selectedLitres ?? 0) * 1000;
  }, [customLitres, selectedLitres]);

  const amountPaise = useMemo(() => {
    if (!pricing?.pricePerLitrePaise) return 0;
    return Math.round((quantityMl * pricing.pricePerLitrePaise) / 1000);
  }, [pricing?.pricePerLitrePaise, quantityMl]);

  const balance = balanceMl ?? profile?.balanceMl ?? 0;

  const selectPackage = (value: number) => {
    setSelectedLitres(value);
    setCustomLitres('');
    setError(null);
    setMessage(null);
  };

  const recharge = async () => {
    setError(null);
    setMessage(null);
    if (!pricing?.configured || !pricing.paymentsEnabled) {
      setError('Online recharge is not enabled. Ask an administrator to configure pricing and Razorpay.');
      return;
    }
    if (!quantityMl || quantityMl < (pricing.minimumRechargeLitres ?? 1) * 1000) {
      setError(`Minimum recharge is ${pricing.minimumRechargeLitres ?? 1} L.`);
      return;
    }
    if (quantityMl > (pricing.maximumRechargeLitres ?? 100) * 1000) {
      setError(`Maximum recharge is ${pricing.maximumRechargeLitres ?? 100} L.`);
      return;
    }
    setBusy(true);
    try {
      const order = await apiRequest<CreateOrderResponse>('/api/payments/create-order', {
        method: 'POST',
        body: { quantityMl },
      });
      const result = await openRazorpayCheckout({
        key: order.keyId,
        amount: order.amountPaise,
        currency: order.currency,
        name: 'Valve',
        description: `${litres(order.quantityMl)} L water recharge`,
        order_id: order.razorpayOrderId,
        prefill: order.prefill,
        theme: { color: colors.primary },
      });
      const verified = await apiRequest<{
        status: 'paid' | 'pending' | 'failed';
        credited: boolean;
        balanceMl: number;
        message: string;
      }>('/api/payments/verify', {
        method: 'POST',
        body: {
          razorpayOrderId: result.razorpay_order_id ?? order.razorpayOrderId,
          razorpayPaymentId: result.razorpay_payment_id,
          razorpaySignature: result.razorpay_signature,
        },
      });
      setMessage(verified.message);
      if (verified.status === 'failed') setError('The payment was not captured. No water was credited.');
      await refresh();
    } catch (err) {
      setError(
        `${errorMessage(err)} If you completed a payment, the balance will update only after the server verifies it.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View>
        <Text style={styles.title}>Recharge</Text>
        <Text style={styles.subtitle}>Top up prepaid water. Amounts are charged in INR.</Text>
      </View>

      <Card style={styles.balanceCard}>
        <View style={styles.rowBetween}>
          <View style={styles.iconBubble}>
            <Droplets size={18} color={colors.primary} />
          </View>
          <Pill
            label={socketStatus === 'open' ? 'Live balance' : 'Reconnecting'}
            tone={socketStatus === 'open' ? 'success' : 'warning'}
          />
        </View>
        <Text style={styles.balanceValue}>{litres(balance)} L</Text>
        <Text style={styles.balanceHint}>Available water balance</Text>
      </Card>

      {loading ? <Notice>Loading pricing…</Notice> : null}

      {!loading && pricing && !pricing.configured ? (
        <Notice tone="warning">
          Pricing is not configured yet. An administrator must set the price per litre before
          payments can be enabled.
        </Notice>
      ) : null}

      {pricing?.configured ? (
        <>
          <Card>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>Price</Text>
              <Text style={styles.price}>
                {inr(pricing.pricePerLitrePaise)} / litre
              </Text>
            </View>
            <Text style={styles.hint}>
              {pricing.minimumRechargeLitres}–{pricing.maximumRechargeLitres} litres per recharge
              {pricing.mode === 'test' ? ' · Razorpay Test Mode' : ''}
            </Text>
          </Card>

          <View>
            <SectionTitle hint="Select or enter litres">Recharge amount</SectionTitle>
            <View style={styles.packages}>
              {(pricing.availableRechargePackages ?? []).map((value) => {
                const selected = !customLitres && selectedLitres === value;
                return (
                  <AppButton
                    key={value}
                    label={`${value} L`}
                    variant={selected ? 'primary' : 'secondary'}
                    onPress={() => selectPackage(value)}
                    style={styles.packageButton}
                  />
                );
              })}
            </View>
            <Card style={{ marginTop: spacing.md }}>
              <Field
                label="Custom quantity (litres)"
                value={customLitres}
                onChangeText={(value) => {
                  setCustomLitres(value.replace(/[^0-9.]/g, ''));
                  setSelectedLitres(null);
                }}
                placeholder={`${pricing.minimumRechargeLitres ?? 10}`}
                keyboardType="decimal-pad"
              />
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>{inr(amountPaise)}</Text>
              </View>
            </Card>
          </View>

          {error ? <Notice tone="danger">{error}</Notice> : null}
          {message ? <Notice tone="success">{message}</Notice> : null}

          <AppButton
            label={`Pay ${inr(amountPaise)}`}
            onPress={recharge}
            loading={busy}
            disabled={!pricing.paymentsEnabled || amountPaise < 100}
            icon={<CreditCard size={18} color="#FFFFFF" />}
          />
          {!pricing.paymentsEnabled ? (
            <Notice tone="warning">
              Online payments are disabled because Razorpay server credentials are not configured.
            </Notice>
          ) : null}
          <Text style={styles.footnote}>
            Payment success on the phone is not proof of payment. Water is credited only after the
            backend verifies the Razorpay signature and capture status.
          </Text>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.title, fontWeight: '700', color: colors.ink },
  subtitle: { fontSize: typography.small, color: colors.muted, marginTop: 2 },
  balanceCard: { gap: spacing.xs },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  iconBubble: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceValue: { fontSize: 32, fontWeight: '700', color: colors.ink, marginTop: spacing.sm },
  balanceHint: { fontSize: typography.tiny, color: colors.muted },
  cardTitle: { fontSize: typography.body, fontWeight: '600', color: colors.ink },
  price: { fontSize: typography.body, fontWeight: '700', color: colors.primary },
  hint: { fontSize: typography.tiny, color: colors.muted, marginTop: spacing.xs },
  packages: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  packageButton: { minWidth: '30%', flexGrow: 1 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  totalLabel: { fontSize: typography.body, color: colors.muted },
  totalValue: { fontSize: typography.heading, fontWeight: '700', color: colors.ink },
  footnote: { fontSize: typography.tiny, color: colors.faint, lineHeight: 16, textAlign: 'center' },
});
