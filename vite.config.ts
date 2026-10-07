import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    rolldownOptions: {
      output: {
        // Long-term-cacheable vendor chunks. Do NOT add a manual chunk for the PDF
        // stack (jspdf/html2canvas/html-to-image/dompurify): rolldown hoists shared
        // CJS interop helpers into it, which makes vendor-react import it and defeats
        // lazy loading (measured: +180 kB gz on first paint). Let dynamic import()
        // split it naturally (see docs/qa/performance.md).
        manualChunks(id: string) {
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) {
            return 'vendor-react';
          }
          if (/node_modules\/(lucide-react|qrcode\.react|zustand|clsx)\//.test(id)) {
            return 'vendor-ui';
          }
        },
      },
    },
    // vendor-pdf is lazy-loaded; real budgets are enforced by scripts/check-bundle-size.mjs
    chunkSizeWarningLimit: 650,
    emptyOutDir: true,
    sourcemap: false,
  },
})
