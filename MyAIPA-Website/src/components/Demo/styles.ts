import styled from "styled-components";

export const Container = styled.main`
  position: relative;
  z-index: 1;
  padding: 0 10rem;
  @media (max-width: 1024px) { padding: 0 6rem; }
  @media (max-width: 740px) { padding: 0 1.25rem; }
`;

export const Grid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 420px;
  gap: 24px;
  align-items: start;
  margin: 3rem 0;
  @media (max-width: 980px) { grid-template-columns: 1fr; }
`;

export const LeftStack = styled.div`
  display: grid;
  gap: 20px;
  margin-top: 80px; /* ⬇️ lowers the left section only */
`;

/* Callout ABOVE player */
export const Callout = styled.section`
  background: #0b0f15;
  border: 1px solid #1f2937;
  border-radius: 14px;
  padding: 20px 22px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.35);
  text-align: left;
`;

export const CalloutTitle = styled.h2`
  margin: 0 0 12px 0;
  color: #e5e7eb;
  font-weight: 900;
  font-size: clamp(1.3rem, 2.6vw, 6rem);
  letter-spacing: 0.02em;
`;

export const CalloutText = styled.p`
  margin: 0;
  color: #c7ccd9;
  line-height: 1.7;
  font-size: 2.15rem;
  font-weight: 500;
  max-width: 720px;
`;

export const PlayerCard = styled.div`
  width: 100%;
  background: #0b0c10;
  border: 1px solid #1f2430;
  border-radius: 14px;
  padding: 16px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.35);
`;

export const Title = styled.h3`
  margin: 0 0 12px 4px;
  color: #e5e7eb;
  font-weight: 600;
`;

export const WaveHost = styled.div`
  width: 100%;
  height: 100px;
  background: #0e1117;
  border: 1px solid #1c2230;
  border-radius: 10px;
  overflow: hidden;
`;

export const Controls = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding: 0 4px;
`;

export const PlayButton = styled.button`
  appearance: none;
  border: 0;
  border-radius: 999px;
  padding: 10px 18px;
  font-weight: 600;
  background: #8b5cf6;
  color: #0b0c10;
  cursor: pointer;
  transition: transform 120ms ease, opacity 120ms ease;
  &:disabled { opacity: 0.4; cursor: default; }
  &:not(:disabled):active { transform: scale(0.98); }
  &[data-state="pause"] { background: #22d3ee; }
`;

export const Time = styled.span`
  color: #a3a8b8;
  font-variant-numeric: tabular-nums;
`;

export const RightColumn = styled.aside`
  display: grid;
  gap: 16px;
`;

export const FigureCard = styled.figure`
  margin: 0;
  background: #0b0c10;
  border: 1px solid #1f2430;
  border-radius: 14px;
  padding: 12px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.35);
`;

export const FigureTitle = styled.figcaption`
  color: #e5e7eb;
  font-weight: 700;
  font-size: 2.95rem;
  margin: 4px 4px 10px;
`;

export const FigureImage = styled.img`
  display: block;
  width: 100%;
  height: auto;
  object-fit: contain;
  border-radius: 10px;
  background: #0e1117;
  border: 1px solid #1c2230;
`;
