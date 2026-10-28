/** AG-D desks: small shared helpers (run a data-layer call and report; print a small paper; pickers' data). */
import { useState } from 'react';
import { downloadText } from '../../lib/download';
import { printHtmlDocument } from '../../lib/voucher-print';
import { localDb } from '../../lib/localDb';
import controls from '../../styles/controls.module.css';

export type Done = (msg: string, error?: boolean) => void;
export const btn = `${controls.btnOutline} ${controls.btnSm}`;
export const wrap = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '0.75rem' } as const;
export const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** Run a data-layer call, then report its message (or the error); `tick` re-reads the tables. */
export function useRun(onDone: Done) {
  const [tick, setTick] = useState(0);
  const run = (fn: () => string | void) => {
    try {
      const m = fn();
      setTick((t) => t + 1);
      if (m) onDone(m);
    } catch (err) {
      onDone((err as Error).message, true);
    }
  };
  return { tick, run };
}

export const printPaper = (html: string, name: string) => printHtmlDocument(html, (h) => downloadText(`${name.replace(/[^\w-]+/g, '_')}.html`, h, 'text/html'));
export const company = () => localDb.settings.activeProfile()?.companyName ?? '';
export const clientOpts = (): [string, string][] => localDb.clients.getAll().filter((c) => c.id).map((c) => [c.id!, c.name]);
