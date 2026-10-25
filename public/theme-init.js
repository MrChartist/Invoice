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
    if (localStorage.getItem('mrchartist_inv_lang') === 'hi') document.documentElement.lang = 'hi';
  } catch (e) {}
})();
