import { Suspense, createElement, lazy, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { isSaveShortcut } from '../components/creator/line-keys';
import type { useToast } from '../components/ui/useToast';
import type { EntrySheet } from '../components/keys/EntrySheets';
import { useCreateOnTheFly } from '../components/masters/useCreateOnTheFly';
import { duplicateInEditor } from '../components/invoicing-ux/editor-actions';
import { useKeyActions } from '../lib/keys/use-key-actions';
import { cancelEntry, deleteEntry, lastText, undoCancel, undoDelete, withoutLine } from '../lib/keys/entry-actions';
import { keysOn, type KeyLike } from '../lib/keys/stub';
import { kbT } from '../i18n/areas/keys-r20b';
import { docLabel } from '../i18n/labels';
import { localDb } from '../lib/localDb';
import { stockDb } from '../lib/inventory';
import { RECORD_KEYS, useInvoiceStore } from '../store/useInvoiceStore';
import { clientToParty } from '../store/invoice-defaults';

/**
 * Keyboard handling of the invoice editor:
 * - Ctrl/⌘+S (and Ctrl/⌘+Enter) saves, Ctrl/⌘+P opens the preview;
 * - Esc leaves the editor when no field or dialog is active (drafts autosave, so nothing is lost).
 */
export function useCreatorKeys({ onSave, onPreview, onExit }: { onSave: () => void; onPreview: () => void; onExit: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      // R20-B: in Tally keys mode Ctrl+Enter on a party / item picker alters the master (the key engine decides).
      if (keysOn() && (e.target as Element | null)?.closest?.('[data-key-field="picker"]')) return;
      const key = e.key.toLowerCase();
      if (isSaveShortcut(e)) {
        e.preventDefault();
        onSave();
      } else if (key === 's') {
        e.preventDefault();
        onSave();
      } else if (key === 'p') {
        e.preventDefault();
        onPreview();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSave, onPreview]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable]') || t.closest('[role="dialog"]'))) return;
      if (document.querySelector('[role="dialog"]')) return;
      onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);
}

/** Warn before a refresh/tab close would drop unsaved edits (`active` = dirty saved document). */
export function useUnsavedChangesWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}

type Notify = ReturnType<typeof useToast>['notify'];
const EntrySheets = lazy(() => import('../components/keys/EntrySheets'));
const errMsg = (err: unknown) => (err as Error)?.message || String(err);
const lineOf = (t: unknown) => (t as Element | null)?.closest?.<HTMLElement>('[data-line]')?.dataset.line;

/**
 * R20-B: the invoice editor's Tally entry keys (rows of `src/lib/keys/registry.ts`, Tally keys on): Ctrl+A accept,
 * Alt+D delete / Alt+X cancel / Alt+2 duplicate with Undo, Ctrl+D remove line (Undo re-inserts), Alt+C / Ctrl+Enter on
 * the party / item picker, Ctrl+R last notes of this type, F2 date, and the side sheets (Alt+S stock, Alt+A tax break-up, Alt+Q edit log). Returns the
 * sheets / dialogs to render.
 */
