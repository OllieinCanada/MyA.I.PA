import styled from "styled-components";

export const Container = styled.section`
  --panel: #11161a;
  --panel-2: #0b0f12;
  --text: #f8fafc;
  --muted: #cbd5e1;
  --border: #2a3137;
  --neon: #00ff9d;
  --neonBlue: #00bfff;

  /* Softer glow background */
  background: radial-gradient(
      circle at 50% 0%,
      rgba(0, 255, 157, 0.08) 0%,
      rgba(0, 191, 255, 0.07) 35%,
      rgba(13, 17, 23, 1) 100%
    );
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 5rem 1.25rem;

  .panel {
    background: linear-gradient(
      180deg,
      rgba(20, 24, 30, 0.94) 0%,
      rgba(14, 18, 23, 0.96) 100%
    );
    color: var(--text);
    border-top: 1px solid rgba(0, 255, 157, 0.15);
    padding: 4rem 2rem;
    border-radius: 28px;
    box-shadow:
      0 0 50px rgba(0, 255, 157, 0.12),
      0 0 60px rgba(0, 191, 255, 0.1);
    max-width: 1100px;
    width: 100%;
    backdrop-filter: blur(8px);
  }

  .trial-card {
    background: radial-gradient(
        120% 120% at 20% 0%,
        rgba(0, 255, 157, 0.07) 0%,
        rgba(0, 191, 255, 0.06) 40%,
        rgba(11, 15, 18, 0.92) 85%
      ),
      var(--panel-2);
    border: 1px solid rgba(0, 255, 157, 0.15);
    border-radius: 24px;
    padding: 3rem 2.5rem;
    text-align: center;
    box-shadow:
      0 18px 40px rgba(0, 0, 0, 0.45),
      0 0 20px rgba(0, 255, 157, 0.12),
      0 0 30px rgba(0, 191, 255, 0.1);
    transition: all 0.3s ease;
  }

  .trial-card:hover {
    box-shadow:
      0 25px 55px rgba(0, 0, 0, 0.55),
      0 0 40px rgba(0, 255, 157, 0.18),
      0 0 50px rgba(0, 191, 255, 0.15);
    transform: translateY(-1px);
  }

  .trial-title {
    margin: 0 0 0.6rem 0;
    font-weight: 900;
    font-size: clamp(3rem, 6vw, 4.4rem);
    letter-spacing: 0.5px;
    color: var(--text);
    text-shadow:
      0 0 18px rgba(0, 255, 157, 0.3),
      0 0 26px rgba(0, 191, 255, 0.2);
  }

  .trial-sub {
    margin: 1rem auto 2rem;
    max-width: 900px;
    color: #b1ebff;
    font-weight: 600;
    font-size: clamp(1.2rem, 2.6vw, 1.6rem);
    line-height: 1.55;
    text-shadow: 0 0 6px rgba(0, 255, 157, 0.25);
  }

  .badge {
    display: inline-block;
    color: #d4f2ff;
    font-weight: 900;
    font-size: 1.05rem;
    background: rgba(96, 165, 250, 0.1);
    border: 1px solid rgba(96, 165, 250, 0.25);
    padding: 0.55rem 1.1rem;
    border-radius: 999px;
    margin-bottom: 1.6rem;
    box-shadow: 0 0 8px rgba(96, 165, 250, 0.2);
  }

  /* ----------- FORM ----------- */
  .contact-form {
    margin-top: 0.5rem;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.3rem;
    max-width: 850px;
    margin: 0 auto 1.6rem;
  }

  .field {
    text-align: left;
  }

  .field label {
    display: block;
    font-size: 1rem;
    font-weight: 800;
    color: #c6f8ff;
    margin-bottom: 0.45rem;
  }

  .field input {
    width: 100%;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: var(--text);
    padding: 1rem 1.1rem;
    border-radius: 12px;
    font-size: 1.05rem;
    outline: none;
    transition: all 0.15s ease;
  }

  .field input::placeholder {
    color: #9ba8b5;
  }

  .field input:focus {
    border-color: rgba(0, 255, 157, 0.4);
    box-shadow:
      0 0 10px rgba(0, 255, 157, 0.25),
      0 0 18px rgba(0, 191, 255, 0.15);
  }

  .error {
    color: #ffb4b4;
    font-weight: 700;
    margin: 0.4rem 0;
  }

  .success {
    font-size: 1.3rem;
    font-weight: 800;
    color: #b6f3d7;
    background: rgba(0, 255, 157, 0.08);
    border: 1px solid rgba(0, 255, 157, 0.25);
    padding: 1rem 1.2rem;
    border-radius: 14px;
    display: inline-block;
  }

  .cta-submit {
    margin: 1.8rem auto 0;
    display: inline-flex;
    align-items: center;
    gap: 1rem;
    background: linear-gradient(90deg, #635bff, #00ff9d);
    color: #fff;
    border: none;
    border-radius: 22px;
    padding: 1.1rem 2.6rem;
    font-weight: 900;
    letter-spacing: 0.3px;
    font-size: 1.35rem;
    cursor: pointer;
    box-shadow:
      0 0 30px rgba(58, 123, 255, 0.45),
      0 0 18px rgba(0, 255, 157, 0.35) inset;
    transition: all 0.2s ease-in-out;
  }

  .cta-submit:hover:not(:disabled) {
    transform: scale(1.04);
    filter: brightness(1.08);
    box-shadow:
      0 0 40px rgba(58, 123, 255, 0.65),
      0 0 24px rgba(0, 255, 157, 0.4) inset;
  }

  .cta-submit:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .microcopy {
    margin-top: 1.3rem;
    color: var(--muted);
    font-size: 1.05rem;
    line-height: 1.6;
    max-width: 760px;
    margin-inline: auto;
  }

  @media (max-width: 800px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
`;
