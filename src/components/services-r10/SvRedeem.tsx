/**
 * SV-C1 "Use package" (lazy): in the editor, a chip under a line whose customer holds an open package covering it;
 * at the POS, one button per open package of the customer. A click turns the line into a ₹0 redemption ("Session 3
 * of 6 — MEM/…", `sv.redeem`; the value for commission is price ÷ sessions). Sessions already on this document count.
 */
import { useMemo } from 'react';
import type { Client, InvoiceItem } from '../../types/invoice';
import type { Membership } from '../../types/services-r10';
import { getTable } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { covers, loadCheckins, loadMemberships, redeemPatch, sessionsUsed, statusOf } from '../../lib/services/sv-members';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { blankItem } from '../../store/invoice-defaults';
import { todayInput } from '../../lib/utils';
import { useT } from '../../i18n';
import { mcT } from '../../i18n/areas/services-r10c';
import controls from '../../styles/controls.module.css';

/** Open session packages of a customer (by id, else name) with the sessions used so far (bills + `onDoc` lines). */
function packagesOf(client: Pick<Client, 'id' | 'name'> | null | undefined, onDoc: readonly InvoiceItem[], docId: string | undefined, day: string) {
  if (!client?.name) return [];
  const invoices = getTable<{ id: string }>('invoices').filter((i) => i.id !== docId) as never[];
  const checkins = loadCheckins();
  return loadMemberships()
    .filter((m) => Number(m.plan.sessions) > 0 && (m.client_id ? m.client_id === client.id : m.client_name.toLowerCase() === client.name.trim().toLowerCase()))
    .map((m) => ({ m, used: sessionsUsed(m, invoices, checkins) + onDoc.filter((l) => l.sv?.redeem?.membership_id === m.id).length }))
    .filter(({ m, used }) => statusOf(m, day, used) === 'active');
}

const label = (m: Membership, used: number) => mcT('use', { number: m.number, left: Number(m.plan.sessions) - used });

export function RedeemChip({ item, date }: { item: InvoiceItem; date: string }) {
  useT();
  const client = useInvoiceStore((s) => s.client);
  const items = useInvoiceStore((s) => s.items);
  const docId = useInvoiceStore((s) => s.id);
  const list = useMemo(() => packagesOf(client, items, docId, date), [client, items, docId, date]);
  if (item.sv?.redeem) return <span className={controls.hint}>{mcT('redeemed', { n: item.sv.redeem.session, of: item.sv.redeem.of })}</span>;
  return (
    <>
      {list.filter(({ m }) => covers(m.plan, item.name)).map(({ m, used }) => (
        <button key={m.id} type="button" className={`${controls.btnGhost} ${controls.btnSm}`} data-redeem={m.number}
          onClick={() => useInvoiceStore.getState().patchItem(item.id, redeemPatch(m, item, date, used))}>{label(m, used)}</button>
      ))}
    </>
  );
}

/** POS: one button per open package; converts the last covered line (or adds one) into the redemption. */
export function PosPackages({ client, items, setItems, notify }: { client: Client; items: InvoiceItem[]; setItems: (f: (prev: InvoiceItem[]) => InvoiceItem[]) => void; notify: (m: string, tone?: 'error') => void }) {
  useT();
  const day = todayInput();
  const list = packagesOf(client, items, undefined, day);
  const use = (m: Membership, used: number) => {
    try {
      const at = items.map((l, i) => [l, i] as const).filter(([l]) => !l.sv?.redeem && covers(m.plan, l.name)).pop();
      const line = at?.[0] ?? { ...blankItem(Number(localDb.settings.get().defaultTaxRate) || 0), name: m.plan.covers?.[0] ?? m.plan.name };
      const next = { ...line, ...redeemPatch(m, line, day, used) };
      setItems((prev) => (at ? prev.map((l, i) => (i === at[1] ? next : l)) : [...prev, next]));
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };
  return <>{list.map(({ m, used }) => <button key={m.id} type="button" className={`${controls.btnOutline} ${controls.btnSm}`} data-pos-redeem={m.number} onClick={() => use(m, used)}>{label(m, used)}</button>)}</>;
}
