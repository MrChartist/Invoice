/**
 * R6-A5: "Report a problem / Suggest an idea / Ask a question" — compose the text a tester shares, cap it for
 * WhatsApp / e-mail links, and build those links. Pure (tests/diagnostics.test.ts).
 *
 * Nothing is sent by the app. The links open WhatsApp / the mail app with the text filled in and NO fixed recipient
 * (the tester picks the beta group or address there). `FEEDBACK_CONTACT` is the one place a future contact goes;
 * it is empty on purpose (lead decision, Round 6 open question 1).
 */
import { scrubTyped } from './diagnostics';

export type FeedbackKind = 'problem' | 'idea' | 'question';
export type FeedbackSeverity = 'blocks' | 'annoying' | 'cosmetic';

export interface FeedbackDraft {
  kind: FeedbackKind;
  /** Help topic title of the area (prefilled from the current screen). */
  area: string;
  did: string;
  expected: string;
  actual: string;
  severity: FeedbackSeverity;
}

/** A future fixed recipient. Empty: links open with no recipient and the tester chooses one. */
export const FEEDBACK_CONTACT: { readonly whatsapp: string; readonly email: string } = { whatsapp: '', email: '' };

/** Device-local unsent draft (`try / catch` around every read / write). */
export const FEEDBACK_DRAFT_KEY = 'mrchartist_feedback_draft';

/**
 * WhatsApp / mailto bodies are kept under this many characters ONCE ENCODED for the link (QA7 G5: a space is 3
 * characters there and a Devanagari letter 9; long URLs fail on some phones).
 */
export const SHARE_CAP = 1800;

const KIND_TEXT: Record<FeedbackKind, string> = { problem: 'Problem', idea: 'Idea', question: 'Question' };
const SEVERITY_TEXT: Record<FeedbackSeverity, string> = { blocks: 'Blocks me', annoying: 'Annoying', cosmetic: 'Cosmetic' };

export const emptyDraft = (area = ''): FeedbackDraft => ({ kind: 'problem', area, did: '', expected: '', actual: '', severity: 'annoying' });

/** The typed part of the report (scrubbed). An idea / question has no expected / actual block. */
export function composeTyped(d: FeedbackDraft): string {
  const lines = [`Mr. Chartist Invoice — beta ${KIND_TEXT[d.kind].toLowerCase()}`, `Kind: ${KIND_TEXT[d.kind]} · Area: ${scrubTyped(d.area) || '—'}`];
  if (d.kind === 'problem') lines.push(`Severity: ${SEVERITY_TEXT[d.severity]}`);
  const block = (head: string, text: string) => (text.trim() ? ['', `${head}:`, scrubTyped(text.trim())] : []);
  lines.push(...block(d.kind === 'idea' ? 'Idea' : d.kind === 'question' ? 'Question' : 'What I did', d.did));
  if (d.kind === 'problem') {
    lines.push(...block('What I expected', d.expected));
    lines.push(...block('What happened instead', d.actual));
  }
  return lines.join('\n');
}

/** The full text: the typed part, then the diagnostic block unchanged. */
export function composeFeedback(d: FeedbackDraft, diagnostics: string): string {
  return `${composeTyped(d)}\n\n${diagnostics}`.trim();
}

/** Lone UTF-16 surrogates (a half emoji pasted in) become U+FFFD, so `encodeURIComponent` never throws. */
export const wellFormed = (s: string): string =>
  s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');

/** Length of `s` inside a link (`encodeURIComponent`); the text is well-formed by then. */
export const encodedLength = (s: string): number => encodeURIComponent(s).length;

/**
 * Text for a WhatsApp / e-mail link: the full text when its ENCODED length fits `cap` (QA7 G5), else the typed part
 * with the diagnostics shortened line by line from the end and a note that the full report was copied. When the
 * typed part alone is too long it is cut by code points (QA7 G4: never inside an emoji's surrogate pair).
 */
export function capForShare(d: FeedbackDraft, diagnostics: string, cap = SHARE_CAP): { text: string; shortened: boolean } {
  const typed = wellFormed(composeTyped(d));
  const full = wellFormed(`${typed}\n\n${diagnostics}`.trim()); // = composeFeedback, scrubbed once
  if (encodedLength(full) <= cap) return { text: full, shortened: false };
  const note = '\n… (diagnostics shortened — the full report was copied; paste it below)';
  const lines = wellFormed(diagnostics).split('\n');
  while (lines.length > 1) {
    lines.pop();
    const text = `${typed}\n\n${lines.join('\n')}${note}`;
    if (encodedLength(text) <= cap) return { text, shortened: true };
  }
  if (encodedLength(typed + note) <= cap) return { text: typed + note, shortened: true };
  // The typed part alone is too long: its longest code-point prefix that fits (binary search).
  const chars = Array.from(typed);
  const fits = (n: number) => encodedLength(chars.slice(0, n).join('') + '…' + note) <= cap;
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return { text: chars.slice(0, lo).join('') + '…' + note, shortened: true };
}

export const subjectFor = (d: FeedbackDraft): string => `Mr. Chartist Invoice beta — ${KIND_TEXT[d.kind]}${d.area ? `: ${scrubTyped(d.area)}` : ''}`;

/** `https://wa.me/?text=…` (no recipient unless `FEEDBACK_CONTACT.whatsapp` is set). */
export function whatsappLink(text: string, number = FEEDBACK_CONTACT.whatsapp): string {
  return `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

/** `mailto:?subject=…&body=…` (no recipient unless `FEEDBACK_CONTACT.email` is set). */
export function mailtoLink(subject: string, body: string, address = FEEDBACK_CONTACT.email): string {
  return `mailto:${encodeURIComponent(address).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Parse a stored draft; anything malformed gives null. */
export function parseDraft(raw: string | null): FeedbackDraft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<FeedbackDraft>;
    if (!v || typeof v !== 'object') return null;
    const base = emptyDraft(typeof v.area === 'string' ? v.area : '');
    return {
      ...base,
      kind: v.kind === 'idea' || v.kind === 'question' ? v.kind : 'problem',
      did: typeof v.did === 'string' ? v.did : '',
      expected: typeof v.expected === 'string' ? v.expected : '',
      actual: typeof v.actual === 'string' ? v.actual : '',
      severity: v.severity === 'blocks' || v.severity === 'cosmetic' ? v.severity : 'annoying',
    };
  } catch {
    return null;
  }
}
