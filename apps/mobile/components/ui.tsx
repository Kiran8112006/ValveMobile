import React from 'react';
import {
  ActivityIndicator,
  KeyboardTypeOptions,
  RefreshControl,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radius, spacing, typography } from '../constants/theme';

export interface AppButtonProps {
  label: string;
  onPress?: () => void | Promise<void>;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}

export function AppButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
  icon,
  style,
  labelStyle,
  accessibilityLabel,
}: AppButtonProps) {
  const isDisabled = disabled || loading;

  const getContainerStyle = (): StyleProp<ViewStyle> => {
    switch (variant) {
      case 'secondary':
        return styles.btnSecondary;
      case 'danger':
        return styles.btnDanger;
      case 'ghost':
        return styles.btnGhost;
      case 'primary':
      default:
        return styles.btnPrimary;
    }
  };

  const getTextStyle = (): StyleProp<TextStyle> => {
    switch (variant) {
      case 'secondary':
        return styles.btnSecondaryText;
      case 'danger':
        return styles.btnDangerText;
      case 'ghost':
        return styles.btnGhostText;
      case 'primary':
      default:
        return styles.btnPrimaryText;
    }
  };

  return (
    <TouchableOpacity
      accessibilityLabel={accessibilityLabel || label}
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.btnBase,
        getContainerStyle(),
        isDisabled && styles.btnDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'secondary' || variant === 'ghost' ? colors.primary : '#FFFFFF'}
        />
      ) : (
        <View style={styles.btnContent}>
          {icon ? <View style={styles.btnIcon}>{icon}</View> : null}
          <Text style={[getTextStyle(), labelStyle]}>{label}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export interface FieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secure?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoComplete?: any;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  error?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secure = false,
  keyboardType = 'default',
  autoComplete,
  autoCapitalize = 'none',
  error,
  disabled = false,
  style,
}: FieldProps) {
  return (
    <View style={[styles.fieldWrap, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        secureTextEntry={secure}
        keyboardType={keyboardType}
        autoComplete={autoComplete}
        autoCapitalize={autoCapitalize}
        editable={!disabled}
        style={[
          styles.fieldInput,
          disabled && styles.fieldInputDisabled,
          error ? styles.fieldInputError : null,
        ]}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

export interface NoticeProps {
  children: React.ReactNode;
  tone?: 'info' | 'success' | 'warning' | 'danger';
  style?: StyleProp<ViewStyle>;
}

export function Notice({ children, tone = 'info', style }: NoticeProps) {
  const getContainerStyle = () => {
    switch (tone) {
      case 'success':
        return styles.noticeSuccess;
      case 'warning':
        return styles.noticeWarning;
      case 'danger':
        return styles.noticeDanger;
      case 'info':
      default:
        return styles.noticeInfo;
    }
  };

  const getTextStyle = () => {
    switch (tone) {
      case 'success':
        return styles.noticeSuccessText;
      case 'warning':
        return styles.noticeWarningText;
      case 'danger':
        return styles.noticeDangerText;
      case 'info':
      default:
        return styles.noticeInfoText;
    }
  };

  return (
    <View style={[styles.noticeBase, getContainerStyle(), style]}>
      {typeof children === 'string' ? (
        <Text style={getTextStyle()}>{children}</Text>
      ) : (
        children
      )}
    </View>
  );
}

export interface PillProps {
  label: string;
  tone?: 'success' | 'warning' | 'danger' | 'neutral' | 'info';
  style?: StyleProp<ViewStyle>;
}

export function Pill({ label, tone = 'neutral', style }: PillProps) {
  const getStyle = () => {
    switch (tone) {
      case 'success':
        return { bg: colors.successSoft, text: colors.success };
      case 'warning':
        return { bg: colors.warningSoft, text: colors.warning };
      case 'danger':
        return { bg: colors.dangerSoft, text: colors.danger };
      case 'info':
        return { bg: colors.primarySoft, text: colors.primary };
      case 'neutral':
      default:
        return { bg: colors.surfaceMuted, text: colors.muted };
    }
  };

  const current = getStyle();

  return (
    <View style={[styles.pill, { backgroundColor: current.bg }, style]}>
      <Text style={[styles.pillText, { color: current.text }]}>{label}</Text>
    </View>
  );
}

export interface ScreenProps {
  children: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void | Promise<void>;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

export function Screen({
  children,
  refreshing,
  onRefresh,
  style,
  contentContainerStyle,
}: ScreenProps) {
  return (
    <ScrollView
      style={[{ flex: 1, backgroundColor: colors.background }, style]}
      contentContainerStyle={[styles.screenContent, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

export function SectionTitle({
  children,
  hint,
  style,
}: {
  children: React.ReactNode;
  hint?: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, style]}>{children}</Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
    </View>
  );
}

export function KeyValue({
  label,
  value,
  style,
}: {
  label: string;
  value: string | number | React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.keyValueRow, style]}>
      <Text style={styles.keyLabel}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text style={styles.keyValue}>{value}</Text>
      ) : (
        value
      )}
    </View>
  );
}

export function EmptyState({
  title,
  message,
  icon,
  style,
}: {
  title: string;
  message?: string;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.emptyWrap, style]}>
      {icon ? <View style={{ marginBottom: spacing.sm }}>{icon}</View> : null}
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyMessage}>{message}</Text> : null}
    </View>
  );
}

