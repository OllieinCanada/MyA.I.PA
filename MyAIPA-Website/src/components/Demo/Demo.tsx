import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import {
  Container,
  Grid,
  LeftStack,
  Callout,
  CalloutTitle,
  CalloutText,
  PlayerCard,
  Title,
  Controls,
  PlayButton,
  Time,
  WaveHost,
  RightColumn,
  FigureCard,
  FigureTitle,
  FigureImage,
} from "./styles";

export default function Contact() {
  const waveRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);

  const SRC = "/voice.m4a";
  const CLIENT_IMG = "/client-receives.jpg";
  const OWNER_IMG = "/owner-gets.jpg";

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
    ws.on("ready", () => { setDur(ws.getDuration()); setReady(true); });
    ws.on("timeupdate", (t) => setTime(t));
    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("finish", () => setPlaying(false));
    return () => { ws.destroy(); wsRef.current = null; };
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
      <Grid>
        <LeftStack>
          <Callout>
            <CalloutTitle>Listen to an example phone call right now!</CalloutTitle>
            <CalloutText>
              This simulates what it’s like when a client is forwarded to one of our AI assistants representing your business.
            </CalloutText>
          </Callout>

          <PlayerCard>
            <Title>My AI PA Call Demo – Tim’s Electrical Services</Title>
            <WaveHost ref={waveRef} />
            <Controls>
              <PlayButton disabled={!ready} onClick={toggle} data-state={playing ? "pause" : "play"}>
                {playing ? "Pause" : "Play"}
              </PlayButton>
              <Time>{fmt(time)} / {fmt(dur)}</Time>
            </Controls>
          </PlayerCard>
        </LeftStack>

        <RightColumn>
          <FigureCard>
            <FigureTitle>CUSTOMER TEXT SUMMARY</FigureTitle>
            <FigureImage src={CLIENT_IMG} alt="Preview of what the client receives" />
          </FigureCard>

          <FigureCard>
            <FigureTitle>OWNER TEXT SUMMARY</FigureTitle>
            <FigureImage src={OWNER_IMG} alt="Preview of what the business owner gets" />
          </FigureCard>
        </RightColumn>
      </Grid>
    </Container>
  );
}
