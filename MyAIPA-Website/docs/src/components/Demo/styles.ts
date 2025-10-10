import styled from "styled-components";

export const Container = styled.main`
  position: relative;
  z-index: 1;
  padding: 0 10rem;
  display: flex;
  justify-content: center;

  @media (max-width: 740px) { padding: 0 4rem; }
  @media (max-width: 360px) { padding: 0 2rem; }
`;

export const PlayerCard = styled.div`
  width: 100%;
  max-width: 840px;
  margin: 3rem auto;
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
  height: 100px;   /* must be >0 */
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
