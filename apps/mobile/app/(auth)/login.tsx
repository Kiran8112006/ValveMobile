import { Link } from 'expo-router';
import { Droplets } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { AppButton, Field, Notice, Screen } from '../../components/ui';
import { colors, radius, spacing, typography } from '../../constants/theme';
import { useAuth, friendlyAuthError } from '../../contexts/AuthContext';
import { API_BASE } from '../../services/api';
import { firebaseConfigured } from '../../services/firebase';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const configMissing = !firebaseConfigured || !API_BASE;

  async function handleSubmit() {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await signIn(email, password);
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
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Droplets size={30} color={colors.primary} />
          </View>
          <Text style={styles.title}>Valve</Text>
          <Text style={styles.subtitle}>Prepaid water, under your control.</Text>
        </View>

        {configMissing ? (
          <Notice tone="warning">
            Firebase or backend configuration is missing. Add the public values to
            apps/mobile/.env, then rebuild the app.
          </Notice>
        ) : null}

        <View style={styles.form}>
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
            placeholder="Your password"
            secure
            autoComplete="password"
          />
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <AppButton label="Sign in" onPress={handleSubmit} loading={loading} />
          <Link href="/(auth)/forgot-password" style={styles.link}>
            Forgot password?
          </Link>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>New to Valve?</Text>
          <Link href="/(auth)/register" style={styles.linkStrong}>
            Create an account
          </Link>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', marginTop: spacing.xxl, gap: spacing.sm },
  logo: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: typography.title, fontWeight: '700', color: colors.ink },
  subtitle: { fontSize: typography.body, color: colors.muted },
  form: { gap: spacing.md, marginTop: spacing.md },
  link: { color: colors.primary, fontSize: typography.small, textAlign: 'center' },
  linkStrong: { color: colors.primary, fontWeight: '600', fontSize: typography.body },
  footer: {
    marginTop: 'auto',
    paddingVertical: spacing.xl,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  footerText: { color: colors.muted, fontSize: typography.body },
});
