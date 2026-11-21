import { useEffect, useRef, useState } from 'react';
import type { Device, DispensingSession } from '../types/domain';

/**
 * Smooth local estimate for the current session.
 *
 * The backend is authoritative: it commits integer millilitres at each
 * completed cycle. While the valve is open we add a provisional amount based on
 * elapsed time since the last confirmed event, capped to one cycle so the
 * display never runs away from the device. It is always labelled as estimated.
 */
export function useLiveEstimate(
  session: DispensingSession | null,
  device: Device | null,
  lastConfirmedAt: number | null,
): number {
  const [displayMl, setDisplayMl] = useState(session?.consumedMl ?? 0);
  const displayRef = useRef(displayMl);

  useEffect(() => {
    const confirmed = session?.consumedMl ?? 0;
    displayRef.current = confirmed;
    setDisplayMl(confirmed);
  }, [session?.sessionId]);

  useEffect(() => {
    const interval = setInterval(() => {
      const confirmed = session?.consumedMl ?? 0;
      let target = confirmed;
      const valveOpen =
        device?.valveState === 'opening' && session?.status === 'active';
      if (valveOpen && lastConfirmedAt) {
        const provisional = Math.min(Date.now() - lastConfirmedAt, 950);
        const remaining = Math.max(session?.remainingAuthorizedMl ?? 0, 0);
        target = confirmed + Math.min(Math.max(provisional, 0), remaining);
      }
      const current = displayRef.current;
      const next = current + (target - current) * 0.45;
      displayRef.current = next;
      setDisplayMl(next);
    }, 250);
    return () => clearInterval(interval);
  }, [session?.consumedMl, session?.remainingAuthorizedMl, session?.status, device?.valveState, lastConfirmedAt]);

  return displayMl;
}
