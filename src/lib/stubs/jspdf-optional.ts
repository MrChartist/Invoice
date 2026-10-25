/**
 * Build-time stand-in for jsPDF's optional dynamic imports (`html2canvas`, `canvg`,
 * `dompurify`). They back only `doc.html()` and `addSvgAsImage()`, which this app never
 * calls (pages are rasterised by html-to-image). Aliased in vite.config.ts so ~95 kB gz of
 * dead code is not built, precached by the service worker, or downloaded on install.
 */
function unavailable(): never {
  throw new Error('This jsPDF feature is not bundled (see src/lib/stubs/jspdf-optional.ts).');
}

export default unavailable;
