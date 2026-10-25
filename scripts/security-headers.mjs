/**
 * Single source of truth for the HTTP headers every host must send.
 * `node scripts/gen-headers.mjs` writes public/_headers, the [[headers]] blocks of netlify.toml
 * and the "headers" array of vercel.json from this file; `--check` (run by the tests) fails on drift.
 * vite.config.ts also injects CSP_META into the built index.html for hosts that ignore header files.
 */

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

/** `frame-ancestors` is ignored in a <meta> CSP (header only), so it is left out there. */
export const CSP_META = CSP.split('; ').filter((d) => !d.startsWith('frame-ancestors')).join('; ');

/** [path pattern ("/*" style), headers] in output order. */
export const HEADER_RULES = [
  ['/*', {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  }],
  ['/assets/*', { 'Cache-Control': 'public, max-age=31536000, immutable' }],
  ['/index.html', { 'Cache-Control': 'no-cache' }],
  ['/sw.js', { 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' }],
  ['/precache-manifest.json', { 'Cache-Control': 'no-cache' }],
  ['/manifest.json', { 'Cache-Control': 'no-cache', 'Content-Type': 'application/manifest+json' }],
];
