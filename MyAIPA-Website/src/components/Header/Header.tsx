import { Container } from './styles'
import { BrowserRouter as Router } from 'react-router-dom'
import { NavHashLink, HashLink } from 'react-router-hash-link'
import { useState } from 'react'
import Logo from '../../assets/logo.png'

const DISPLAY_NUMBER = '(905) 555-1234'     // <- change to your real number
const TEL_NUMBER = '+19055551234'           // <- E.164 format

export function Header() {
  const [isActive, setActive] = useState(false)

  function toggleTheme() {
    const html = document.getElementsByTagName('html')[0]
    html.classList.toggle('light')
  }

  function closeMenu() {
    setActive(false)
  }

  return (
    <Container className="header-fixed">
      <Router>
        <div className="brand-row">
          <HashLink smooth to="#home" className="logo">
            <img src={Logo} alt="My AI PA logo" />
          </HashLink>

          <a
            href={`tel:${TEL_NUMBER}`}
            className="call-now"
            aria-label={`Call ${DISPLAY_NUMBER} for live demo`}
          >
            Call Now {DISPLAY_NUMBER} for Live Demo
          </a>
        </div>

        <input
          onChange={toggleTheme}
          className="container_toggle"
          type="checkbox"
          id="switch"
          name="mode"
        />
        <label htmlFor="switch">Toggle</label>

        <nav className={isActive ? 'active' : ''}>
          <NavHashLink smooth to="#home" onClick={closeMenu}>Home</NavHashLink>
          <NavHashLink smooth to="#about" onClick={closeMenu}>Info</NavHashLink>
          <NavHashLink smooth to="#project" onClick={closeMenu}>Demo</NavHashLink>
          <NavHashLink smooth to="#contact" onClick={closeMenu}>Offer</NavHashLink>
        </nav>

        <div
          aria-expanded={isActive ? 'true' : 'false'}
          aria-haspopup="true"
          aria-label={isActive ? 'Close menu' : 'Open menu'}
          className={isActive ? 'menu active' : 'menu'}
          onClick={() => setActive(!isActive)}
        />
      </Router>
    </Container>
  )
}
