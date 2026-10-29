/**
 * The Mr. Chartist type system (docs/theme/TYPE-SYSTEM.md) for standalone print documents: the slips, registers and
 * letters opened with `window.open` + `document.write`, which do not see the app's stylesheet.
 *
 * `PRINT_FONT_FACE` declares the same self-hosted Chartist fonts (and the Devanagari-only Noto face for Hindi) with
 * root-relative URLs: a document written into a window opened from the app resolves them against the app's origin,
 * so they come from the offline precache. A downloaded copy (pop-ups blocked) cannot reach them and prints in the
 * system font after `PRINT_FONT`. Nothing here is heavier than 600.
 */
export const PRINT_FONT = "'Chartist Sans Flex', 'Noto Sans Devanagari', system-ui, sans-serif";
export const PRINT_HEADING_FONT = "'Chartist Sans', 'Chartist Sans Flex', 'Noto Sans Devanagari', system-ui, sans-serif";

export const PRINT_FONT_FACE =
  "@font-face{font-family:'Chartist Sans Flex';src:url(/fonts/chartist-sans-flex/chartist-sans-flex.woff2) format('woff2');font-weight:300 600;font-style:normal;font-display:swap;size-adjust:107%}" +
  "@font-face{font-family:'Chartist Sans';src:url(/fonts/chartist-sans/chartist-sans.woff2) format('woff2');font-weight:600;font-style:normal;font-display:swap}" +
  "@font-face{font-family:'Noto Sans Devanagari';src:url(/fonts/noto-sans-devanagari-normal-400-devanagari.woff2) format('woff2');font-weight:400;font-display:swap;unicode-range:U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+A830-A839,U+A8E0-A8FF}" +
  "@font-face{font-family:'Noto Sans Devanagari';src:url(/fonts/noto-sans-devanagari-normal-700-devanagari.woff2) format('woff2');font-weight:700;font-display:swap;unicode-range:U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+A830-A839,U+A8E0-A8FF}" +
  `html{font-synthesis-weight:none}h1,h2,h3{font-family:${PRINT_HEADING_FONT}}h1,h2,h3,h4,h5,h6,b,strong,th{font-weight:600}table{font-variant-numeric:tabular-nums}`;

/**
 * Print a window once its fonts are in (at most `waitMs`), so the first print of a session does not come out in
 * the fallback font while Chartist Sans Flex is still loading. Browser-only.
 */
export function printWhenReady(w: Window, waitMs = 1500): void {
  const go = () => {
    w.focus?.();
    w.print();
  };
  const fonts = w.document?.fonts;
  if (!fonts || typeof fonts.load !== 'function') {
    go();
    return;
  }
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    go();
  };
  const timer = setTimeout(once, waitMs);
  Promise.all([fonts.load("400 16px 'Chartist Sans Flex'"), fonts.load("600 16px 'Chartist Sans'")])
    .then(() => fonts.ready)
    .catch(() => undefined)
    .then(() => {
      clearTimeout(timer);
      once();
    });
}
