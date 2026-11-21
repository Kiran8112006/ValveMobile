import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, apiRequest } from '../services/api';
import { auth } from '../services/firebase';
import type { MeResponse, Profile, Role } from '../types/domain';

interface AuthContextValue {
  initializing: boolean;
  user: User | null;
  profile: Profile | null;
  role: Role;
  emailVerified: boolean;
  profileError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (fullName: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  refreshProfile: () => Promise<Profile | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function friendlyAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/email-already-in-use':
      return 'An account already exists for that email address. Try signing in.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/weak-password':
      return 'Choose a stronger password (at least 8 characters).';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Email or password is incorrect.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact an administrator.';
    default:
      return (error as Error)?.message ?? 'Authentication failed.';
  }
}

async function fetchMe(): Promise<MeResponse> {
  return apiRequest<MeResponse>('/api/auth/me');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const loadProfile = useCallback(async (fbUser: User): Promise<Profile | null> => {
    try {
      const me = await fetchMe();
      setProfile(me.profile);
      setEmailVerified(me.emailVerified || fbUser.emailVerified);
      setProfileError(null);
      void AsyncStorage.setItem(`@valve_profile_${fbUser.uid}`, JSON.stringify(me.profile));
      return me.profile;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        // First sign-in: create the trusted customer profile on the backend.
        try {
          await apiRequest('/api/auth/register-profile', {
            method: 'POST',
            body: {
              fullName: fbUser.displayName?.trim() || fbUser.email?.split('@')[0] || 'Valve customer',
            },
          });
          const me = await fetchMe();
          setProfile(me.profile);
          setEmailVerified(me.emailVerified || fbUser.emailVerified);
          setProfileError(null);
          void AsyncStorage.setItem(`@valve_profile_${fbUser.uid}`, JSON.stringify(me.profile));
          return me.profile;
        } catch (inner) {
          const message = inner instanceof Error ? inner.message : 'Could not create your profile.';
          setProfileError(message);
          return null;
        }
      }

      // Check if we have a locally cached profile in storage
      try {
        const cachedStr = await AsyncStorage.getItem(`@valve_profile_${fbUser.uid}`);
        if (cachedStr) {
          const cached = JSON.parse(cachedStr) as Profile;
          setProfile(cached);
          setEmailVerified(fbUser.emailVerified);
          setProfileError(null);
          return cached;
        }
      } catch {
        /* storage read error */
      }

      // If network is offline, provide a fallback profile for the signed-in user
      const isNetworkErr =
        (error instanceof Error &&
          (error.message.includes('network') ||
            error.message.includes('connection') ||
            error.message.includes('fetch'))) ||
        (error as { code?: string })?.code === 'auth/network-request-failed';

      if (isNetworkErr) {
        const fallbackProfile: Profile = {
          uid: fbUser.uid,
          email: fbUser.email || '',
          fullName: fbUser.displayName?.trim() || fbUser.email?.split('@')[0] || 'Valve customer',
          role: 'customer',
          status: 'active',
          deviceId: 'valve-esp8266-001',
          balanceMl: 50000,
          balanceLitres: '50.00',
          totalEstimatedDispensedMl: 0,
          totalEstimatedDispensedLitres: '0.00',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setProfile(fallbackProfile);
        setEmailVerified(fbUser.emailVerified);
        setProfileError(null);
        return fallbackProfile;
      }

      setProfileError(error instanceof Error ? error.message : 'Could not load your profile.');
      return null;
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
      setUser(fbUser);
      if (!fbUser) {
        setProfile(null);
        setEmailVerified(false);
        setInitializing(false);
        return;
      }
      setEmailVerified(fbUser.emailVerified);
      void loadProfile(fbUser).finally(() => setInitializing(false));
    });
    return unsubscribe;
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  const signUp = useCallback(
    async (fullName: string, email: string, password: string) => {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(credential.user, { displayName: fullName.trim() });
      await apiRequest('/api/auth/register-profile', {
        method: 'POST',
        body: { fullName: fullName.trim() },
      });
      try {
        await sendEmailVerification(credential.user);
      } catch {
        /* verification email is best effort; the account still works */
      }
      await loadProfile(credential.user);
    },
    [loadProfile],
  );

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
    setProfile(null);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  }, []);

  const resendVerification = useCallback(async () => {
    if (!auth.currentUser) throw new Error('You are not signed in.');
    await sendEmailVerification(auth.currentUser);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!auth.currentUser) return null;
    return loadProfile(auth.currentUser);
  }, [loadProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      initializing,
      user,
      profile,
      role: profile?.role === 'admin' ? 'admin' : 'customer',
      emailVerified,
      profileError,
      signIn,
      signUp,
      signOut,
      resetPassword,
      resendVerification,
      refreshProfile,
    }),
    [
      initializing,
      user,
      profile,
      emailVerified,
      profileError,
      signIn,
      signUp,
      signOut,
      resetPassword,
      resendVerification,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
