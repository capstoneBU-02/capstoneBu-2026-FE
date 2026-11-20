import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'

const jspdfUnused = fileURLToPath(
  new URL('./src/features/tab/export/jspdfUnused.ts', import.meta.url),
)

export default defineConfig(({ mode }) => {
  // API_PROXY_TARGET has no VITE_ prefix, so it never reaches browser code.
  const env = loadEnv(mode, process.cwd(), '')
  // The dev server and `vite preview` forward /api to the backend, so the
  // browser sees one origin and sends the session cookie without CORS.
  const proxy: Record<string, ProxyOptions> = {
    '/api': { target: env.API_PROXY_TARGET || 'http://localhost:8000' },
  }
  return {
    plugins: [react()],
    resolve: {
      alias: [
        { find: /^(html2canvas|dompurify|canvg)$/, replacement: jspdfUnused },
      ],
    },
    // Loaded only by the PDF download. Bundled up front, so the dev server
    // never reloads the page the first time someone makes a PDF.
    optimizeDeps: { include: ['jspdf', 'svg2pdf.js'] },
    server: { proxy },
    preview: { proxy },
  }
})
