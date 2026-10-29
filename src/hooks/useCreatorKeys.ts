import { Suspense, createElement, lazy, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { isSaveShortcut } from '../components/creator/line-keys';
import type { useToast } from '../components/ui/useToast';
import type { EntrySheet } from '../components/keys/EntrySheets';
import { useCreateOnTheFly } from '../components/masters/useCreateOnTheFly';
import { duplicateInEditor } from '../components/invoicing-ux/editor-actions';
import { useKeyActions } from '../lib/keys/use-key-actions';
import { cancelEntry, deleteEntry, lastText, stepId, undoCancel, undoDelete, withoutLine } from '../lib/keys/entry-actions';
import { keysOn, type KeyLike } from '../lib/keys/stub';
import { kbT } from '../i18n/areas/keys-r20b';
import { docLabel } from '../i18n/labels';
import { localDb } from '../lib/localDb';
import { stockDb } from '../lib/inventory';
import { RECORD_KEYS, useInvoiceStore } from '../store/useInvoiceStore';
import { clientToParty } from '../store/invoice-defaults';
import type { Client } from '../types/invoice';

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
const ClientFormModal = lazy(() => import('../components/modals/ClientFormModal').then((m) => ({ default: m.ClientFormModal })));
const errMsg = (err: unknown) => (err as Error)?.message || String(err);
const lineOf = (t: unknown) => (t as Element | null)?.closest?.<HTMLElement>('[data-line]')?.dataset.line;

/**
 * R20-B: the invoice editor's Tally entry keys (rows of `src/lib/keys/registry.ts`, Tally keys on): Ctrl+A accept,
 * Alt+D delete / Alt+X cancel / Alt+2 duplicate with Undo, Ctrl+D remove line (Undo re-inserts), Alt+C / Ctrl+Enter on
 * the party / item picker, Ctrl+R last notes of this type, F2 date, PgUp / PgDn previous / next document, and the side
 * sheets (Alt+S stock, Ctrl+O party facts, Alt+A tax break-up, Alt+Q edit log, Ctrl+I more details). Returns the
 * sheets / dialogs to render.
 */
export function useEditorEntryKeys({ id, save, notify, onChanged }: { id?: string; save: () => void; notify: Notify; onChanged: () => void }): ReactNode {
  const navigate = useNavigate();
  const [sheet, setSheet] = useState<EntrySheet | null>(null);
  const [party, setParty] = useState<Client | null>(null);
  const fly = useCreateOnTheFly();
  const st = () => useInvoiceStore.getState();
  const label = () => st().invoice_number || docLabel(st().doc_type);
  const run = (p: Promise<unknown>, ok: string, l: string, undo: () => Promise<unknown>) =>
    p.then(
      () => notify(ok, 'success', { action: { label: kbT('undo'), onClick: () => void undo().then(() => notify(kbT('undone', { label: l })), (e) => notify(errMsg(e), 'error')) } }),
      (e) => notify(errMsg(e), 'error'),
    );
  const open = (to: string | undefined) => {
    if (!to) return;
    const go = () => navigate(`/invoice/${to}`);
    if (st().dirty) setSheet({ kind: 'ask', text: kbT('unsaved'), onYes: go });
    else go();
  };
  const step = (dir: -1 | 1) => () => {
    if (!id) return false;
    const rows = localDb.invoices.getAll().filter((d) => d.doc_type === st().doc_type && d.invoice_number).map((d) => ({ id: d.id, date: d.issue_date, number: d.invoice_number }));
    open(stepId(rows, id, dir));
  };
  const stock = (e: KeyLike) => {
    const it = st().items.find((i) => i.id === lineOf(e.target));
    if (!it?.name.trim()) return false;
    setSheet({ kind: 'stock', name: it.name, hsn: it.hsn });
  };
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
    'more.editor': () => {
      document.querySelector<HTMLElement>('[data-party-more][aria-expanded="false"]')?.click();
      document.querySelector<HTMLElement>('[data-party-more]')?.focus();
    },
    'related.editor': () => {
      const c = st().client;
      if (!c?.name?.trim()) return void notify(kbT('noParty'), 'info');
      setSheet({ kind: 'party', name: c.name, id: c.id });
    },
    'gstAnalysis.editor': () => {
      const t = st().totals;
      setSheet({ kind: 'tax', slabs: t.slabs, cess: t.cess_amount, total: t.total });
    },
    'editLog.editor': () => (id ? setSheet({ kind: 'log', id, name: st().invoice_number }) : false),
    'prevV.editor': step(-1),
    'nextV.editor': step(1),
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
    'more.line': (e) => {
      const row = (e.target as Element | null)?.closest?.('[data-line]');
      if (!row) return false;
      row.querySelector<HTMLElement>('[data-field="description"]')?.focus();
    },
  });
  useKeyActions('field:picker', {
    'create.picker': (e) => {
      const lineId = lineOf(e.target);
      if (picker(e) === 'party') return void setParty({ name: st().client?.name ?? '' } as Client);
      void fly.open({ kind: 'stockItem', name: st().items.find((i) => i.id === lineId)?.name ?? '' }).then((made) => {
        const item = made && stockDb.items().find((x) => x.id === made.id);
        if (item && lineId) st().patchItem(lineId, { name: item.name, ...(item.hsn ? { hsn: item.hsn } : {}), ...(item.unit ? { unit: item.unit } : {}) });
      });
    },
    alterMaster: (e) => {
      const c = picker(e) === 'party' && st().client?.id ? localDb.clients.getById(st().client.id!) : undefined;
      if (c) setParty(c);
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
    party && createElement(ClientFormModal, { open: true, client: party, onClose: () => setParty(null), onSaved: (c: Client) => (setParty(null), st().setClient(clientToParty(c))) }),
    fly.node,
  );
}
