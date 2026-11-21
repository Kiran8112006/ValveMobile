import { Link, router } from 'expo-router';
import { Check, Droplets } from 'lucide-react-native';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AppButton, Field, Notice, Screen } from '../../components/ui';
import { colors, radius, spacing, typography } from '../../constants/theme';
import { useAuth, friendlyAuthError } from '../../contexts/AuthContext';

const rules = [
  { key: 'length', label: 'At least 8 characters', test: (value: string) => value.length >= 8 },
  { key: 'upper', label: 'One uppercase letter', test: (value: string) => /[A-Z]/.test(value) },
  { key: 'lower', label: 'One lowercase letter', test: (value: string) => /[a-z]/.test(value) },
  { key: 'number', label: 'One number', test: (value: string) => /\d/.test(value) },
];

export default function RegisterScreen() {
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const checks = rules.map((rule) => ({ ...rule, passed: rule.test(password) }));
  const strongEnough = checks.every((rule) => rule.passed);

  async function handleSubmit() {
    setError(null);
    if (fullName.trim().length < 2) {
      setError('Enter your full name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    if (!strongEnough) {
      setError('Your password does not meet all requirements yet.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (!accepted) {
      setError('Accept the terms of use to continue.');
      return;
    }
    setLoading(true);
    try {
      await signUp(fullName, email, password);
      router.replace('/(tabs)');
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen>
        <View style={styles.header}>
          <View style={styles.logo}>
            <Droplets size={24} color={colors.primary} />
          </View>
          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.subtitle}>Every new account starts with a customer role.</Text>
        </View>

        <View style={styles.form}>
          <Field
            label="Full name"
            value={fullName}
            onChangeText={setFullName}
            placeholder="Your name"
            autoCapitalize="words"
            autoComplete="name"
          />
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoComplete="email"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Create a password"
            secure
            autoComplete="password"
          />
          <View style={styles.rules}>
            {checks.map((rule) => (
              <View key={rule.key} style={styles.rule}>
                <View style={[styles.ruleDot, rule.passed && styles.ruleDotPassed]}>
                  {rule.passed ? <Check size={12} color="#FFFFFF" /> : null}
                </View>
                <Text style={[styles.ruleText, rule.passed && styles.ruleTextPassed]}>
                  {rule.label}
                </Text>
              </View>
            ))}
          </View>
          <Field
            label="Confirm password"
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Repeat your password"
            secure
            autoComplete="password"
            error={confirm.length > 0 && confirm !== password ? 'Passwords do not match.' : undefined}
          />

          <Pressable
            onPress={() => setAccepted((value) => !value)}
            style={styles.terms}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: accepted }}
          >
            <View style={[styles.checkbox, accepted && styles.checkboxChecked]}>
              {accepted ? <Check size={14} color="#FFFFFF" /> : null}
            </View>
            <Text style={styles.termsText}>
              I accept the terms of use and understand that consumption is estimated from
              valve-open time, not measured by a flow sensor.
            </Text>
          </Pressable>

          {error ? <Notice tone="danger">{error}</Notice> : null}
          <AppButton label="Create account" onPress={handleSubmit} loading={loading} />
          <Text style={styles.verificationNote}>
            We will send a verification email. You can resend it later from your profile.
          </Text>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account?</Text>
          <Link href="/(auth)/login" style={styles.link}>
            Sign in
          </Link>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { marginTop: spacing.xl, gap: spacing.xs },
  logo: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: { fontSize: typography.title, fontWeight: '700', color: colors.ink },
  subtitle: { fontSize: typography.small, color: colors.muted },
  form: { gap: spacing.md, marginTop: spacing.md },
  rules: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rule: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, width: '46%' },
  ruleDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ruleDotPassed: { backgroundColor: colors.success },
  ruleText: { fontSize: typography.tiny, color: colors.muted },
  ruleTextPassed: { color: colors.success },
  terms: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  termsText: { flex: 1, fontSize: typography.tiny, color: colors.muted, lineHeight: 18 },
  verificationNote: { fontSize: typography.tiny, color: colors.faint, textAlign: 'center' },
  footer: {
    marginTop: 'auto',
    paddingVertical: spacing.xl,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  footerText: { color: colors.muted, fontSize: typography.body },
  link: { color: colors.primary, fontWeight: '600', fontSize: typography.body },
});
