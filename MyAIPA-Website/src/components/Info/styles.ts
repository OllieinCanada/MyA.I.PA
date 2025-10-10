// File: src/components/About/styles.ts
import styled from "styled-components";

export const Container = styled.section`
  --text: #f1f5f9;
  --text-soft: #cbd5e1;
  --brand: #0ea5e9;
  --brand-strong: #ffffffff;
  --accent: #22d3ee;
  --white: #ffffff;

  position: relative;
  min-height: 100vh;
  width: 100%;
  display: flex;
  justify-content: center;
  padding: 1rem 3rem 3rem 5.5rem;
  background: linear-gradient(180deg, rgba(2, 8, 23, 0.95), rgba(15, 23, 42, 0.95));
  color: var(--text);
  margin-top: -120px;

  .about-text {
    width: 400%;
  }

  h2 {
    font-size: 6.8rem;
    margin-bottom: 5rem;
    color: var(--brand);
  }

  .section-title {
    font-size: 4.5rem;
    color: var(--brand-strong);
    margin-bottom: 1rem;
  }

  ul {
    list-style: disc;
    padding-left: 1.5rem;
  }

  li {
    color: var(--text-soft);
    font-size: 3.5rem;
    margin-bottom: 0.75rem;
  }

  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3rem;
    align-items: start;
    margin-top: -50px;
  }

  .col {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(148, 163, 184, 0.12);
    border-radius: 16px;
    padding: 1.5rem 2rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .cta {
    background: rgba(0, 0, 0, 0.75);
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 16px;
    padding: 2rem;
    text-align: center;
    font-size: 3.2rem;
    font-weight: 600;
    color: var(--white);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  }

  .about-image,
  .image-block {
    display: none !important;
  }

  @media (max-width: 1024px) {
    padding: 6rem 2rem 2rem 2rem;

    h2 {
      font-size: 2.4rem;
    }
    .section-title {
      font-size: 2rem;
    }
    li {
      font-size: 1.2rem;
    }
    .two-col {
      grid-template-columns: 1fr;
      margin-top: -30px;
    }
    .cta {
      font-size: 1.4rem;
      padding: 1rem;
    }
  }
`;
