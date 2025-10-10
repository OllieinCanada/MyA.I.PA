import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { Container, PlayerCard, Title, Controls, PlayButton, Time, WaveHost } from "./styles";
export default function Contact() {
  const waveRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);

  // same-origin file to avoid CORS
  const SRC = "/voice.m4a";


  useEffect(() => {
    if (!waveRef.current) return;

    const ws = WaveSurfer.create({
      container: waveRef.current,
      url: SRC,
      height: 100,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      waveColor: "#3b82f6",
      progressColor: "#a78bfa",
      cursorWidth: 0,
      normalize: true,
      interact: true,
    });

    wsRef.current = ws;

    ws.on("ready", () => {
      setDur(ws.getDuration());
      setReady(true);
    });
    ws.on("timeupdate", (t) => setTime(t));
    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("finish", () => setPlaying(false));
    ws.on("error", (e) => {
      if (waveRef.current) {
        waveRef.current.innerHTML =
          `<div style="color:#fca5a5;padding:8px">WaveSurfer error: ${String(e)}</div>`;
      }
      console.error("WaveSurfer error", e);
    });

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, []);

  const toggle = () => {
    const ws = wsRef.current;
    if (!ws) return;
    playing ? ws.pause() : ws.play();
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <Container>
      <PlayerCard>
        <Title>Tim's Electrical Services DEMO</Title>
        <WaveHost ref={waveRef} />
        <Controls>
          <PlayButton disabled={!ready} onClick={toggle} data-state={playing ? "pause" : "play"}>
            {playing ? "Pause" : "Play"}
          </PlayButton>
          <Time>{fmt(time)} / {fmt(dur)}</Time>
        </Controls>
      </PlayerCard>
    </Container>
  );
}
