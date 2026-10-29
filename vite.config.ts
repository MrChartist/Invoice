import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { fileURLToPath } from 'node:url'
import { CSP_META } from './scripts/security-headers.mjs'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { hiSplit, langChunkName } from './scripts/vite-hi-split.mjs'
import { createGraph, familyRe, graphPlugin, leafGroup, safeFamilyGroup } from './scripts/vite-safe-groups.mjs'
import { preloadTrim } from './scripts/vite-preload-trim.mjs'

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

const VENDOR_REACT = /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/
// PERF-4: no `qrcode.react` here — only lazy screens import it, and in vendor-ui it cost first paint 5.7 kB gz.
const VENDOR_UI = /node_modules[\\/](lucide-react|zustand|clsx)[\\/]/
// R16-A2: the module graph the safe groups read (filled at buildEnd; build-meta/chunks.json for check-bundle-size).
const graph = createGraph({ vendor: [VENDOR_REACT, VENDOR_UI], root: fileURLToPath(new URL('.', import.meta.url)) })
// PERF-5: first-paint files (always loaded before any import()) left out of the dynamic-import preload lists.
const preload = preloadTrim()

// https://vite.dev/config/
export default defineConfig({
  // R16-A1: hi-split moves defineArea Hindi into lang-hi-* chunks (build only; dev keeps it inline).
  plugins: [react(), cspMeta(), hiSplit(), graphPlugin(graph), preload.plugin],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  css: {
    // PERF-5: CSS-module class names `_<local>_<file hash>` (Vite's default adds `_<line>`). The file hash is the
    // same for every class of a file, so it compresses; the line number did not (−7.6 kB gz core). 6 base64url
    // characters of the file's SHA-256 (36 bits) keep two files' same-named classes apart.
    modules: { generateScopedName: (name: string, _file: string, css: string) => `_${name}_${createHash('sha256').update(css).digest('base64url').slice(0, 6)}` },
  },
  resolve: {
    // jsPDF's optional imports (doc.html / addSvgAsImage only) are never used: see the stub.
    alias: {
      ...Object.fromEntries(
        ['html2canvas', 'canvg', 'dompurify'].map((m) => [m, fileURLToPath(new URL('./src/lib/stubs/jspdf-optional.ts', import.meta.url))]),
      ),
      // PERF-5: fast-png (jsPDF's PNG decoder) inflates with jsPDF's own fflate, not a second zlib library (−20 kB gz).
      pako: fileURLToPath(new URL('./src/lib/stubs/pako-fflate.ts', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    modulePreload: { resolveDependencies: preload.resolveDependencies },
    rolldownOptions: {
      output: {
        // PERF-5: 7-character hashes (default 8): every file name is repeated in ~10,000 import statements and
        // preload lists, and a hash character does not compress (−10 kB core). 7 is rolldown's minimum while a build
        // has fewer than 4,096 chunks (it fails the build, never silently, if that is ever not enough).
        entryFileNames: 'assets/[name]-[hash:7].js',
        chunkFileNames: 'assets/[name]-[hash:7].js',
        assetFileNames: 'assets/[name]-[hash:7][extname]',
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
            { name: 'vendor-react', test: VENDOR_REACT, priority: 30 },
            { name: 'vendor-ui', test: VENDOR_UI, priority: 30 },
            // R16-A1: language packs — lang-hi-<family> (defineArea Hindi), lang-hi-core (hi.ts), lang-regional.
            // They import nothing, so nothing is dragged; precached only on devices in that language.
            { name: langChunkName, priority: 25 },
            // R15-A1: every first-paint app module in ONE chunk (measured −43.4 kB total, −2.3 kB initial).
            { name: 'app-initial', tags: ['$initial'], priority: 20 },
            // R16-A2: safe family groups (a module joins only if nothing it imports can be dragged along).
            // A later family adds one row: safeFamilyGroup(graph, 'f-<family>', familyRe(<lib dir>, <rules file>, <area prefix>), 12).
            safeFamilyGroup(graph, 'f-hotel', familyRe('hotel', null, 'hotel-[a-z]+-r7'), 12),
            safeFamilyGroup(graph, 'f-trade', familyRe('trade', 'trading-rules', 'trade-r8'), 12),
            safeFamilyGroup(graph, 'f-retail', familyRe('retail', 'retail-rules', 'retail-r9'), 12),
            safeFamilyGroup(graph, 'f-services', familyRe('services', 'service-rules', 'services-r10'), 12),
            safeFamilyGroup(graph, 'f-cn', familyRe('construction', 'construction-rules', 'construction-r11'), 12),
            safeFamilyGroup(graph, 'f-agri', familyRe('agri', 'agri-rules', 'agri-r12'), 12),
            safeFamilyGroup(graph, 'f-mfg', familyRe('mfg', 'mfg-rules', 'mfg-r13'), 12),
            safeFamilyGroup(graph, 'f-prof', familyRe('prof', 'prof-rules', 'prof-r14'), 12),
            safeFamilyGroup(graph, 'f-travel', familyRe('travel', 'travel-rules', 'travel-r15'), 12),
            safeFamilyGroup(graph, 'f-manpower', familyRe('manpower', 'manpower-rules', 'manpower-r17', 'mp-registry'), 12), // R17-A: the registry stays a lazy leaf (sync / recycle bin)
            safeFamilyGroup(graph, 'f-society', familyRe('society', 'society-rules', 'society-r18', 'hs-registry'), 12), // R18-A: the registry stays a lazy leaf (sync / recycle bin)
            safeFamilyGroup(graph, 'f-logistics', familyRe('logistics', 'logistics-rules', 'logistics-r19', 'lg-registry'), 12), // R19-A: the registry stays a lazy leaf (sync / recycle bin)
            // R16-A2: small lazy src/lib leaves (imports all first-paint / vendor) in one chunk.
            leafGroup(graph, 'lazy-leaves', 9, { maxModuleSize: 3000 }),
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
