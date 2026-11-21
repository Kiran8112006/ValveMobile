import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { apiRequest, getApiBase } from '../services/api';
import { auth } from '../services/firebase';
import type { CustomerOverview, Device, DispensingSession, RealtimeMessage, Transaction, PricingConfig } from '../types/domain';
import { useAuth } from './AuthContext';

type SocketStatus = 'connecting' | 'open' | 'closed';

interface RealtimeContextValue {
  socketStatus: SocketStatus;
  balanceMl: number | null;
  totalEstimatedDispensedMl: number | null;
  session: DispensingSession | null;
  device: Device | null;
  lastConfirmedAt: number | null;
  /** Increments on every realtime message so admin screens can refetch. */
  eventTick: number;
  refresh: () => Promise<void>;
  setSession: (session: DispensingSession | null) => void;
  /** Additional data for admin/customer screens */
  recentSessions: DispensingSession[];
  recentTransactions: Transaction[];
  devices: Device[];
  pricing: PricingConfig;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

function socketUrl(): string | null {
  const base = getApiBase();
  if (!base) return null;
  return `${base.replace(/^http/, 'ws')}/ws`;
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user, role } = useAuth();
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('closed');
  const [balanceMl, setBalanceMl] = useState<number | null>(null);
  const [totalEstimatedDispensedMl, setTotal] = useState<number | null>(null);
  const [session, setSession] = useState<DispensingSession | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [lastConfirmedAt, setLastConfirmedAt] = useState<number | null>(null);
  const [eventTick, setEventTick] = useState(0);
  const [reconnectKey, setReconnectKey] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const [recentSessions, setRecentSessions] = useState<DispensingSession[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pricing, setPricing] = useState<PricingConfig>({ configured: false });

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const overview = await apiRequest<CustomerOverview>('/api/customer/overview');
      setBalanceMl(overview.profile.balanceMl);
      setTotal(overview.profile.totalEstimatedDispensedMl);
      setSession(overview.session);
      setDevice(overview.device);
      setLastConfirmedAt(Date.now());
      setRecentSessions((overview as any).recentSessions ?? []);
      setRecentTransactions(overview.recentTransactions ?? []);
      setDevices((overview as any).devices ?? (overview.device ? [overview.device] : []));
      setPricing(overview.pricing ?? { configured: false });
    } catch {
      /* transient network errors leave the last known state in place */
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setBalanceMl(null);
      setTotal(null);
      setSession(null);
      setDevice(null);
      setRecentSessions([]);
      setRecentTransactions([]);
      setDevices([]);
      setPricing({ configured: false });
      setSocketStatus('closed');
      return;
    }
    void refresh();
  }, [user, refresh]);

  useEffect(() => {
    if (!user) return;
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const scheduleReconnect = () => {
      if (stopped) return;
      const delay = Math.min(1000 * 2 ** attempt, 15_000);
      attempt += 1;
      retryTimer = setTimeout(connect, delay);
    };

    const handleMessage = (raw: string) => {
      let message: RealtimeMessage;
      try {
        message = JSON.parse(raw) as RealtimeMessage;
      } catch {
        return;
      }
      setEventTick((tick) => tick + 1);
      switch (message.type) {
        case 'ready':
          setSocketStatus('open');
          void refresh();
          break;
        case 'balance':
          setBalanceMl(Number(message.balanceMl ?? 0));
          setTotal(Number(message.totalEstimatedDispensedMl ?? 0));
          break;
        case 'session':
          setSession((message.session as DispensingSession | null) ?? null);
          break;
        case 'device':
          if (role === 'customer' || message.device) {
            setDevice((message.device as Device | null) ?? null);
          }
          break;
        case 'dispensing': {
          setLastConfirmedAt(Date.now());
          const sessionId = message.sessionId as string | null;
          const quantityMl = Number(message.quantityMl ?? 0);
          const consumedMl = Number(message.consumedMl ?? 0);
          const remainingAuthorizedMl = Number(message.remainingAuthorizedMl ?? 0);
          setSession((current) => {
            if (!current || current.sessionId !== sessionId) return current;
            return {
              ...current,
              consumedMl,
              remainingAuthorizedMl,
              authorizedMl: current.authorizedMl,
              status:
                remainingAuthorizedMl <= 0 ? 'completed' : current.status,
            };
          });
          void quantityMl;
          break;
        }
        case 'payment':
          if (role === 'customer') void refresh();
          break;
        default:
          break;
      }
    };

    async function connect() {
      if (stopped) return;
      const base = socketUrl();
      const token = await auth.currentUser?.getIdToken();
      if (!base || !token) {
        setSocketStatus('closed');
        scheduleReconnect();
        return;
      }
      setSocketStatus('connecting');
      try {
        const socket = new WebSocket(`${base}?token=${encodeURIComponent(token)}`);
        socketRef.current = socket;
        socket.onopen = () => {
          attempt = 0;
          setSocketStatus('open');
        };
        socket.onmessage = (event) => handleMessage(String(event.data));
        socket.onerror = () => {
          /* close handler performs the retry */
        };
        socket.onclose = () => {
          if (socketRef.current === socket) socketRef.current = null;
          if (stopped) return;
          setSocketStatus('closed');
          scheduleReconnect();
        };
      } catch {
        setSocketStatus('closed');
        scheduleReconnect();
      }
    }

    void connect();

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          setReconnectKey((key) => key + 1);
        }
        void refresh();
      }
    });

    return () => {
      stopped = true;
      appStateSubscription.remove();
      if (retryTimer) clearTimeout(retryTimer);
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      setSocketStatus('closed');
    };
  }, [user, role, refresh, reconnectKey]);

  return (
    <RealtimeContext.Provider
      value={{
        socketStatus,
        balanceMl,
        totalEstimatedDispensedMl,
        session,
        device,
        lastConfirmedAt,
        eventTick,
        refresh,
        setSession,
        recentSessions,
        recentTransactions,
        devices,
        pricing,
      }}
    >
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime(): RealtimeContextValue {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error('useRealtime must be used inside RealtimeProvider');
  return context;
}