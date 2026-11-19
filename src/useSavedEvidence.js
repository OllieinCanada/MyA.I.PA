import { useCallback, useEffect, useRef, useState } from 'react';
import { createSavedEvidencePoller } from './features/admin/savedEvidencePolling';

const initial = { phase: 'checking', busy: false, lastSuccessAt: null, nextAttemptAt: null, reason: null };
export default function useSavedEvidence({ url, validate, intervalMs = 5000, auto = true, revision = '' }) {
  const key = JSON.stringify([url, revision]), controller = useRef(null);
  const [record, setRecord] = useState({ key: null, data: null });
  const [connection, setConnection] = useState({ key: null, ...initial });
  useEffect(() => {
    const poller = createSavedEvidencePoller({ url, validate, intervalMs, auto,
      visible: () => document.visibilityState !== 'hidden', online: () => navigator.onLine !== false,
      onData: data => setRecord({ key, data }), onState: state => setConnection({ key, ...state }) });
    controller.current = poller;
    const sync = () => poller.sync();
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('online', sync); window.addEventListener('offline', sync); window.addEventListener('focus', sync);
    poller.start();
    return () => {
      poller.stop(); if (controller.current === poller) controller.current = null;
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('online', sync); window.removeEventListener('offline', sync); window.removeEventListener('focus', sync);
    };
  }, [url, validate, intervalMs, auto, key]);
  const load = useCallback(() => controller.current?.refresh(), []);
  const pause = useCallback(() => controller.current?.pause(), []);
  const resume = useCallback(() => controller.current?.resume(), []);
  const setData = useCallback(update => setRecord(current => ({ key,
    data: typeof update === 'function' ? update(current.key === key ? current.data : null) : update })), [key]);
  return { data: record.key === key ? record.data : null, setData, load, pause, resume,
    state: connection.key === key ? connection : initial,
    busy: connection.key === key && connection.busy,
    error: connection.key === key && (Boolean(connection.reason) || ['retrying', 'auth_required', 'offline'].includes(connection.phase)) };
}
