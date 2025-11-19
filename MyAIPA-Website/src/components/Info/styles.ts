import styled from "styled-components";

export const Container = styled.section`
  position: relative;
  text-align: center;
  padding: 3rem 0 4rem;
  color: #fff;
  overflow: hidden;

  /* subtle overlay for readability */
  &::before {
    content: "";
    position: absolute;
    inset: 0;
    background: radial-gradient(
      1200px 480px at 50% 20%,
      rgba(0, 0, 0, 0.45),
      rgba(0, 0, 0, 0.65)
    );
    pointer-events: none;
    z-index: 0;
  }

  > * {
    position: relative;
    z-index: 1;
  }

  /* INTRO SECTION ------------------------------------------------------- */

  .intro {
    max-width: 900px;
    margin: 0 auto 5.5rem;
  }

  .intro__title {
    font-weight: 800;
    font-size: clamp(3.6rem, 3vw, 15rem);
    color: #f9fafb;
    margin-bottom: 0.6rem;
  }

  .intro__body {
    font-size: clamp(2rem, 1.9vw, 1.9rem);
    line-height: 1.55;
    color: #f9f9faff;
  }

  .intro__body strong {
    font-weight: 700;
  }

  .intro__body .stat-highlight {
    color: #7FFF5A;
    text-shadow: 0 0 8px rgba(255, 179, 71, 0.35);
    padding: 0 0.1em;
    border-radius: 4px;
  }

  /* ⭐ NEW Coffee Price Highlight -------------------------------------- */
  .intro__body2 {
  font-size: clamp(2rem, 1.9vw, 2.9rem);
  line-height: 1.55;
  color: #5CFAFF;
  font-weight: 800;
  text-shadow: 0 0 10px rgba(92, 250, 255, 0.55);
  background: rgba(92, 250, 255, 0.10);
  padding: 10px 18px;
  border-radius: 14px;
  margin-top: 28px;
  margin-bottom: 32px;
  display: inline-block;
}

  .title {
    font-size: clamp(1.1rem, 3.3vw, 3.55rem);
    font-weight: 800;
    color: #8fd0ff;
    margin: 2rem 0 1rem;
  }



  /* ---------------------- DESKTOP ROW OF BOXES ------------------------ */

  .flow-row {
    display: flex;
    align-items: stretch;
    justify-content: center;
    gap: 1.5rem;
    max-width: 1300px;
    margin: 0 auto;
    padding: 0 1vw;
  }

  .step {
    position: relative;
    background: rgba(10, 18, 28, 0.8);
    border: 1px solid rgba(140, 200, 255, 0.2);
    border-radius: 14px;
    padding: 1.2rem 1.2rem;
    width: 260px;
    max-width: 280px;
    text-align: center;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    transition: transform 0.2s ease;
  }

  .step:hover {
    transform: translateY(-4px);
  }

  .arrow {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    font-size: clamp(1.5rem, 1.8vw, 2rem);
    color: #4cb4ff;
    text-shadow: 0 0 10px rgba(0, 100, 255, 0.5);
  }

  .badge {
    position: absolute;
    top: -10px;
    left: -10px;
    width: 34px;
    height: 34px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: #33cc88;
    color: #0b1b13;
    font-weight: 800;
    box-shadow: 0 8px 18px rgba(0, 0, 0, 0.35);
  }

  .icon {
    width: clamp(50px, 5vw, 100px);
    height: clamp(50px, 5vw, 70px);
    margin-bottom: 0.6rem;
    margin-left: 8.6rem;
    object-fit: contain;
  }

  h4 {
    font-size: clamp(1.95rem, 1.1vw, 3.05rem);
    font-weight: 700;
    color: #fff;
    margin-bottom: 0.4rem;
  }

  p {
    font-size: clamp(1rem, 1.4vw, 1.4rem);
    line-height: 1.55;
    color: #dce7f7;
  }



  /* ------------------ Tighter for smaller desktops -------------------- */

  @media (max-width: 1200px) and (min-width: 861px) {
    .flow-row {
      gap: 1.1rem;
      padding: 0 1rem;
      max-width: 1150px;
    }

    .step {
      width: 235px;
      max-width: 240px;
      padding: 1.1rem 1rem;
    }

    p {
      font-size: 0.95rem;
    }
  }



  /* -------------------------- MOBILE STACK ---------------------------- */

  @media (max-width: 860px) {
    .intro {
      margin: 0 1rem 3rem;
      padding: 1.1rem 0.6rem;
      border-radius: 14px;
      background: rgba(10, 18, 28, 0.78);
    }

    .intro__title {
      font-size: 2rem;
      line-height: 1.2;
    }

    .intro__body {
      font-size: 1rem;
      line-height: 1.6;
    }

    .intro__body2 {
      font-size: 1.1rem;
      padding: 10px 12px;
      margin-top: 1rem;
      margin-bottom: 1rem;
      text-shadow: 0 0 8px rgba(255, 208, 92, 0.4);
    }

    .title {
      margin-top: 32px;
      margin-bottom: 16px;
    }

    .flow-row {
      flex-direction: column;
      align-items: center;
      gap: 1.4rem;
      padding: 0 1rem;
    }

    .arrow {
      display: none;
    }

    .step {
      width: 100%;
      max-width: 360px;
      text-align: left;
      align-items: center;
      padding: 1.2rem 1rem;
    }

    .step p {
      font-size: 0.95rem;
      line-height: 1.5;
    }

    .badge {
      top: -8px;
      left: -8px;
    }
  }
`;
