import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { AppButton, Field, Notice, Screen } from '../../components/ui';
import { colors, spacing, typography } from '../../constants/theme';
import { useAuth, friendlyAuthError } from '../../contexts/AuthContext';

export default function ForgotPasswordScreen() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError(null);
    setMessage(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      await resetPassword(email);
      setMessage('Password reset email sent. Check your inbox and spam folder.');
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
          <Text style={styles.title}>Reset your password</Text>
          <Text style={styles.subtitle}>
            Enter the email address you registered with. Firebase will send a secure reset link.
          </Text>
        </View>
        <View style={styles.form}>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoComplete="email"
          />
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {message ? <Notice tone="success">{message}</Notice> : null}
          <AppButton label="Send reset link" onPress={handleSubmit} loading={loading} />
          <Link href="/(auth)/login" style={styles.link}>
            Back to sign in
          </Link>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { marginTop: spacing.xxl, gap: spacing.sm },
  title: { fontSize: typography.title, fontWeight: '700', color: colors.ink },
  subtitle: { fontSize: typography.small, color: colors.muted, lineHeight: 20 },
  form: { gap: spacing.md, marginTop: spacing.lg },
  link: { color: colors.primary, fontSize: typography.small, textAlign: 'center' },
});
