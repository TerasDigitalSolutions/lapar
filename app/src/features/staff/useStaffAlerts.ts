import { useCallback, useEffect, useRef, useState } from 'react';
import type { PendingOrderDTO, ServiceRequestDTO } from '../../data/types';
import { isAudioRunning, onAudioStateChange, playCallAlert, playOrderAlert, unlockAudio, vibrate } from '../../lib/audio';

const REPEAT_MS = 30_000;

/**
 * Sound and vibration for new pending orders and server calls (different sounds), repeated every
 * 30 s while any is unhandled. Returns whether sound works and a function to enable it (needs a tap).
 */
export function useStaffAlerts(pending: PendingOrderDTO[] | null, calls: ServiceRequestDTO[] | null) {
  const [soundOn, setSoundOn] = useState(isAudioRunning);
  const seenOrders = useRef<Set<string> | null>(null);
  const seenCalls = useRef<Map<string, string> | null>(null);
  const pendingCount = pending?.length ?? 0;
  const openCallCount = calls?.filter((c) => c.status === 'open').length ?? 0;

  const alertOrder = useCallback(() => (playOrderAlert(), vibrate([200, 100, 200])), []);
  const alertCall = useCallback(() => (playCallAlert(), vibrate(500)), []);

  useEffect(() => {
    if (!pending) return;
    const prev = seenOrders.current;
    seenOrders.current = new Set(pending.map((o) => o.orderId));
    if (prev && pending.some((o) => !prev.has(o.orderId))) alertOrder();
  }, [pending, alertOrder]);

  useEffect(() => {
    if (!calls) return;
    const prev = seenCalls.current;
    seenCalls.current = new Map(calls.filter((c) => c.status === 'open').map((c) => [c.id, c.updatedAt]));
    // A new call, or a new tap on an open one (updatedAt changed), alerts again.
    if (prev && calls.some((c) => c.status === 'open' && prev.get(c.id) !== c.updatedAt)) alertCall();
  }, [calls, alertCall]);

  useEffect(() => {
    if (pendingCount + openCallCount === 0) return;
    const id = setInterval(() => {
      if (pendingCount > 0) alertOrder();
      if (openCallCount > 0) alertCall();
    }, REPEAT_MS);
    return () => clearInterval(id);
  }, [pendingCount, openCallCount, alertOrder, alertCall]);

  useEffect(() => onAudioStateChange(() => setSoundOn(isAudioRunning())), []);

  const enable = useCallback(async () => setSoundOn(await unlockAudio()), []);
  return { soundOn, enable };
}
