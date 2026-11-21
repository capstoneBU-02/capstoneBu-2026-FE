import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../../src/App.tsx'
import { DEFAULT_API_BASE } from '../../src/api/config.ts'
import { loadAppRepositories } from '../../src/app/repositories.ts'
import '../../src/index.css'

// Startup as an http build runs it. The test server stays on mock mode, so
// the mode is set here, and specs answer the API with page.route.
const repositories = await loadAppRepositories(
  { mode: 'http', baseUrl: DEFAULT_API_BASE, credentials: 'same-origin' },
  window.location.search,
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App repositories={repositories} />
  </StrictMode>,
)
