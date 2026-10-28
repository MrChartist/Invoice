/** AG-D4 licences with expiry notices; principal certificates (O-form) per manufacturer; bills missing one. */
import { useMemo, useState } from 'react';
import { agdT, type AgdKey } from '../../i18n/areas/agri-r12d';
import { getTable } from '../../lib/storage';
import { todayInput } from '../../lib/utils';
import { LICENCE_KINDS, agriLicenceNotices, classIndex, principalWarnings } from '../../lib/agri/ag-licences';
import { readAgriSettings, saveAgriSettings } from '../../lib/agri/ag-settings';
import { B, Form, Hint, Tbl } from './agd-kit';
import { useRun, type Done } from './agd-ui';

export default function LicencesView({ onDone }: { onDone: Done }) {
  const { tick, run } = useRun(onDone);
  const s = useMemo(() => { void tick; return readAgriSettings(); }, [tick]);
  const lics = s.licences ?? [];
  const pcs = s.principals ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [l, setL] = useState<Record<string, any>>({ kind: 'fertiliser_retail' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [p, setP] = useState<Record<string, any>>({ kind: 'fertiliser' });
  const vendors = getTable<{ id: string; name: string }>('vendors').map((v) => [v.id, v.name] as const);
  const notice = new Map(agriLicenceNotices(lics, todayInput()).map((n) => [n.licence, n]));
  const idx = classIndex();
  const missing = principalWarnings(getTable('purchases'), pcs, (n) => idx.get(n));
  const pk = (k: string) => agdT(`pk.${k}` as AgdKey);
  const add = <T,>(list: T[], row: T, key: 'licences' | 'principals', ok: boolean) => run(() => {
    if (!ok) throw new Error(agdT('numberNeed'));
    saveAgriSettings({ [key]: [...list, row] });
    return agdT('saved');
  });
  return (
    <>
      <Form v={l} set={setL} f={[['kind', 'kind', LICENCE_KINDS.map((k) => [k, agdT(`lk.${k}`)] as const)], ['number', 'number'], ['issued_by', 'issuedBy'], ['valid_from', 'validFrom', 'd'], ['valid_to', 'validTo', 'd']]}>
        <B p k="add" on={() => add(lics, { ...l, issued_by: l.issued_by ?? '' } as never, 'licences', !!l.number?.trim())} data-agd-b="add-licence" />
      </Form>
      <Tbl
        head={['kind', 'number', 'issuedBy', 'validTo', '', '']}
        flag={lics.map((x) => !!notice.get(x)?.expired)}
        rows={lics.map((x, i) => { const n = notice.get(x); return [agdT(`lk.${x.kind}`), x.number, x.issued_by, x.valid_to ?? '', n ? agdT(n.expired ? 'expired' : n.soon ? 'dueSoon' : 'due60') : '', <B key="d" k="delete" on={() => run(() => { saveAgriSettings({ licences: lics.filter((_, j) => j !== i) }); return agdT('deleted'); })} />]; })}
      />
      <h3>{agdT('principals')}</h3>
      <Form v={p} set={setP} f={[['vendor_id', 'manufacturer', vendors], ['kind', 'kind', ['fertiliser', 'insecticide', 'seed'].map((k) => [k, pk(k)] as const)], ['ref', 'ref'], ['valid_to', 'validTo', 'd']]}>
        <B k="add" on={() => add(pcs, { ...p, vendor_name: vendors.find((v) => v[0] === p.vendor_id)?.[1] } as never, 'principals', !!p.vendor_id && !!p.ref?.trim())} />
      </Form>
      <Tbl head={['manufacturer', 'kind', 'ref', 'validTo', '']} rows={pcs.map((x, i) => [x.vendor_name ?? '', pk(x.kind), x.ref, x.valid_to ?? '', <B key="d" k="delete" on={() => run(() => { saveAgriSettings({ principals: pcs.filter((_, j) => j !== i) }); return agdT('deleted'); })} />])} />
      {!!missing.length && <><h3>{agdT('noPrincipal')}</h3><Tbl head={['bill', 'date', 'manufacturer', 'kind']} rows={missing.map((m) => [m.bill, m.date, m.vendor, pk(m.kind)])} /></>}
      <Hint k="licenceNote" />
    </>
  );
}
