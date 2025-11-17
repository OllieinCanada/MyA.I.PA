import styled from "styled-components";

export const Container = styled.section`
  --cream: #0d1117;
  --panel: rgba(17, 22, 26, 0.6);
  --panel-2: rgba(11, 15, 18, 0.6);
  --text: #f8fafc;
  --muted: #cbd5e1;
  --border: #2a3137;

  background: var(--cream);
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 6rem 1rem;

  .panel {
    background: var(--panel);
    border-top: 1px solid #0b0f12;
    border-radius: 28px;
    padding: 5rem 3rem;
    box-shadow: 0 0 100px rgba(0, 255, 157, 0.1),
      0 0 140px rgba(96, 165, 250, 0.1);
    max-width: 1400px;
    width: 100%;
    color: var(--text);
    text-align: center;
    backdrop-filter: blur(6px);
  }

  .trial-title {
    margin: 0 0 1rem 0;
    font-weight: 900;
    font-size: clamp(3rem, 6vw, 4.5rem);
    color: var(--text);
    text-shadow: 0 0 40px rgba(96, 165, 250, 0.35),
      0 0 28px rgba(0, 255, 157, 0.3);
  }

  .trial-sub {
    margin: 1rem auto 3rem;
    max-width: 900px;
    color: #9adfff;
    font-weight: 700;
    font-size: clamp(1.4rem, 2.6vw, 1.8rem);
    line-height: 1.6;
  }

  .trial-sub.large {
    font-size: clamp(1.8rem, 3vw, 2.4rem);
  }

  .tier-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 0.5fr));
    gap: 4rem;
    margin-top: 1.5rem;
  }

  .tier-card {
    background: radial-gradient(
        130% 130% at 30% 0%,
        rgba(0, 255, 157, 0.12) 0%,
        rgba(96, 165, 250, 0.12) 45%,
        rgba(11, 15, 18, 0.75) 85%
      ),
      var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 28px;
    padding: 4rem 3rem;
    text-align: center;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4),
      0 0 50px rgba(0, 255, 157, 0.25);
    transition: transform 0.25s ease-in-out, box-shadow 0.25s ease-in-out;
  }

  .tier-card:hover {
    transform: translateY(-10px);
    box-shadow: 0 30px 70px rgba(0, 255, 157, 0.4);
  }

  .tier-name {
    font-size: 2.4rem;
    font-weight: 900;
    color: var(--text);
    margin-bottom: 0.8rem;
  }

  .tier-price {
    font-size: 2rem;
    font-weight: 800;
    color: #9adfff;
    margin-bottom: 1.5rem;
  }

  .bullets {
    list-style: none;
    padding: 0;
    margin: 0 0 3rem 0;
    display: flex;
    flex-direction: column;
    gap: 1.4rem;
    align-items: center;
    color: #e9f2ff;
    font-weight: 700;
    font-size: 1.5rem;
    line-height: 1.6;
  }

  .after-signup-box {
    margin-top: 3.5rem;
    padding: 2rem 2.5rem;
    border-radius: 20px;
    background: rgba(0, 255, 157, 0.08);
    box-shadow: 0 0 30px rgba(0, 255, 157, 0.2);
    max-width: 850px;
    margin-inline: auto;
  }

  .after-title {
    font-size: clamp(2.2rem, 4vw, 3rem);
    font-weight: 900;
    color: #9adfff;
    margin-bottom: 1.2rem;
    text-shadow: 0 0 25px rgba(0, 255, 157, 0.25);
  }

  .after-desc {
    font-size: clamp(1.4rem, 2.4vw, 1.8rem);
    color: #e9f2ff;
    font-weight: 700;
    line-height: 1.6;
  }

  .cta-stripe {
    margin: 2rem auto 0;
    display: inline-flex;
    align-items: center;
    gap: 1.2rem;
    background: linear-gradient(90deg, #635bff, #00ff9d);
    color: #fff;
    border: none;
    border-radius: 28px;
    padding: 1.6rem 3.5rem;
    font-weight: 900;
    letter-spacing: 0.4px;
    font-size: 1.6rem;
    cursor: pointer;
    box-shadow: 0 0 40px rgba(58, 123, 255, 0.6),
      0 0 25px rgba(0, 255, 157, 0.45) inset;
    transition: all 0.25s ease-in-out;
  }

  .cta-stripe:hover {
    transform: scale(1.08);
    filter: brightness(1.1);
    box-shadow: 0 0 70px rgba(58, 123, 255, 0.9),
      0 0 50px rgba(0, 255, 157, 0.65) inset;
  }

  .cta-stripe.disabled {
    background: #333a44;
    color: #9ca3af;
    cursor: not-allowed;
    box-shadow: none;
    transform: none;
    filter: brightness(0.9);
  }

  .cta-stripe.disabled:hover {
    transform: none;
    filter: none;
    box-shadow: none;
  }

  .contact-note {
    margin-top: 1rem;
    color: var(--muted);
    font-size: 1.9rem;
  }

  .microcopy {
    margin-top: 2rem;
    color: var(--muted);
    font-size: 1.2rem;
    line-height: 1.7;
    max-width: 860px;
    margin-inline: auto;
  }

  /* ----------------------- MOBILE TWEAKS ------------------------ */
  @media (max-width: 768px) {
    padding: 4rem 1.25rem;

    .panel {
      border-radius: 22px;
      padding: 3rem 1.75rem;
      text-align: left;
    }

    .trial-title {
      font-size: clamp(2.2rem, 7vw, 2.8rem);
      text-align: center;
    }

    .trial-sub {
      font-size: 1.2rem;
      margin: 0.75rem auto 2rem;
      text-align: center;
    }

    .tier-grid {
      grid-template-columns: 1fr; /* stack cards */
      gap: 2.5rem;
      margin-top: 1.5rem;
    }

    .tier-card {
      padding: 2.2rem 1.6rem;
      text-align: left;
    }

    .tier-name {
      font-size: 1.6rem;
    }

    .tier-price {
      font-size: 1.3rem;
      margin-bottom: 1.1rem;
    }

    .bullets {
      align-items: flex-start;
      font-size: 1.05rem;
      line-height: 1.5;
      gap: 0.9rem;
    }

    .cta-stripe {
      width: 100%;
      justify-content: center;
      padding: 1.1rem 1.6rem;
      font-size: 1.15rem;
    }

    .after-signup-box {
      padding: 1.8rem 1.5rem;
      margin-top: 2.5rem;
    }

    .after-title {
      font-size: 1.6rem;
    }

    .after-desc {
      font-size: 1.05rem;
    }

    .contact-note {
      font-size: 1.1rem;
      text-align: center;
    }

    .microcopy {
      font-size: 0.95rem;
    }
  }

  @media (max-width: 480px) {
    .panel {
      padding: 2.4rem 1.4rem;
      border-radius: 18px;
    }

    .tier-card {
      padding: 2rem 1.4rem;
      border-radius: 22px;
    }

    .bullets {
      font-size: 1rem;
      gap: 0.75rem;
    }
  }
`;