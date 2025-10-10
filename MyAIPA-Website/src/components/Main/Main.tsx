import Particles from "react-tsparticles"
import { Container } from "./styles"
import { Hero } from "../Hero/Hero"
import { About } from "../Info/Info"
import Project from '../Demo/Demo';  // if Demo exports default
import { Project as Contact } from '../Contact/Contact'; // if Contact exports { Project }


export function Main() {
  return (
    <Container>
      <Particles
        id="tsparticles"
        options={{
          fullScreen: { enable: true, zIndex: 1 },
          detectRetina: true,
          fpsLimit: 60,
          interactivity: {
            events: {
              onClick: { enable: true, mode: "push" },
              onHover: { enable: true, mode: "bubble" },
              resize: true,
            },
            modes: {
              bubble: {
                distance: 400,
                duration: 2,
                opacity: 0.8,
                size: 2,
              },
              push: { quantity: 2 },
              repulse: { distance: 200, duration: 0.4 },
            },
          },
          particles: {
            color: { value: "#ffffff" },
            move: {
              enable: true,
              speed: 2,
              outMode: "out",
            },
            number: {
              density: { enable: true, area: 800 },
              value: 20,
            },
            opacity: {
              random: true,
              value: 1,
              animation: {
                enable: true,
                speed: 1,
                minimumValue: 0.2,
                sync: false,
              },
            },
            shape: { type: "circle" },
            size: {
              value: 3,
              random: true,
            },
          },
          background: {
            color: "#0d1117",
            position: "50% 50%",
            repeat: "no-repeat",
            size: "cover",
          },
        }}
      />
      <Hero />
      <About />
      <Project />
      <Contact />
    </Container>
  )
}
