import { Container } from './styles'

export function Footer() {
  return (
    <Container className="footer">
      <a href="https://www.myaipa.ca" className="logo">
        <span>www.</span>
        <span>myaipa.ca</span>
      </a>
      <div>
        <p>© 2025 My AI PA. All rights reserved.</p>
      </div>
    </Container>
  )
}
