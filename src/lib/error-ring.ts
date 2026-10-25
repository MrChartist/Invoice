/**
 * Beta diagnostics: the last 20 console errors / uncaught errors of this tab, kept in memory only
 * (never stored, never sent). "Help → Report a problem" reads them; nothing else does.
 * Installed first thing in main.tsx, so it stays tiny (it ships in the shell).
 */
const ring: string[] = [];

/** Newest last. */
export const recentErrors = (): string[] => ring.slice();

export function installErrorRing(): void {
  const text = (v: unknown) => (v instanceof Error ? `${v.name}: ${v.message}` : String(v));
  const add = (msg: () => string) => {
    try {
      ring.push(`${new Date().toISOString().slice(11, 19)} ${msg().slice(0, 300)}`);
      if (ring.length > 20) ring.shift();
    } catch {
      /* never break logging */
    }
  };
  const original = console.error;
  console.error = (...args: unknown[]) => {
    add(() => args.map(text).join(' '));
    original.apply(console, args);
  };
  addEventListener('error', (e) => add(() => `Uncaught ${e.message}`));
  addEventListener('unhandledrejection', (e) => add(() => `Unhandled rejection ${text(e.reason)}`));
}
