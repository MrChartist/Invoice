/**
 * PERF-5: leave first-paint files out of Vite's dynamic-import preload lists (build only).
 *
 * Every chunk with an `import()` carries `__vite__mapDeps`, the files each dynamic import preloads. Vite lists the
 * whole static closure, so the rolldown runtime, the entry, vendor-react and vendor-ui were named in ~260 lists.
 * They are always loaded before any `import()` can run (the entry is the page's script, the rest are its
 * `<link rel="modulepreload">`s), so `__vitePreload` skips them at run time anyway: dropping them changes no request.
 *
 * `preloadTrim()` returns the plugin (records the entry's static closure once the bundle is generated, before Vite's
 * import analysis writes the lists) and the `resolveDependencies` hook for `build.modulePreload`. The HTML's own
 * modulepreload links (`hostType: 'html'`) are never touched; CSS deps never reach the hook (Vite appends them).
 */
export function preloadTrim() {
  /** File names of the entry chunks and everything they import statically. */
  const firstPaint = new Set();
  const plugin = {
    name: 'preload-trim',
    apply: 'build',
    generateBundle: {
      order: 'pre',
      handler(_opts, bundle) {
        firstPaint.clear();
        const visit = (file) => {
          const c = bundle[file];
          if (!c || c.type !== 'chunk' || firstPaint.has(file)) return;
          firstPaint.add(file);
          c.imports.forEach(visit);
        };
        for (const c of Object.values(bundle)) if (c.type === 'chunk' && c.isEntry) visit(c.fileName);
      },
    },
  };
  /** @type {(filename: string, deps: string[], ctx: { hostType: 'html' | 'js' }) => string[]} */
  const resolveDependencies = (_file, deps, { hostType }) => (hostType === 'js' ? deps.filter((d) => !firstPaint.has(d)) : deps);
  return { plugin, resolveDependencies, firstPaint };
}

const MAP_HEAD = 'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=[';
const MAP_TAIL = '])))=>i.map(i=>d[i]);';
/** PERF-7: the short name the preload lists get (checked absent from each chunk before it is used). */
export const MAP_NAME = '__vmd';

/**
 * PERF-7: a shorter form of Vite's preload list, per chunk (pure text, same values). Vite writes
 * `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/a.js",…])))=>i.map(i=>d[i]);` and calls
 * `__vite__mapDeps([0,3])` at each `import()`. This gives `const __vmd=(i,d=["a.js",…])=>i.map(i=>"assets/"+d[i]);`
 * and `__vmd([0,3])`: the same file names for the same calls (the list is rebuilt per call instead of memoised on the
 * function: a few strings, once per dynamic import). Each chunk is gzipped on its own, so the repeated head, the
 * `assets/` prefix of every entry and the long call name were paid in ~245 chunks. Returns null when the chunk has no
 * list; throws when the list is not in the exact form above (a Vite change), so the build fails instead of shipping a
 * half-rewritten chunk.
 */
export function compactMapDeps(code, file = '') {
  if (!code.includes('__vite__mapDeps')) return null;
  const start = code.indexOf(MAP_HEAD);
  const end = start < 0 ? -1 : code.indexOf(MAP_TAIL, start);
  if (start < 0 || end < 0 || code.indexOf(MAP_HEAD, start + 1) >= 0) throw new Error(`preload list of ${file} is not in the expected form`);
  if (new RegExp(`\\b${MAP_NAME}\\b`).test(code)) throw new Error(`${file} already uses the name ${MAP_NAME}`);
  const list = JSON.parse(code.slice(start + MAP_HEAD.length - 1, end + 1));
  if (!Array.isArray(list) || !list.every((f) => typeof f === 'string' && f.startsWith('assets/'))) throw new Error(`preload list of ${file} names a file outside assets/`);
  const head = `const ${MAP_NAME}=(i,d=${JSON.stringify(list.map((f) => f.slice(7)))})=>i.map(i=>"assets/"+d[i]);`;
  const rest = code.slice(end + MAP_TAIL.length);
  const uses = rest.split('__vite__mapDeps').length - 1;
  const calls = rest.split('__vite__mapDeps(');
  if (calls.length - 1 !== uses) throw new Error(`${file} uses __vite__mapDeps outside a call`);
  return code.slice(0, start) + head + calls.join(`${MAP_NAME}(`);
}

/** PERF-7: rewrites every chunk's preload list with `compactMapDeps` once Vite has written them (build only). */
export function mapDepsCompact() {
  return {
    name: 'map-deps-compact',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_opts, bundle) {
        for (const c of Object.values(bundle)) {
          if (c.type !== 'chunk') continue;
          const next = compactMapDeps(c.code, c.fileName);
          if (next !== null) c.code = next;
        }
      },
    },
  };
}
