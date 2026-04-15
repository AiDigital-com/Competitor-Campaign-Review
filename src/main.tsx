import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/react'
import { applyTheme, resolveTheme } from '@AiDigital-com/design-system'
import '@AiDigital-com/design-system/style.css'
import App from './App'
import './index.css'

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string
const isPublicReport = window.location.pathname.startsWith('/r/')
const isHelpPage = window.location.pathname === '/help'
const isMobile = window.location.pathname === '/m'

applyTheme(resolveTheme())

if (isMobile) {
  import('./pages/MobileApp').then(({ default: MobileApp }) => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode><MobileApp /></React.StrictMode>
    )
  })
} else if (isPublicReport) {
  import('./pages/PublicReportPage').then(({ PublicReportPage }) => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode><PublicReportPage /></React.StrictMode>
    )
  })
} else if (isHelpPage) {
  import('./pages/HelpPage').then(({ default: Help }) => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode><Help /></React.StrictMode>
    )
  })
} else {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ClerkProvider publishableKey={publishableKey}>
        <App />
      </ClerkProvider>
    </React.StrictMode>
  )
}
