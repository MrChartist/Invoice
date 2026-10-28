import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { fileURLToPath } from 'node:url'
import { CSP_META } from './scripts/security-headers.mjs'
import { readFileSync } from 'node:fs'

// R6-A4: the version shown in Help, What's new and the diagnostic report comes from package.json.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

/**
 * Production builds also carry the CSP as a <meta> tag, so hosts that ignore _headers /
 * netlify.toml / vercel.json (GitHub Pages, a plain static server) still get it. Build only:
 * the dev server injects inline scripts that `script-src 'self'` would block.
 */
function cspMeta(): Plugin {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP_META }, injectTo: 'head-prepend' },
    ],
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cspMeta()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    // jsPDF's optional imports (doc.html / addSvgAsImage only) are never used: see the stub.
    alias: Object.fromEntries(
      ['html2canvas', 'canvg', 'dompurify'].map((m) => [m, fileURLToPath(new URL('./src/lib/stubs/jspdf-optional.ts', import.meta.url))]),
    ),
  },
  build: {
    target: 'es2022',
    rolldownOptions: {
      output: {
        // Long-term-cacheable vendor chunks. Do NOT add a manual chunk for the PDF
        // stack (jspdf/html2canvas/html-to-image/dompurify): rolldown hoists shared
        // CJS interop helpers into it, which makes vendor-react import it and defeats
        // lazy loading (measured: +180 kB gz on first paint). Let dynamic import()
        // split it naturally (see docs/qa/performance.md). `app-initial` captures
        // `$initial` modules only; never add a group that can capture `jspdf` / `html-to-image`.
        // Vite 8 / rolldown: keep `rolldownOptions` + `codeSplitting.groups` (not
        // `rollupOptions` / `manualChunks`).
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/, priority: 30 },
            { name: 'vendor-ui', test: /node_modules[\\/](lucide-react|qrcode\.react|zustand|clsx)[\\/]/, priority: 30 },
            // R15-A1: every first-paint app module in ONE chunk (measured −43.4 kB total, −2.3 kB initial).
            { name: 'app-initial', tags: ['$initial'], priority: 20 },
          ],
        },
      },
    },
    // vendor-pdf is lazy-loaded; real budgets are enforced by scripts/check-bundle-size.mjs
    chunkSizeWarningLimit: 650,
    emptyOutDir: true,
    sourcemap: false,
  },
})
