/**
 * Shared helpers for scripts/verify-offline.mjs and tests/perf/run.mjs.
 * - serve(): tiny static server for dist/ with SPA fallback and the headers from public/_headers
 *   (so the production bundle is exercised under the real CSP / cache headers).
 * - loadPlaywright(): playwright is NOT a project dependency; resolve it from the project,
 *   NODE_PATH, or the global npm prefix.
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const DIST = process.env.DIST_DIR || join(ROOT, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.xml': 'application/xml',
};

export function parseHeadersFile(file = join(ROOT, 'public', '_headers')) {
  const rules = [];
  let cur = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) { cur = { pattern: line.trim(), headers: {} }; rules.push(cur); continue; }
    const i = line.indexOf(':');
    cur.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return rules;
}

function matches(pattern, path) {
  if (pattern.endsWith('/*')) return path.startsWith(pattern.slice(0, -1));
  return pattern === path;
}

/** distDir may be swapped at runtime via the returned `setDist` (used by the update test). */
export async function serve({ dist = DIST, port = 0, headers = true } = {}) {
  const state = { dist, log: [], rules: parseHeadersFile(), offline: false, refused: [] };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let path = decodeURIComponent(url.pathname);
    if (state.offline) { state.refused.push(path); return req.socket.destroy(); } // real offline: SW fetches are not covered by context.setOffline
    state.log.push(path);
    let file = normalize(join(state.dist, path));
    if (!file.startsWith(state.dist)) { res.writeHead(403); return res.end(); }
    if (path === '/' || !existsSync(file) || statSync(file).isDirectory()) {
      // SPA fallback only for extension-less paths; missing assets must 404.
      if (extname(path)) { res.writeHead(404); return res.end('not found'); }
      file = join(state.dist, 'index.html');
      path = '/index.html';
    }
    const h = { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' };
    if (headers) for (const r of state.rules) if (matches(r.pattern, path) || (path === '/index.html' && r.pattern === '/index.html')) Object.assign(h, r.headers);
    res.writeHead(200, h);
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, state, setDist: (d) => { state.dist = d; }, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

export async function loadPlaywright() {
  const req = createRequire(import.meta.url);
  const candidates = ['playwright', 'playwright-core'];
  for (const c of candidates) { try { return req(c); } catch { /* next */ } }
  let globalRoot = '';
  try { globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim(); } catch { /* ignore */ }
  for (const c of candidates) {
    for (const base of [process.env.NODE_PATH, globalRoot].filter(Boolean)) {
      try { return req(join(base, c)); } catch { /* next */ }
    }
  }
  throw new Error('playwright not found (install globally or `npm i -D playwright` locally; it is intentionally not a project dependency)');
}

export const AUTH = { name: 'QA', pin: '1234', createdAt: new Date().toISOString() };

/** Seed the PIN session before any app script runs. */
export async function seedAuth(context, extra = {}) {
  await context.addInitScript(([auth, extraStore]) => {
    try {
      if (!localStorage.getItem('mrchartist_inv_auth')) localStorage.setItem('mrchartist_inv_auth', JSON.stringify(auth));
      for (const [k, v] of Object.entries(extraStore)) if (!localStorage.getItem(k)) localStorage.setItem(k, v);
    } catch { /* ignore */ }
  }, [AUTH, extra]);
}

/** Records console errors, page errors and CSP violations. */
export function watch(page, sink) {
  page.on('console', (m) => { if (m.type() === 'error') sink.push({ kind: 'console', text: m.text(), url: page.url() }); });
  page.on('pageerror', (e) => sink.push({ kind: 'pageerror', text: String(e), url: page.url() }));
}

export const isCsp = (e) => /content security policy|violates the following/i.test(e.text);
/** Google Fonts are unreachable in the sandbox/offline; those failures are expected. */
export const isFontNoise = (e) => /fonts\.(googleapis|gstatic)\.com|ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|TUNNEL|CONNECTION|FAILED|PROXY)|Failed to load resource/i.test(e.text);
