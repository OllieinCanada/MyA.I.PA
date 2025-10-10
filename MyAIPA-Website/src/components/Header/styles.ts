// File: src/components/Header/styles.ts
import styled from "styled-components";

export const Container = styled.header`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.8rem 10rem;
  background-color: #21212150;
  backdrop-filter: blur(6px);
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  z-index: 1000;

  /* ---- BRAND ROW (logo + call-now) ------------------------------------ */
  .brand-row{
    display: flex;
    align-items: center;
    gap: 12px;
  }

  /* ---- LOGO: big visual, no header growth ------------------------------ */
  .logo {
    position: relative;
    display: block;
    width: 240px;    /* reserved space inside header */
    height: 32px;    /* affects header height */
    overflow: visible;
  }
  .logo img {
    position: absolute;
    left: 0;
    top: 80%;
    transform: translateY(-50%);
    height: 125px;   /* visual logo size */
    width: auto;
    display: block;
    pointer-events: none;
  }

  /* ---- CALL NOW badge -------------------------------------------------- */
  /* ---- CALL NOW badge -------------------------------------------------- */
.call-now {
  background: linear-gradient(90deg, #0015ffff, #0040ffff);
  box-shadow: 0 0 20px rgba(0, 229, 255, 1), 0 0 40px rgba(0, 132, 255, 0.4);
  color: #ffffff;
  font-size: 1.5rem !important;
  padding: 10px 22px !important;
  border-radius: 14px;
  font-weight: 800;
  text-decoration: none;
  transition: all 0.3s ease;
}

.call-now:hover {
  filter: brightness(1.1);
  transform: scale(1.08);
  box-shadow: 0 0 30px rgba(81, 0, 255, 1);
}

  nav{
    display: flex;
    align-items: center;
    gap: 1.8rem;
    a{
      color: #FFFF;
      padding: 0.6rem;
      font-family: 'Red Hat Display', sans-serif;
      font-weight: 500;
      text-transform: uppercase;
      transition: filter 0.25s;

      &.button{ padding: 0.6rem 2rem; }
      &:hover{ filter: brightness(0.6); }
    }
  }

  .menu-container{ cursor: pointer; padding: 0.6rem 0; }

  .menu{
    width: 2rem; height: 0.2rem; background: #FFFF;
    position: relative; cursor: pointer; display: none;

    &:before{ bottom: 0.5rem; }
    &:after{ top: 0.5rem; }

    &.active:before{ bottom: 0; transform: rotate(45deg); }
    &.active:after{ top: 0; transform: rotate(135deg); }
    &.active{ background-color: transparent; }
  }
  .menu:before, .menu:after {
    content: ""; display: block; position: absolute;
    width: 100%; height: 0.2rem; background: #FFFF; cursor: pointer;
    transition: .6s;
  }

  input[type=checkbox]{ height: 0; width: 0; visibility: hidden; outline: none; }

  label{
    cursor: pointer; text-indent: -9999px;
    width: 55px; height: 30px; background: var(--green);
    display: block; justify-content: center; align-items: center;
    border-radius: 100px; position: relative; margin-left: auto; right: 10px;
  }
  @media only screen and (max-width: 800px){ label { position: relative; } }

  label:after{
    content: ''; background: #FFF; width: 20px; height: 20px; border-radius: 50%;
    position: absolute; top: 5px; left: 4px;
    transition: cubic-bezier(0.68,-0.55,0.27,1.55) 320ms;
  }
  input:checked + label{ background: var(--pink); }
  input:checked + label:after{ left: calc(100% - 5px); transform: translateX(-100%); }

  @media (max-width: 960px){
    padding: 1.8rem 3rem;

    /* mobile: keep logo big but reserve less horizontal space */
    .logo { width: 110px; height: 28px; }
    .logo img { height: 64px; }

    /* show call-now from small tablets upward */
    .call-now{ display: none; }

    .menu{ display: block; }

    nav{
      -ms-overflow-style: none; scrollbar-width: none;
      overflow: hidden; opacity: 0; visibility: hidden;
      flex-direction: column; justify-content: center; align-items: center;
      position: fixed; width: 100vw; height: 100vh; top: 0; left: 0;
      transition: opacity 0.25s; background-color: var(--green);

      a.button{ background-color: var(--pink); }

      &.active{ opacity: 1; visibility: visible; }
    }
  }

  /* show the call-now badge on >=640px */
  @media (min-width: 640px){
    .call-now{ display: inline-flex; }
  }
`;
