import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { apiConfig } from './api/config.ts'
import App from './App.tsx'
import { loadAppRepositories } from './app/repositories.ts'
import { StartupError } from './app/StartupError.tsx'
import './index.css'

const root = createRoot(document.getElementById('root')!)

try {
  const repositories = await loadAppRepositories(
    apiConfig(),
    window.location.search,
  )
  root.render(
    <StrictMode>
      <App repositories={repositories} />
    </StrictMode>,
  )
} catch (error) {
  console.error(error)
  root.render(
    <StrictMode>
      <StartupError />
    </StrictMode>,
  )
}
