/**
 * R6-A5: the last 10 screens of this session for "Report a problem" ("Screens before"). Memory only, never stored.
 * Record ids are masked as in `scrubRoute`; only `tab` / `view` values from the app's own vocabulary are kept.
 * Pushed by the shell on every route change (R6-B's line in DashboardLayout), so it stays tiny and import-free.
 */
const trail: string[] = [];
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

export function maskRoute(pathname: string, search = ''): string {
  const path = (pathname || '/').split('/').map((s) => (ID.test(s) || /\d{3,}/.test(s) || s.length > 24 ? ':id' : s)).join('/');
  const q = [...new URLSearchParams(search).entries()].map(([k, v]) => `${k}=${(k === 'tab' || k === 'view') && /^[a-z0-9-]{1,24}$/.test(v) ? v : '…'}`);
  return q.length ? `${path}?${q.join('&')}` : path;
}

export function pushRoute(loc: { pathname: string; search?: string }): void {
  const r = maskRoute(loc.pathname, loc.search);
  if (trail[trail.length - 1] === r) return;
  trail.push(r);
  if (trail.length > 10) trail.shift();
}

export const recentRoutes = (): string[] => [...trail];

export function clearRouteTrail(): void {
  trail.length = 0;
}
