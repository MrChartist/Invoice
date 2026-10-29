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
