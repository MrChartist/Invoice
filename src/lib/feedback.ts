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

/** WhatsApp / mailto bodies are kept under this many characters (long URLs fail on some phones). */
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

/**
 * Text for a WhatsApp / e-mail link: the full text when it fits `cap`, else the typed part with the diagnostics
 * shortened first (line by line from the end) and a note that the full report was copied.
 */
export function capForShare(d: FeedbackDraft, diagnostics: string, cap = SHARE_CAP): { text: string; shortened: boolean } {
  const full = composeFeedback(d, diagnostics);
  if (full.length <= cap) return { text: full, shortened: false };
  const note = '\n… (diagnostics shortened — the full report was copied; paste it below)';
  const typed = composeTyped(d);
  const room = cap - typed.length - note.length - 2;
  if (room <= 0) return { text: (typed.slice(0, cap - note.length - 1) + '…' + note).slice(0, cap), shortened: true };
  const kept: string[] = [];
  let used = 0;
  for (const line of diagnostics.split('\n')) {
    if (used + line.length + 1 > room) break;
    kept.push(line);
    used += line.length + 1;
  }
  return { text: `${typed}\n\n${kept.join('\n')}${note}`, shortened: true };
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
