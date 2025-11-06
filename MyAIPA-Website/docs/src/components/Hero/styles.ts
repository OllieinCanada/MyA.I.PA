// File: src/components/Hero/styles.ts
import styled from "styled-components";

export const Container = styled.section`
  --text: #ffffffff;
  --text-soft: #cdb8ef;
  --brand: #60a5fa;
  --brand-strong: #fffb00ff;
  --accent: #ffffffff;
  --accent-soft: #ffffffff;
  --warn: #ffffffff;
  --white: #ffffffff;

  --cta-safe-height: 140px;

  position: relative;
  min-height: 100vh;
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
  padding: 0 1rem;

  &::before {
    content: "";
    position: fixed;
    inset: 0;
    background:
      linear-gradient(180deg, rgba(8,8,12,0.55) 0%, rgba(6,6,10,0.72) 100%),
      url("https://st.hzcdn.com/simgs/2a61301804a6ee01_14-8351/_.jpg")
        center/cover no-repeat;
    background-size: cover;
    background-position: center;
    filter: brightness(1.25) contrast(1.05);
    z-index: 0;
  }

  .poster {
    position: relative;
    z-index: 1;
    width: min(960px, 92vw);
    min-height: 100vh;
    display: grid;
    grid-template-rows: auto auto auto auto auto auto;
    justify-items: center;
    align-items: center;
    row-gap: clamp(0.4rem, 1vw, 0.8rem);
    text-align: center;
    padding: 2vh 0;
    margin-top: 40px;
    padding-bottom: var(--cta-safe-height);
  }

  .brand {
    font-weight: 800;
    font-size: clamp(3.6rem, 7.2vw, 7.9rem);
    letter-spacing: 0.14em;
    margin: 0;
    color: #60a5fa;
  }
  .brand .ai {
    color: var(--white);
    text-shadow: 0 0 16px rgba(255, 255, 255, 0.9);
  }

  .brand2 {
    color: #00e0ff;
    font-weight: 600;
    font-size: clamp(1.2rem, 2vw, 2.2rem);
    letter-spacing: 0.22em;
    margin: 0;
    text-transform: uppercase;
    text-shadow:
      0 0 10px rgba(0, 224, 255, 0.85),
      0 0 20px rgba(0, 224, 255, 0.65);
  }

  /* replace the .circle block + its pseudo rules */
.circle {
  width: clamp(200px, 106vw, 235px);
  aspect-ratio: 1/1;
  border-radius: 45%;
  position: relative;
  padding: 3px;                       /* ring thickness */
  border: 2px solid transparent;      /* needed for border-box gradient */
  overflow: hidden;
  margin-left: 200px;

  /* glassy inner panel + neon ring */
  background:
    /* inner soft highlight (mint/teal) */
    radial-gradient(120% 120% at 30% 20%,
      rgba(255,255,255,0.45) 0%,
      rgba(255,255,255,0.10) 55%,
      rgba(255,255,255,0.00) 70%) padding-box,
    /* subtle dark glass */
    linear-gradient(180deg, rgba(8,8,12,0.20), rgba(8,8,12,0.28)) padding-box,
    /* outer neon ring (mint -> blue -> cyan -> mint) */
    conic-gradient(
      #00ff9d, #60a5fa, #00e0ff, #00ff9d
    ) border-box;

  box-shadow:
    0 10px 28px rgba(0,0,0,0.22),
    0 0 34px rgba(34,211,238,0.18),
    0 0 22px rgba(0,255,157,0.30);
  z-index: 1;
}

/* soft radial glow behind the circle */
.circle::after {
  content: "";
  position: absolute;
  inset: -14%;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgba(0,255,157,0.22), rgba(0,224,255,0.10), transparent 70%);
  filter: blur(10px);
  z-index: -1;
}

/* subtle specular highlight on top-left for “sheen” */
.circle::before {
  content: "";
  position: absolute;
  top: 1%;
  left: 10%;
  width: 55%;
  height: 25%;
  border-radius: 60%;
  background: radial-gradient(closest-side, rgba(255,255,255,0.55), rgba(255,255,255,0.08), transparent 70%);
  filter: blur(6px);
  pointer-events: none;
  z-index: 2;
}

.circle img {
  width: 100%;
  height: 110%;
  object-fit: cover;
  filter: saturate(1.06) contrast(1.05);
  transform: translateZ(0);
  border-radius: 10%;
}

  .tagline {
    color: #00ff40;
    font-weight: 900;
    font-size: clamp(1.4rem, 3.2vw, 3.8rem);
    line-height: 1.15;
    letter-spacing: 0.02em;
    margin: 0;
    text-wrap: balance;
    position: relative;
    text-shadow: 0 0 18px rgba(0, 255, 64, 0.75);
  }
  .tagline::after {
    content: "";
    display: block;
    width: min(480px, 55vw);
    height: 3px;
    margin: 8px auto 0;
    background: linear-gradient(90deg, transparent, #00ff40, transparent);
    filter: drop-shadow(0 0 10px rgba(0, 255, 64, 0.9));
  }

  .bullets {
    list-style: none;
    padding: 0;
    margin: 16px 0 0 0;
    display: grid;
    gap: clamp(0.6rem, 1.2vw, 1.2rem);
    justify-items: center;
  }

  .bullets li {
    color: #ffeb3b;
    font-weight: 700;
    font-size: clamp(1.6rem, 2.6vw, 2.2rem);
    position: relative;
    padding-left: 2rem;
    text-transform: uppercase;
    letter-spacing: 0.015em;
    text-shadow: 0 0 10px rgba(255, 235, 59, 0.75);
  }

  .bullets li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0.35em;
    width: 0.6em;
    height: 0.6em;
    border-radius: 50%;
    background: #ffeb3b;
    box-shadow: 0 0 12px rgba(255, 235, 59, 0.8);
  }

  .bottom-line {
    font-weight: 900;
    font-size: clamp(1rem, 2.2vw, 2.4rem);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin: 20px 0 0 0;
    background: linear-gradient(90deg, var(--text) 0%, var(--accent-soft) 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    text-shadow: 0 0 14px rgba(153, 246, 255, 0.28),
      0 0 8px rgba(167, 139, 250, 0.18);
  }

  /* CTA Button fixed to bottom right in solid purple */
  .down-arrow {
    position: fixed;
    right: 24px;
    bottom: 24px;
    width: 72px;
    height: 72px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: #7c3aed; /* solid purple */
    border: 3px solid var(--white);
    box-shadow: 0 10px 36px rgba(0,0,0,0.6), 0 0 40px rgba(124,58,237,0.8);
    text-decoration: none;
    cursor: pointer;
    z-index: 50;
    transition: transform 200ms ease, box-shadow 200ms ease;
  }
  .down-arrow:hover {
    transform: translateY(-5px) scale(1.08);
    box-shadow: 0 14px 44px rgba(0,0,0,0.65), 0 0 48px rgba(124,58,237,1);
  }
  .down-arrow:focus-visible {
    outline: 3px solid #ffffff;
    outline-offset: 4px;
  }
  .down-arrow:active { transform: scale(0.96); }

  .down-arrow svg {
    fill: var(--white);
    width: 36px;
    height: 36px;
    animation: arrow-bounce 1.6s ease-in-out infinite;
  }

  .down-arrow__label {
    display: none;
  }

  @keyframes arrow-bounce {
    0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
    40% { transform: translateY(6px); }
    60% { transform: translateY(3px); }
  }
`;
