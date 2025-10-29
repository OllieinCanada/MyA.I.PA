// App.tsx
import React, { useEffect } from 'react'
import { Footer } from './components/Footer/Footer'
import { Header } from './components/Header/Header'
import { Main } from './components/Main/Main'
import { GlobalStyle } from './styles/global'
import 'react-toastify/dist/ReactToastify.css'

function HashScrollOnce() {
  useEffect(() => {
    const raw = window.location.hash
    if (!raw) return
    const id = decodeURIComponent(raw.slice(1))

    // wait a tick for layout, then scroll ONCE
    const t = setTimeout(() => {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)

    return () => clearTimeout(t)
  }, [])
  return null
}

export default function App() {
  return (
    <>
      <GlobalStyle />
      <Header />
      <Main />
      <Footer />
      <HashScrollOnce />
    </>
  )
}
