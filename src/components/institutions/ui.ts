/** R5-C screen helpers: sub-view hook, CSV / page download, error text, money. Lazy chunks only. */
import { useSearchParams } from 'react-router-dom';
import { downloadText } from '../../lib/download';
import { printHtmlDocument } from '../../lib/voucher-print';
import { R5cError } from '../../lib/institutions/r5c';
import { iT, type IKey } from '../../i18n/areas/packs-institutions-r5';
import { localDb } from '../../lib/localDb';

export type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;

export const rs = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const num = (v: string) => (v.trim() === '' ? 0 : Number(v) || 0);

export const csv = (name: string, text: string) => downloadText(name, `\uFEFF${text}`, 'text/csv');
export const printPage = (html: string, name: string) => printHtmlDocument(html, (h) => downloadText(name, h, 'text/html'));

/** A lib error as on-screen text (R5-C codes are translated). */
export function errText(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  return e instanceof R5cError ? iT((Object.hasOwn(iT.en, `err.${m}`) ? `err.${m}` : 'err.input') as IKey) : m;
}

/** Run `fn`; toast `ok` on success or the error. Returns whether it worked. */
export function attempt(notify: Notify, fn: () => void, ok?: string): boolean {
  try {
    fn();
    if (ok) notify(ok);
    return true;
  } catch (e) {
    notify(errText(e), 'error');
    return false;
  }
}

/** `?view=` sub-view of a pack tab. */
export function useView<T extends string>(views: readonly T[]): [T, (v: T) => void] {
  const [params, setParams] = useSearchParams();
  const v = (views as readonly string[]).includes(params.get('view') ?? '') ? (params.get('view') as T) : views[0];
  return [v, (n: T) => {
    const next = new URLSearchParams(params);
    next.set('view', n);
    setParams(next, { replace: true });
  }];
}

/** `[key, label]` options from translated keys `${prefix}${key}`. */
export const opts = <K extends string>(keys: readonly K[], prefix: string): [K, string][] => keys.map((k) => [k, iT(`${prefix}${k}` as IKey)]);

/** Issuing context of a generated document: the active sender profile, template and round-off setting. */
export const feeCtx = (date: string) => ({ date, sender: localDb.settings.activeProfile() ?? null, templateId: localDb.template.get(), roundOff: localDb.settings.get().roundOff });

/** Start year of the current Indian FY. */
export const fyNow = () => {
  const t = today();
  return +t.slice(5, 7) >= 4 ? +t.slice(0, 4) : +t.slice(0, 4) - 1;
};
