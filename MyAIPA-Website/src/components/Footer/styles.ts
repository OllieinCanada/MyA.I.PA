// src/components/Footer/styles.ts
import styled from "styled-components";

export const Container = styled.footer`
  width: 100%;
  background-color: #111827;
  color: #e5e7eb;
  padding: 2.5rem clamp(1.5rem, 6vw, 6rem);
  margin-top: 4rem;
  box-shadow: 0 -4px 18px rgba(0, 0, 0, 0.45);

  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1.5rem;

  .logo {
    font-size: 2.4rem;
    font-weight: 700;
    text-decoration: none;
    color: #f9fafb;
    letter-spacing: 0.08em;
    white-space: nowrap;
  }

  .copy p {
    margin: 0;
    font-size: 1.1rem;
    letter-spacing: 0.08rem;
  }

  @keyframes spinning {
    0% {
      transform: rotate(0);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 700px) {
    flex-direction: column;
    text-align: center;
    padding: 2rem 1.5rem;

    .logo {
      font-size: 2rem;
    }

    .copy p {
      font-size: 1rem;
      letter-spacing: 0.06rem;
    }
  }
`;
