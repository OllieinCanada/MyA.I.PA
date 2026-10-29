import { useEffect, useRef, useState } from 'react';
import { getSafeFailedAsset, getSafeMediaFailureDetails, reportClientError } from './clientErrorReporter';

const PLAYBACK_START_TIMEOUT_MS = 15000;

// Only public, pre-recorded demo audio. Never opens a microphone or a live call.
export default function usePublicDemoAudio(audioRef, fallbackSource) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const state = useRef({ alive: true, generation: 0, requested: false, pending: false, fallback: false, reported: false, primary: '', startupTimer: null });

  const clearStartupTimer = () => {
    clearTimeout(state.current.startupTimer);
    state.current.startupTimer = null;
  };

  useEffect(() => {
    const audio = audioRef.current;
    state.current.alive = true;
    return () => {
      state.current.alive = false;
      state.current.generation++;
      state.current.requested = false;
      clearTimeout(state.current.startupTimer);
      audio?.pause();
    };
  }, [audioRef]);

  const fail = (audio, failure) => {
    if (!state.current.alive) return;
    clearStartupTimer();
    state.current.generation++;
    state.current.requested = false;
    state.current.pending = false;
    // Some engines leave paused=false after a sink/decoder error. Stop the
    // failed element so the next tap retries instead of only pausing it.
    audio.pause();
    setPlaying(false); setLoading(false);
    const blocked = failure?.name === 'NotAllowedError';
    setError(blocked
      ? 'Your browser blocked playback. Tap Hear Live Call to try again.'
      : 'The sample could not play. Tap Hear Live Call to retry, or choose See the Full Demo to read it.');
    // A denied autoplay permission is not a broken audio asset. Only report
    // terminal media failures, after the alternate format was also attempted.
    if (!blocked && !state.current.reported) {
      state.current.reported = true;
      void reportClientError({ type: 'resource_error', component: 'audio',
        message: `audio resource failed to load: ${getSafeFailedAsset(audio)}${getSafeMediaFailureDetails(audio)}; public demo fallback exhausted` });
    }
  };

  const start = async (audio) => {
    clearStartupTimer();
    const generation = ++state.current.generation;
    state.current.requested = true;
    state.current.pending = true;
    setError(''); setLoading(true);
    // A media request can stall without rejecting play() or emitting an error.
    // Bound each format attempt and keep cancellation effective while waiting.
    state.current.startupTimer = setTimeout(() => {
      if (!state.current.alive || !state.current.requested || !state.current.pending
        || generation !== state.current.generation) return;
      audio.pause();
      if (!state.current.fallback && fallbackSource) playFallback(audio);
      else fail(audio, { name: 'TimeoutError' });
    }, PLAYBACK_START_TIMEOUT_MS);
    try {
      await audio.play();
      if (state.current.alive && state.current.requested && generation === state.current.generation) {
        clearStartupTimer();
        state.current.pending = false;
        setPlaying(true); setLoading(false);
      }
    } catch (failure) {
      if (!state.current.alive || generation !== state.current.generation || !state.current.requested) return;
      if (failure?.name !== 'NotAllowedError' && !state.current.fallback && fallbackSource) {
        playFallback(audio);
      } else fail(audio, failure);
    }
  };

  const playFallback = (audio) => {
    state.current.fallback = true;
    // src is deliberately managed through this ref after the first failure.
    // The React data attribute retains the preferred format on a fresh mount.
    audio.src = fallbackSource;
    audio.load();
    void start(audio);
  };

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (state.current.requested || (!audio.paused && !audio.ended)) {
      state.current.generation++;
      state.current.requested = false;
      state.current.pending = false;
      clearStartupTimer();
      audio.pause(); setPlaying(false); setLoading(false);
      return;
    }
    if (!state.current.primary) state.current.primary = audio.dataset.publicDemoSource || audio.src;
    if (!audio.getAttribute('src')) audio.src = state.current.primary;
    if (state.current.reported) {
      state.current.fallback = false;
      audio.src = state.current.primary;
      audio.load();
    } else if (audio.error) audio.load();
    state.current.reported = false;
    if (audio.ended) audio.currentTime = 0;
    void start(audio);
  };

  const onError = () => {
    const audio = audioRef.current;
    if (!audio?.error || !state.current.alive || !state.current.requested) return;
    if (state.current.requested && !state.current.fallback && fallbackSource) playFallback(audio);
    else fail(audio, audio.error);
  };
  const onPlaying = () => {
    // Late media events must not undo a deliberate cancellation or unmount.
    if (!state.current.alive || !state.current.requested) {
      audioRef.current?.pause();
      return;
    }
    clearStartupTimer();
    state.current.pending = false; setError(''); setPlaying(true); setLoading(false);
  };
  const onPause = () => {
    // A queued event may describe the previous source after a new one starts.
    if (!state.current.alive || state.current.pending || audioRef.current?.paused === false) return;
    state.current.requested = false; setPlaying(false);
  };
  const onEnded = () => { clearStartupTimer(); state.current.requested = false; state.current.pending = false; setPlaying(false); setLoading(false); };
  return { playing, loading, error, toggle, onError, onPlaying, onPause, onEnded };
}
