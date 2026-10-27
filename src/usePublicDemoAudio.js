import { useEffect, useRef, useState } from 'react';
import { getSafeFailedAsset, getSafeMediaFailureDetails, reportClientError } from './clientErrorReporter';

// Only public, pre-recorded demo audio. Never opens a microphone or a live call.
export default function usePublicDemoAudio(audioRef, fallbackSource) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const state = useRef({ alive: true, generation: 0, requested: false, pending: false, fallback: false, reported: false, primary: '' });

  useEffect(() => {
    const audio = audioRef.current;
    state.current.alive = true;
    return () => {
      state.current.alive = false;
      state.current.generation++;
      state.current.requested = false;
      audio?.pause();
    };
  }, [audioRef]);

  const fail = (audio, failure) => {
    if (!state.current.alive) return;
    state.current.generation++;
    state.current.requested = false;
    state.current.pending = false;
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
    const generation = ++state.current.generation;
    state.current.requested = true;
    state.current.pending = true;
    setError(''); setLoading(true);
    try {
      await audio.play();
      if (state.current.alive && state.current.requested && generation === state.current.generation) {
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
  const onPlaying = () => { if (state.current.alive && state.current.requested) { state.current.pending = false; setError(''); setPlaying(true); setLoading(false); } };
  const onPause = () => { if (state.current.alive && !state.current.pending) { state.current.requested = false; setPlaying(false); } };
  const onEnded = () => { state.current.requested = false; state.current.pending = false; setPlaying(false); setLoading(false); };
  return { playing, loading, error, toggle, onError, onPlaying, onPause, onEnded };
}
