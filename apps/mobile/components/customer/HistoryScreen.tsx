import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ArrowDownLeft, ArrowUpRight, Droplets, Receipt } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../../constants/theme';
import { useRealtime } from '../../contexts/RealtimeContext';
import { apiRequest, errorMessage } from '../../services/api';
import { dateTime, inr, litres, signedLitres } from '../../services/format';
import type { RechargeOrder, Transaction } from '../../types/domain';
import { Card, EmptyState, Notice, Pill, Screen, SectionTitle } from '../ui';

export function CustomerHistoryScreen() {
  const { eventTick } = useRealtime();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [orders, setOrders] = useState<RechargeOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<{
        transactions: Transaction[];
        orders: RechargeOrder[];
      }>('/api/customer/history');
      setTransactions(data.transactions);
      setOrders(data.orders);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, eventTick]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <View>
        <Text style={styles.title}>History</Text>
        <Text style={styles.subtitle}>
          Consumption is estimated from valve-open time. Recharges and cash credits are exact.
        </Text>
      </View>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <View>
        <SectionTitle hint={`${transactions.length} entries`}>Water ledger</SectionTitle>
        <Card style={styles.card}>
          {transactions.length === 0 ? (
            <EmptyState title="No transactions yet" message="Your water activity will appear here." />
          ) : (
            transactions.map((entry) => (
              <View key={entry.transactionId} style={styles.row}>
                <View style={styles.icon}>
                  {entry.deltaMl < 0 ? (
                    <Droplets size={16} color={colors.primary} />
                  ) : (
                    <ArrowDownLeft size={16} color={colors.success} />
                  )}
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{entry.description}</Text>
                  <Text style={styles.rowMeta}>{dateTime(entry.createdAt)}</Text>
                </View>
                <View style={styles.rowRight}>
                  <Text
                    style={[
                      styles.rowAmount,
                      entry.deltaMl < 0 ? styles.amountOut : styles.amountIn,
                    ]}
                  >
                    {signedLitres(entry.deltaMl)}
                  </Text>
                  <Text style={styles.rowMeta}>{litres(entry.balanceAfterMl)} L left</Text>
                </View>
              </View>
            ))
          )}
        </Card>
      </View>

      <View>
        <SectionTitle>Online payments</SectionTitle>
        <Card style={styles.card}>
          {orders.length === 0 ? (
            <EmptyState title="No online recharges" message="Razorpay payment records will appear here." />
          ) : (
            orders.map((order) => (
              <View key={order.orderId} style={styles.row}>
                <View style={styles.icon}>
                  <Receipt size={16} color={colors.muted} />
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{litres(order.quantityMl)} L recharge</Text>
                  <Text style={styles.rowMeta}>
                    {dateTime(order.createdAt)} · {inr(order.amountPaise)}
                  </Text>
                </View>
                <Pill
                  label={order.status}
                  tone={
                    order.status === 'paid'
                      ? 'success'
                      : order.status === 'failed'
                        ? 'danger'
                        : order.status === 'refunded'
                          ? 'warning'
                          : 'info'
                  }
                />
              </View>
            ))
          )}
        </Card>
      </View>
      <View style={styles.legend}>
        <ArrowUpRight size={14} color={colors.faint} />
        <Text style={styles.legendText}>
          Negative entries are estimated consumption. Positive entries are credited water.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.title, fontWeight: '700', color: colors.ink },
  subtitle: { fontSize: typography.small, color: colors.muted, marginTop: 2, lineHeight: 20 },
  card: { paddingVertical: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: typography.small, fontWeight: '600', color: colors.ink },
  rowMeta: { fontSize: typography.tiny, color: colors.faint },
  rowRight: { alignItems: 'flex-end', gap: 2 },
  rowAmount: { fontSize: typography.small, fontWeight: '700' },
  amountOut: { color: colors.primary },
  amountIn: { color: colors.success },
  legend: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center', justifyContent: 'center' },
  legendText: { fontSize: typography.tiny, color: colors.faint, flex: 1 },
});
