import React, { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import usePublicDemoAudio from './usePublicDemoAudio';
import { reportClientError } from './clientErrorReporter';
jest.mock('./clientErrorReporter', () => ({ ...jest.requireActual('./clientErrorReporter'), reportClientError: jest.fn() }));

function Fixture() {
  const ref = useRef(null);
  const playback = usePublicDemoAudio(ref, '/tims-electrical-2.wav');
  return <><button onClick={playback.toggle}>{playback.loading ? 'Cancel loading' : playback.playing ? 'Pause' : 'Play'}</button>
    <p role="status">{playback.error}</p>
    <audio ref={ref} data-public-demo-source="/tims-electrical-2.mp3" preload="none" data-public-demo-audio="managed"
      onError={playback.onError} onPlaying={playback.onPlaying} onPause={playback.onPause} onEnded={playback.onEnded} /></>;
}

describe('public demo playback recovery', () => {
  let root, container, audio, button;
  const click = async () => act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks();
    HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue(undefined);
    HTMLMediaElement.prototype.pause = jest.fn();
    HTMLMediaElement.prototype.load = jest.fn(function () { Object.defineProperty(this, 'error', { configurable: true, value: null }); });
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root.render(<Fixture />)); audio = container.querySelector('audio'); button = container.querySelector('button');
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); jest.useRealTimers(); });

  test('does not autoplay or preload the large recording', () => {
    expect(audio.preload).toBe('none'); expect(audio.hasAttribute('src')).toBe(false);
    expect(audio.dataset.publicDemoSource).toMatch(/\.mp3$/);
    expect(audio.play).not.toHaveBeenCalled();
  });
  test('a deliberate click assigns the preferred source before playing', async () => {
    await click(); expect(audio.src).toMatch(/\.mp3$/);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });
  test('an unsupported preferred format falls back once without a false terminal alert', async () => {
    audio.play.mockRejectedValueOnce(new DOMException('unsupported', 'NotSupportedError')).mockResolvedValueOnce(undefined);
    await click();
    expect(audio.src).toMatch(/\.wav$/); expect(audio.play).toHaveBeenCalledTimes(2);
    expect(button.textContent).toBe('Pause'); expect(reportClientError).not.toHaveBeenCalled();
  });
  test('two failed formats show retry guidance and emit only one redacted failure report', async () => {
    audio.play.mockImplementation(async () => {
      Object.defineProperty(audio, 'paused', { configurable: true, value: false });
      throw new DOMException('private URL must not be reported', 'NotSupportedError');
    });
    audio.pause.mockImplementation(() => Object.defineProperty(audio, 'paused', { configurable: true, value: true }));
    await click();
    expect(audio.play).toHaveBeenCalledTimes(2); expect(reportClientError).toHaveBeenCalledTimes(1);
    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(container.textContent).toMatch(/could not play.*retry/i);
    expect(JSON.stringify(reportClientError.mock.calls)).not.toContain('private URL');
    audio.play.mockResolvedValueOnce(undefined);
    await click();
    expect(audio.src).toMatch(/\.mp3$/); expect(button.textContent).toBe('Pause');
  });
  test('browser permission denial stays visible but does not trigger a format loop or outage alert', async () => {
    audio.play.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'));
    await click(); expect(audio.play).toHaveBeenCalledTimes(1);
    expect(container.textContent).toMatch(/browser blocked playback/i); expect(reportClientError).not.toHaveBeenCalled();
    await click(); expect(button.textContent).toBe('Pause');
  });
  test('cancelling a pending play ignores its later abort rather than starting fallback', async () => {
    let reject;
    audio.play.mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no; }));
    await click(); expect(button.textContent).toBe('Cancel loading');
    await click();
    await act(async () => reject(new DOMException('cancelled', 'AbortError')));
    expect(button.textContent).toBe('Play'); expect(audio.play).toHaveBeenCalledTimes(1);
    expect(reportClientError).not.toHaveBeenCalled();
  });
  test('an error event and stale play rejection cannot start two fallbacks', async () => {
    let reject;
    audio.play.mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no; })).mockResolvedValueOnce(undefined);
    await click();
    Object.defineProperty(audio, 'error', { configurable: true, value: { code: 4 } });
    await act(async () => audio.dispatchEvent(new Event('error', { bubbles: false })));
    await act(async () => reject(new DOMException('old source', 'NotSupportedError')));
    expect(audio.play).toHaveBeenCalledTimes(2); expect(button.textContent).toBe('Pause');
    expect(reportClientError).not.toHaveBeenCalled();
  });
  test('a browser pause updates the control and permits a new deliberate play', async () => {
    await click(); act(() => audio.dispatchEvent(new Event('pause')));
    expect(button.textContent).toBe('Play'); await click(); expect(audio.play).toHaveBeenCalledTimes(2);
  });
  test('a queued pause event from an earlier source cannot cancel audio that is now playing', async () => {
    await click();
    Object.defineProperty(audio, 'paused', { configurable: true, value: false });
    act(() => audio.dispatchEvent(new Event('pause')));
    expect(button.textContent).toBe('Pause');
    act(() => audio.dispatchEvent(new Event('playing')));
    expect(audio.pause).not.toHaveBeenCalled();
  });
  test('a stalled preferred download tries the backup format and clears loading after recovery', async () => {
    jest.useFakeTimers();
    audio.play.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(undefined);
    await click();
    expect(button.textContent).toBe('Cancel loading');
    await act(async () => jest.advanceTimersByTime(15000));
    expect(audio.src).toMatch(/\.wav$/);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(button.textContent).toBe('Pause');
    expect(reportClientError).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(30000));
    expect(audio.play).toHaveBeenCalledTimes(2);
  });
  test('two stalled downloads stop loading, report once and allow a fresh one-tap retry', async () => {
    jest.useFakeTimers();
    audio.play.mockImplementation(() => new Promise(() => {}));
    await click();
    await act(async () => jest.advanceTimersByTime(15000));
    await act(async () => jest.advanceTimersByTime(15000));
    expect(button.textContent).toBe('Play');
    expect(container.textContent).toMatch(/could not play.*retry/i);
    expect(reportClientError).toHaveBeenCalledTimes(1);
    audio.play.mockResolvedValueOnce(undefined);
    await click();
    expect(audio.src).toMatch(/\.mp3$/);
    expect(button.textContent).toBe('Pause');
  });
  test('cancelled loading cannot resume from a late playing event or timeout', async () => {
    jest.useFakeTimers();
    audio.play.mockImplementationOnce(() => new Promise(() => {}));
    audio.pause.mockImplementation(() => Object.defineProperty(audio, 'paused', { configurable: true, value: true }));
    await click();
    await click();
    Object.defineProperty(audio, 'paused', { configurable: true, value: false });
    act(() => audio.dispatchEvent(new Event('playing')));
    expect(audio.paused).toBe(true);
    await act(async () => jest.advanceTimersByTime(30000));
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe('Play');
    expect(reportClientError).not.toHaveBeenCalled();
  });
  test('leaving the page cancels a pending start without fallback or error reporting', async () => {
    jest.useFakeTimers();
    let resolve;
    audio.play.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await click();
    act(() => root.render(null));
    await act(async () => { jest.advanceTimersByTime(30000); resolve(); });
    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(reportClientError).not.toHaveBeenCalled();
  });
});
