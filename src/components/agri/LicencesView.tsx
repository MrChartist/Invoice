/** AG-D4 licences with expiry notices; principal certificates (O-form) per manufacturer; bills missing one. */
import { useMemo, useState } from 'react';
import { agdT } from '../../i18n/areas/agri-r12d';
import { todayInput } from '../../lib/utils';
import { LICENCE_KINDS, agriLicenceNotices } from '../../lib/agri/ag-licences';
import { readAgriSettings, saveAgriSettings } from '../../lib/agri/ag-settings';
import { B, Form, Hint, Tbl } from './agd-kit';
import { useRun, type Done } from './agd-ui';

export default function LicencesView({ onDone }: { onDone: Done }) {
  const { tick, run } = useRun(onDone);
  const s = useMemo(() => { void tick; return readAgriSettings(); }, [tick]);
  const lics = s.licences ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [l, setL] = useState<Record<string, any>>({ kind: 'fertiliser_retail' });
  const notice = new Map(agriLicenceNotices(lics, todayInput()).map((n) => [n.licence, n]));
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
      <Hint k="licenceNote" />
    </>
  );
}
