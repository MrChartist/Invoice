/** PS-D5 fee schedule: a catalogue item per fee event, each client's agreed fees, and the company → client links. */
import { useMemo, useState } from 'react';
import { caT } from '../../i18n/areas/prof-r14d-ca';
import { localDb } from '../../lib/localDb';
import { activeCompanyId, readRegistry } from '../../lib/company-registry';
import { CA_FEE_EVENTS, clientFees, feeItems, patchClientPs, setFeeEvent } from '../../lib/prof/ps-ca-bill';
import { linkCompany, readCaSettings } from '../../lib/prof/ps-d-settings';
import type { CaFeeEvent } from '../../types/prof-r14d';
import { NumberInput } from '../ui/NumberInput';
import { Fld, Tbl } from '../mfg/mfd-ui';
import { row } from '../mfg/mfd-util';
import type { PsDeskCtx } from './ps-desk';
import controls from '../../styles/controls.module.css';

export default function CaFeesView({ ctx }: { ctx: PsDeskCtx }) {
  const d = useMemo(() => { void ctx.tick; return { items: localDb.items.getAll(), clients: localDb.clients.getAll(), links: readCaSettings().company_clients ?? [] }; }, [ctx.tick]);
  const [client, setClient] = useState('');
  const flagged = feeItems(d.items);
  const c = d.clients.find((x) => x.id === client);
  const fees = clientFees(c);
  const here = activeCompanyId();
  const companies = readRegistry().list.filter((co) => !co.demo || co.id === here); // QA7 G7: the Demo company only while open
  return (
    <>
      <Tbl empty={caT('none')} head={[caT('event'), caT('item'), caT('rate')]} rows={CA_FEE_EVENTS.map((k) => [caT(`e.${k}`), (
        <select key="i" className={controls.select} value={flagged.get(k)?.id ?? ''} onChange={(e) => ctx.run(() => setFeeEvent(e.target.value || flagged.get(k)!.id, e.target.value ? k : ''))} data-ps={`fee-item-${k}`}>
          <option value="">—</option>{d.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      ), flagged.get(k)?.rate ?? '—'])} />
      <div style={row}>
        <Fld l={caT('client')}>
          <select className={controls.select} value={client} onChange={(e) => setClient(e.target.value)} data-ps="fee-client">
            <option value="">—</option>{d.clients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Fld>
      </div>
      {c && <Tbl empty="" head={[caT('event'), caT('fee')]} rows={CA_FEE_EVENTS.map((k: CaFeeEvent) => [caT(`e.${k}`),
        <NumberInput key="f" className={controls.input} style={{ maxWidth: 120 }} value={fees[k] ?? 0} onChange={(v) => ctx.run(() => patchClientPs(c.id!, { fees: { ...fees, [k]: v || undefined } }), '')} data-ps={`fee-${k}`} />])} />}
      <p className={controls.label}>{caT('links')}</p>
      <Tbl empty={caT('none')} head={[caT('company'), caT('client')]} rows={companies.map((co) => [co.name, (
        <select key="l" className={controls.select} value={d.links.find((l) => l.company_id === co.id)?.client_id ?? ''} onChange={(e) => ctx.run(() => linkCompany(co.id, e.target.value, d.clients.find((x) => x.id === e.target.value)?.gstin))} data-ps="link-client">
          <option value="">{caT('unlinked')}</option>{d.clients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      )])} />
    </>
  );
}