export function useEditorEntryKeys({ id, save, notify, onChanged }: { id?: string; save: () => void; notify: Notify; onChanged: () => void }): ReactNode {
  const navigate = useNavigate();
  const [sheet, setSheet] = useState<EntrySheet | null>(null);
  const fly = useCreateOnTheFly();
  const st = () => useInvoiceStore.getState();
  const label = () => st().invoice_number || docLabel(st().doc_type);
  const run = (p: Promise<unknown>, ok: string, l: string, undo: () => Promise<unknown>) =>
    p.then(
      () => notify(ok, 'success', { action: { label: kbT('undo'), onClick: () => void undo().then(() => notify(kbT('undone', { label: l })), (e) => notify(errMsg(e), 'error')) } }),
      (e) => notify(errMsg(e), 'error'),
    );
  const stock = (e: KeyLike) => {
    const it = st().items.find((i) => i.id === lineOf(e.target));
    if (!it?.name.trim()) return false;
    setSheet({ kind: 'stock', name: it.name, hsn: it.hsn });
  };
  // Alt+C / Ctrl+Enter on the party: Tally's Ledger Creation / Alteration under Sundry Debtors (it saves the client).
  const party = (alter?: string) =>
    void fly.open({ kind: 'ledger', name: alter ? undefined : st().client?.name ?? '', under: 'TRADE_RECEIVABLES', alter }).then((made) => {
      const c = made && localDb.clients.getById(made.id.replace(/^party:debtor:/, ''));
      if (c) st().setClient(clientToParty(c));
    });
  const picker = (e: KeyLike) => (e.target as Element | null)?.closest?.<HTMLElement>('[data-key-field="picker"]')?.dataset.picker;
  useKeyActions('editor', {
    'accept.editor': () => save(),
    'delete.editor': () => {
      if (!id) return false;
      const l = label();
      setSheet({ kind: 'ask', text: kbT('delAsk', { label: l }), onYes: () => void run(deleteEntry('invoice', id).then(() => { st().newDraft(st().doc_type); navigate('/invoice', { replace: true }); }), kbT('deleted', { label: l }), l, () => undoDelete('invoice', id).then(() => navigate(`/invoice/${id}`))) });
    },
    'cancel.editor': () => {
      const d = id ? localDb.invoices.getById(id) : undefined;
      if (!d || d.status === 'Cancelled' || d.status === 'Draft') return false;
      const l = label();
      setSheet({ kind: 'cancel', label: l, paid: (d.amount_paid ?? 0) > 0, onDone: (reason, ack) => void run(cancelEntry(d.id, reason, ack).then(() => { st().loadInvoice(d.id); onChanged(); }), kbT('cancelled', { label: l }), l, () => undoCancel(d.id).then(() => { st().loadInvoice(d.id); onChanged(); })) });
    },
    'dup.editor': () => {
      const s = st();
      const before = Object.fromEntries(RECORD_KEYS.map((k) => [k, s[k as keyof typeof s]]));
      const l = label();
      if (!duplicateInEditor()) return false;
      if (id) navigate('/invoice');
      notify(kbT('dupDone', { label: l }), 'info', { action: { label: kbT('undo'), onClick: () => (id ? navigate(`/invoice/${id}`) : (useInvoiceStore.setState(before), st().recalculate())) } });
    },
    'gstAnalysis.editor': () => {
      const t = st().totals;
      setSheet({ kind: 'tax', slabs: t.slabs, cess: t.cess_amount, total: t.total });
    },
    'editLog.editor': () => (id ? setSheet({ kind: 'log', id, name: st().invoice_number }) : false),
    'date.editor': () => {
      document.querySelector<HTMLElement>('[data-meta-edit]')?.click();
      setTimeout(() => document.querySelector<HTMLElement>('[data-meta-open] input[type="date"]')?.focus());
    },
  });
  useKeyActions('line', {
    rmLine: (e) => {
      const lineId = lineOf(e.target);
      const cut = lineId ? withoutLine(st().items, lineId) : null;
      if (!cut) return false;
      st().removeItem(lineId!);
      notify(kbT('lineGone'), 'info', { action: { label: kbT('undo'), onClick: () => (st().patch({ items: cut.undo(st().items.filter((i) => i.name.trim() || i.rate > 0)) }), st().recalculate()) } });
    },
    stockQuery: stock,
    'stockQuery.alias': stock,
  });
  useKeyActions('field:picker', {
    'create.picker': (e) => {
      const lineId = lineOf(e.target);
      if (picker(e) === 'party') return void party();
      void fly.open({ kind: 'stockItem', name: st().items.find((i) => i.id === lineId)?.name ?? '' }).then((made) => {
        const item = made && stockDb.items().find((x) => x.id === made.id);
        if (item && lineId) st().patchItem(lineId, { name: item.name, ...(item.hsn ? { hsn: item.hsn } : {}), ...(item.unit ? { unit: item.unit } : {}) });
      });
    },
    alterMaster: (e) => {
      const id = st().client?.id;
      if (picker(e) === 'party' && id && localDb.clients.getById(id)) party(`party:debtor:${id}`);
      else save();
    },
  });
  useKeyActions('field:narration', {
    narrType: () => {
      const text = lastText(localDb.invoices.getAll(), (d) => d.doc_type === st().doc_type, (d) => d.notes, (d) => d.issue_date, id);
      if (text) st().setNotes(text);
      else notify(kbT('noNarr'), 'info');
    },
  });
  return createElement(
    Suspense,
    { fallback: null },
    sheet && createElement(EntrySheets, { sheet, onClose: () => setSheet(null) }),
    fly.node,
  );
}