export function LoadingView({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.loadingWrap}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.loadingLabel}>{label}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screenContent: {
    padding: spacing.lg,
    paddingTop: spacing.xxl,
    gap: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnBase: {
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  btnIcon: {
    marginRight: spacing.xs,
  },
  btnPrimary: {
    backgroundColor: colors.primary,
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontSize: typography.body,
    fontWeight: '600',
  },
  btnSecondary: {
    backgroundColor: colors.primarySoft,
  },
  btnSecondaryText: {
    color: colors.primary,
    fontSize: typography.body,
    fontWeight: '600',
  },
  btnDanger: {
    backgroundColor: colors.danger,
  },
  btnDangerText: {
    color: '#FFFFFF',
    fontSize: typography.body,
    fontWeight: '600',
  },
  btnGhost: {
    backgroundColor: 'transparent',
  },
  btnGhostText: {
    color: colors.primary,
    fontSize: typography.small,
    fontWeight: '600',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  fieldWrap: {
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: typography.small,
    fontWeight: '600',
    color: colors.ink,
  },
  fieldInput: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: typography.body,
  },
  fieldInputDisabled: {
    backgroundColor: colors.surfaceMuted,
    color: colors.muted,
  },
  fieldInputError: {
    borderColor: colors.danger,
  },
  fieldError: {
    fontSize: typography.tiny,
    color: colors.danger,
  },
  noticeBase: {
    padding: spacing.md,
    borderRadius: radius.md,
  },
  noticeInfo: {
    backgroundColor: colors.primarySoft,
  },
  noticeInfoText: {
    color: colors.primary,
    fontSize: typography.small,
  },
  noticeSuccess: {
    backgroundColor: colors.successSoft,
  },
  noticeSuccessText: {
    color: colors.success,
    fontSize: typography.small,
  },
  noticeWarning: {
    backgroundColor: colors.warningSoft,
  },
  noticeWarningText: {
    color: colors.warning,
    fontSize: typography.small,
  },
  noticeDanger: {
    backgroundColor: colors.dangerSoft,
  },
  noticeDangerText: {
    color: colors.danger,
    fontSize: typography.small,
  },
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  pillText: {
    fontSize: typography.tiny,
    fontWeight: '600',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    fontSize: typography.heading,
    fontWeight: '700',
    color: colors.ink,
  },
  sectionHint: {
    fontSize: typography.tiny,
    color: colors.muted,
  },
  keyValueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  keyLabel: {
    fontSize: typography.small,
    color: colors.muted,
  },
  keyValue: {
    fontSize: typography.small,
    fontWeight: '600',
    color: colors.ink,
  },
  emptyWrap: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  emptyTitle: {
    fontSize: typography.body,
    fontWeight: '600',
    color: colors.ink,
  },
  emptyMessage: {
    fontSize: typography.small,
    color: colors.muted,
    textAlign: 'center',
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  loadingLabel: {
    fontSize: typography.body,
    color: colors.muted,
  },
});
