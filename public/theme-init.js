// Applies the saved theme before first paint so there is no light/dark flash.
// Kept as an external file (not inline) so the Content-Security-Policy can stay script-src 'self'.
(function () {
  try {
    var t = localStorage.getItem('theme');
    var dark = t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#000000' : '#f6f6f7');
    // Interface language (5.4, device-local): set <html lang> before the app boots.
    var lang = localStorage.getItem('mrchartist_inv_lang');
    if (lang && /^(hi|mr|gu|ta|bn|te|kn)$/.test(lang)) document.documentElement.lang = lang;
  } catch (e) {}
  // Display preferences (R2-C6, device-local, never backed up): classes honoured by src/index.css.
  // Must stay in step with displayClasses() in src/lib/display-prefs.ts (tests/display-prefs.test.ts).
  try {
    var raw = localStorage.getItem('mrchartist_display_prefs');
    var p = raw ? JSON.parse(raw) : null;
    if (p && typeof p === 'object') {
      var c = document.documentElement.classList;
      var s = typeof p.text_scale === 'number' ? p.text_scale : typeof p.text_scale === 'string' && p.text_scale !== '' ? Number(p.text_scale) : NaN;
      if (isFinite(s)) {
        s = Math.round(Math.min(130, Math.max(90, s)) / 10) * 10;
        if (s !== 100) c.add('a11y-text-' + s);
      }
      if (p.high_contrast === true) c.add('a11y-contrast');
      if (p.motion === 'reduce') c.add('a11y-motion-reduce');
      if (p.motion === 'full') c.add('a11y-motion-full');
      if (p.underline_links === true) c.add('a11y-underline');
      if (p.large_targets === true) c.add('a11y-targets');
      if (p.focus_always === true) c.add('a11y-focus');
    }
  } catch (e) {}
})();
