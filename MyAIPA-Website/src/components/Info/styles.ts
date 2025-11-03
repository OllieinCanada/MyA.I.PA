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
    background: radial-gradient(1200px 480px at 50% 20%, rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.65));
    pointer-events: none;
    z-index: 0;
  }

  > * {
    position: relative;
    z-index: 1;
  }

  .intro {
    max-width: 900px;
    margin: 0 auto 5.5rem;
  }

  .intro__title {
    font-weight: 800;
    font-size: clamp(3.6rem, 3vw, 15rem);
    color: #F9FAFB;
    margin-bottom: 0.6rem;
  }

  .intro__body {
    font-size: clamp(2rem, 1.9vw, 1.9rem);
    line-height: 1.55;
    color: #f9f9faff
  }

  .intro__body2 {
    font-size: clamp(2rem, 1.9vw, 2.9rem);
    line-height: 1.55;
    color: #00C2CB;
    margin-top: 10px;
    margin-bottom: -23px;
  }

  .title {
    font-size: clamp(1.1rem, 3.3vw, 3.55rem);
    font-weight: 800;
    color: #8fd0ff;
    margin: 2.6rem 0 1rem;
    margin-bottom: 10px;
    margin-top: 50px;
  }

  /* --- ONE LINE, FIXED WIDTH GRID --- */
  .flow-row {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    align-items: stretch;
    justify-items: center;
    max-width: 100%;
    width: 100%;
    margin: 0 auto;
    gap: 0.6vw;
    padding: 0 2vw;
  }

  .step {
    background: rgba(10, 18, 28, 0.8);
    border: 1px solid rgba(140, 200, 255, 0.2);
    border-radius: 14px;
    padding: 1rem 0.75rem;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    width: clamp(180px, 20vw, 240px);
    text-align: center;
    transition: transform 0.2s ease;
  }

  .step:hover {
    transform: translateY(-4px);
  }

  .icon {
    width: clamp(50px, 5vw, 70px);
    height: clamp(50px, 5vw, 70px);
    object-fit: contain;
    margin-bottom: 0.6rem;
  }

  h4 {
    font-size: clamp(1.95rem, 1.1vw, 3.05rem);
    font-weight: 700;
    color: #fff;
    margin-bottom: 0.4rem;
  }

  p {
    font-size: clamp(1rem, 1.8vw, 1.9rem);
    line-height: 1.45;
    margin-bottom: -15px;
    color: #dce7f7;
  }

  .arrow {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: clamp(1.5rem, 1.8vw, 2rem);
    color: #4cb4ff;
    text-shadow: 0 0 10px rgba(0, 100, 255, 0.5);
  }

  @media (max-width: 1080px) {
    .step {
      width: clamp(150px, 22vw, 200px);
      padding: 0.8rem 0.6rem;
    }
    .icon {
      width: clamp(42px, 4.5vw, 60px);
      height: clamp(42px, 4.5vw, 60px);
    }
    p {
      font-size: 0.85rem;
    }
  }

  @media (max-width: 860px) {
    .flow-row {
      grid-template-columns: 1fr;
      gap: 1rem;
    }
    .arrow {
      display: none;
    }
  }
`;
