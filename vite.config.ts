import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const jspdfUnused = fileURLToPath(
  new URL('./src/features/tab/export/jspdfUnused.ts', import.meta.url),
)

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^(html2canvas|dompurify|canvg)$/, replacement: jspdfUnused },
    ],
  },
  // Loaded only by the PDF download. Bundled up front, so the dev server
  // never reloads the page the first time someone makes a PDF.
  optimizeDeps: { include: ['jspdf', 'svg2pdf.js'] },
})
