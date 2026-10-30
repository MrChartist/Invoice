/**
 * Beta "Report a problem" (Help menu): a plain-text diagnostic a tester pastes into the feedback
 * channel. Built on the device, never sent anywhere, and it carries NO business data: no names,
 * amounts, numbers or table contents — only the app build, the browser, the screen (ids masked),
 * recent error messages (scrubbed) and a storage health summary (sizes and flags).
 *
 * Pure (unit-tested in tests/diagnostics.test.ts); the dialog gathers the inputs.
 */

export interface DiagnosticsInput {
  appVersion: string;
  /** Service-worker precache build id (`mci-shell-<id>` cache), null when none is installed. */
  buildId: string | null;
  userAgent: string;
  uiLanguage: string;
  theme: string;
  online: boolean;
  /** Installed as an app (display-mode standalone). */
  standalone: boolean;
  /** A service worker controls this page (offline-ready). */
  offlineReady: boolean;
  viewport: string;
  pathname: string;
  search: string;
  errors: readonly string[];
  /** R6-A5: screens visited before this one in the session (already masked, `route-trail.ts`), oldest first. */
  trail?: readonly string[];
  storage: {
    backend: string;
    vault: boolean;
    /** Message of the current write failure, if any (e.g. quota). */
    failure: string | null;
    level: string;
    pct: number;
    usedChars: number;
    quotaChars: number;
    keyCount: number;
    persisted: boolean | null;
    lastBackupIso: string | null;
    /** Health finding ids with their level, e.g. `backup-stale:warn`. */
    findings: readonly string[];
  };
  now: Date;
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mask anything in a free-text error message that could identify a business or a person:
 * e-mail addresses, GSTINs, PANs, document numbers, long digit runs (phones, accounts, amounts),
 * quoted values, data: URLs and record ids.
 */
export function scrubText(s: string): string {
  return s
    .replace(/data:[^\s"')]+/gi, '[data-url]')
    .replace(/[^\s@"'<>()]+@[^\s@"'<>()]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/gi, '[gstin]')
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/gi, '[pan]') // QA7 G6: typed in lower / mixed case too
    .replace(UUID, '[id]')
    .replace(/\b[A-Z]{2,6}\/[A-Z0-9-]+\/\d+\b/gi, '[doc-no]')
    .replace(/"[^"]{1,200}"|'[^']{1,200}'|“[^”]{1,200}”/g, '"…"')
    .replace(/₹\s?[\d,]+(\.\d+)?/g, '₹[amount]')
    .replace(/\d[\d,.\s-]{4,}\d/g, '[number]');
}

/**
 * R6-A5: text the tester typed in the report form. `scrubText` plus every run of 4+ digits and "Rs / INR <n>"
 * amounts, so a phone, an amount or a GSTIN typed by habit does not travel. QA7 G6: Devanagari digits are read as
 * digits first; UPI IDs (`name@bank`, no dotted domain), Indian-grouped amounts ("1,250", "1,25,000"), "12.5k" /
 * "2 lakh" and any number next to "₹ / rs / rupees / रुपये" are masked too. Short codes stay readable ("194C",
 * "GSTR-3B"). Names cannot be detected: the form asks the tester not to type them.
 */
export function scrubTyped(s: string): string {
  return scrubText(s.replace(/[\u0966-\u096F]/g, (d) => String(d.charCodeAt(0) - 0x966)))
    .replace(/[\w.-]+@[a-z][a-z0-9.-]*/gi, '[upi]')
    .replace(/\b(?:rs\.?|inr|rupees?)\s?\d[\d,]*(?:\.\d+)?/gi, '[amount]')
    .replace(/\d[\d,]*(?:\.\d+)?\s?(?:k|lakhs?|lacs?|cr|crores?|rs\.?|rupees?|रुपये|रुपए|रु\.?)(?![a-z])/gi, '[amount]')
    .replace(/\b\d{1,3}(?:,\d{2,3})+(?:\.\d+)?/g, '[amount]')
    .replace(/\d{4,}/g, '[number]');
}

/** The current screen without record ids or query values (`/invoice/:id?tab=…`). */
export function scrubRoute(pathname: string, search: string): string {
  const path = (pathname || '/')
    .split('/')
    .map((seg) => (ID_SEGMENT.test(seg) || /\d{3,}/.test(seg) || seg.length > 24 ? ':id' : seg))
    .join('/');
  const keys = [...new URLSearchParams(search).keys()];
  return keys.length ? `${path}?${keys.map((k) => `${k}=…`).join('&')}` : path;
}

const kb = (chars: number) => `${Math.max(0, Math.round(chars / 1024)).toLocaleString('en-IN')} KB`;

export function buildDiagnostics(d: DiagnosticsInput): string {
  const s = d.storage;
  const lines = [
    'Mr. Chartist Invoice: beta diagnostic report',
    `Generated: ${d.now.toISOString()}`,
    '',
    '[App]',
    `Version: ${d.appVersion}`,
    `Build: ${d.buildId ?? 'not installed (no offline cache yet)'}`,
    `Offline-ready: ${d.offlineReady ? 'yes' : 'no'} · Installed app: ${d.standalone ? 'yes' : 'no'} · Online: ${d.online ? 'yes' : 'no'}`,
    `Language: ${d.uiLanguage} · Theme: ${d.theme} · Viewport: ${d.viewport}`,
    `Screen: ${scrubRoute(d.pathname, d.search)}`,
    ...(d.trail?.length ? ['', `[Screens before] (${d.trail.length}, oldest first)`, ...d.trail.map((r) => `- ${r}`)] : []),
    '',
    '[Browser]',
    d.userAgent || 'unknown',
    '',
    '[Storage health]',
    `Backend: ${s.backend}${s.vault ? ' (vault encryption on)' : ''} · Persistent: ${s.persisted === null ? 'unknown' : s.persisted ? 'yes' : 'no'}`,
    `Used: ${kb(s.usedChars)} of ~${kb(s.quotaChars)} (${Math.round(s.pct)}%) · Keys: ${s.keyCount} · Health: ${s.level}`,
    `Last backup: ${s.lastBackupIso ? s.lastBackupIso.slice(0, 10) : 'never'}`,
    `Write failure: ${s.failure ? scrubText(s.failure) : 'none'}`,
    `Findings: ${s.findings.length ? s.findings.join(', ') : 'none'}`,
    '',
    `[Recent errors] (${d.errors.length}, newest last, scrubbed)`,
    ...(d.errors.length ? d.errors.map((e) => `- ${scrubText(e)}`) : ['none']),
    '',
    'No business data is included. Describe what you did, what you expected and what happened above this report.',
  ];
  return lines.join('\n');
}
