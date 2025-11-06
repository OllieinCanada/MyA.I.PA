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
      url("https://st.hzcdn.com/simgs/pictures/sheds/workshop-interior-john-gehri-zerrer-img~2a61301804a6ee01_14-8351-1-c651ff7.jpg")
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
    font-size: clamp(0.5rem, 2vw, 2.4rem);
    letter-spacing: 0.22em;
    margin: 0;
    text-transform: uppercase;
    text-shadow:
      0 0 10px rgba(0, 224, 255, 0.85),
      0 0 20px rgba(0, 224, 255, 0.65);
  }

  .trade-line {
    color: #ff6a00;
    font-weight: 900;
    font-size: clamp(1.0rem, 2.4vw, 2.4rem);
    margin-top: 0.8rem;
    text-align: center;
    letter-spacing: 0.08em;
    text-shadow: 0 0 18px rgba(0, 0, 0, 1.2),
                 0 0 6px rgba(255, 154, 0, 0.6);
    position: relative;
    z-index: 2;
  }

  /* replace the .circle block + its pseudo rules */
  .circle {
    width: clamp(200px, 106vw, 235px);
    aspect-ratio: 1/1;
    border-radius: 45%;
    position: relative;
    padding: 3px;
    border: 2px solid transparent;
    overflow: hidden;
    margin-left: 200px;
    background:
      radial-gradient(120% 120% at 30% 20%,
        rgba(255,255,255,0.45) 0%,
        rgba(255,255,255,0.10) 55%,
        rgba(255,255,255,0.00) 70%) padding-box,
      linear-gradient(180deg, rgba(8,8,12,0.20), rgba(8,8,12,0.28)) padding-box,
      conic-gradient(#00ff9d, #60a5fa, #00e0ff, #00ff9d) border-box;
    box-shadow:
      0 10px 28px rgba(0,0,0,0.22),
      0 0 34px rgba(34,211,238,0.18),
      0 0 22px rgba(0,255,157,0.30);
    z-index: 1;
  }

  /* === Inline Image + Text (head-level alignment) === */
  .hero-inline {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    gap: 2.5rem;
    flex-wrap: nowrap;
    margin-top: 2rem;
    z-index: 2;
    position: relative;
  }

  .hero-inline .circle {
    flex: 0 0 auto;
    margin: 0;
    max-width: 280px;
    transform: translateY(-20px);
  }

  .hero-inline-text {
    flex: 1;
    max-width: 460px;
    color: #ffffff;
    font-size: clamp(1rem, 1.8vw, 2.25rem);
    line-height: 1.6;
    font-weight: 500;
    text-shadow: 0 0 12px rgba(255, 255, 255, 0.6);
    margin-top: 1.2rem;
  }

  .hero-inline-text p { margin: 0; }

  @media (max-width: 820px) {
    .hero-inline {
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
    .hero-inline-text {
      margin-top: 1rem;
      max-width: 10%;
    }
  }

  .circle img {
    width: 100%;
    height: 110%;
    object-fit: cover;
    filter: saturate(1.06) contrast(1.05);
    transform: translateZ(0);
    border-radius: 10%;
  }

  .hero-inline-text .break-line {
    display: block;
    margin-top: 0.4rem;
    font-weight: 700;
    text-shadow: 0 0 10px rgba(255, 255, 255, 0.3);
  }

  .hero-inline-text .day {
    color: #ffe066;
    text-shadow: 0 0 12px rgba(255, 224, 102, 0.85);
  }

  .hero-inline-text .night {
    color: #7dd3fc;
    text-shadow: 0 0 12px rgba(125, 211, 252, 0.9);
  }

  .hero-inline-text .why-title {
    margin-top: 1.8rem;
    font-size: clamp(2.2rem, 3.1vw, 1.8rem);
    font-weight: 900;
    color: #00e676;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    text-shadow:
      0 0 18px rgba(0, 230, 118, 1),
      0 0 38px rgba(0, 230, 118, 0.6),
      0 0 8px rgba(0, 0, 0, 0.8);
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

  .bullets.two-col {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.8rem 2.4rem;
    justify-items: start;
    list-style: none;
    padding: 0;
    margin: 16px auto 0;
    max-width: 720px;
  }

  .bullets.two-col li {
    color: #ffeb3be7;
    font-weight: 700;
    font-size: clamp(1.1rem, 2vw, 1.9rem);
    position: relative;
    padding-left: 1.6rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    text-shadow: 0 0 10px rgba(255, 235, 59, 0.75);
  }

  .bullets.two-col li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0.4em;
    width: 0.55em;
    height: 0.55em;
    border-radius: 50%;
    background: #ffeb3b;
    box-shadow: 0 0 8px rgba(255, 235, 59, 0.8);
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
    background: #7c3aed;
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
  .down-arrow:focus-visible { outline: 3px solid #ffffff; outline-offset: 4px; }
  .down-arrow:active { transform: scale(0.96); }
  .down-arrow svg {
    fill: var(--white);
    width: 36px;
    height: 36px;
    animation: arrow-bounce 1.6s ease-in-out infinite;
  }
  .down-arrow__label { display: none; }
  @keyframes arrow-bounce {
    0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
    40% { transform: translateY(6px); }
    60% { transform: translateY(3px); }
  }

  /* === Bottom-left promo card (high contrast) === */
  .promo-card {
    position: fixed;
    left: 24px;
    bottom: 24px;
    z-index: 60;
    width: min(420px, 92vw);
    padding: 18px 18px 16px;
    border-radius: 16px;
    color: #eafff5;
    background: linear-gradient(180deg, rgba(10,14,20,0.85), rgba(10,14,20,0.92)) border-box;
    border: 2px solid transparent;
    box-shadow:
      0 18px 60px rgba(0,0,0,0.55),
      0 0 42px rgba(51,204,136,0.35),
      inset 0 0 0 1px rgba(255,255,255,0.06);
    backdrop-filter: blur(6px);
    transform: translateY(10px) scale(0.98);
    opacity: 0;
    pointer-events: none;
    transition: opacity 240ms ease, transform 240ms ease;
  }
  .promo-card::before {
    content: "";
    position: absolute;
    inset: -2px;
    z-index: -1;
    border-radius: 18px;
    background: conic-gradient(from 220deg, #33cc88, #60a5fa, #00e0ff, #33cc88);
    filter: blur(8px);
    opacity: 0.35;
  }
  .promo-card[data-show="true"] {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }

  .promo-x {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 34px;
    height: 34px;
    border: none;
    border-radius: 10px;
    background: rgba(255,255,255,0.08);
    color: #ffffff;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
  }
  .promo-x:hover { background: rgba(255,255,255,0.16); }

  .promo-chip {
    display: inline-block;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: #0b1b13;
    background: #33cc88;
    padding: 4px 8px;
    border-radius: 999px;
    box-shadow: 0 0 16px rgba(51,204,136,0.55);
  }

  .promo-title {
    margin: 10px 0 4px;
    font-size: clamp(1.2rem, 2.2vw, 1.6rem);
    font-weight: 900;
    letter-spacing: 0.01em;
    color: #eafff5;
    text-shadow: 0 0 18px rgba(0,0,0,0.4);
  }

  .promo-sub {
    margin: 0 0 12px;
    font-size: clamp(0.95rem, 1.8vw, 1.05rem);
    color: #c8ffea;
    opacity: 0.95;
  }

  .promo-cta {
    width: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 12px 14px;
    border-radius: 12px;
    border: 0;
    cursor: pointer;
    font-weight: 900;
    letter-spacing: 0.02em;
    color: #08120e;
    background: linear-gradient(90deg, #33cc88, #00e0ff);
    box-shadow: 0 10px 28px rgba(0,0,0,0.35), 0 0 24px rgba(51,204,136,0.35);
    transition: transform 140ms ease, box-shadow 140ms ease, filter 140ms ease;
  }
  .promo-cta:hover {
    transform: translateY(-1px);
    box-shadow: 0 14px 40px rgba(0,0,0,0.4), 0 0 32px rgba(51,204,136,0.5);
    filter: brightness(1.05);
  }
  .promo-cta:active { transform: translateY(0); }
  .promo-cta svg { width: 22px; height: 22px; }

  .promo-footer {
    margin-top: 10px;
    font-size: 12.5px;
    color: #b8f7e4;
    opacity: 0.85;
    text-align: center;
  }

  @media (max-width: 420px) {
    .promo-title { font-size: 1.25rem; }
    .promo-sub { font-size: 0.95rem; }
    .promo-cta { padding: 12px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .promo-card { transition: none; }
  }
`;
