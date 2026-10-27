/** AG-D1 chambers (`agri_settings.chambers`) with utilisation; receipt terms; the release LTV for partial release under a lien. */
import { useMemo, useState } from 'react';
import { agdT } from '../../i18n/areas/agri-r12d';
import { generateId } from '../../lib/storage';
import { chamberUse, loadLots } from '../../lib/agri/ag-cold-lots';
import { readAgriSettings, saveAgriSettings } from '../../lib/agri/ag-settings';
import { B, Form, Tbl } from './agd-kit';
import { useRun, type Done } from './agd-ui';

export default function ChambersView({ onDone }: { onDone: Done }) {
  const { tick, run } = useRun(onDone);
  const s = useMemo(() => { void tick; return readAgriSettings(); }, [tick]);
  const chambers = s.chambers ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [c, setC] = useState<Record<string, any>>({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [t, setT] = useState<Record<string, any>>({ ...s.cold });
  const add = () => run(() => {
    if (!c.name?.trim() || !(c.capacity_bags > 0)) throw new Error(agdT('chamberNeed'));
    saveAgriSettings({ chambers: [...chambers, { ...c, id: generateId(), name: c.name.trim() } as never] });
    setC({});
    return agdT('saved');
  });
  return (
    <>
      <Form v={c} set={setC} f={[['name', 'chamber'], ['capacity_bags', 'capacity', 'n', 110], ['floors', 'floors', 'n', 80], ['temp_range', 'temp', 't', 120]]}>
        <B p k="add" on={add} data-agd-b="add-chamber" />
      </Form>
      <Tbl head={['chamber', 'capacity', 'stored', '']} rows={chamberUse(loadLots(), chambers).map((u) => [u.chamber.name, u.chamber.capacity_bags, `${u.bags} (${u.pct}%)`, !u.bags && <B key="d" k="delete" on={() => run(() => { saveAgriSettings({ chambers: chambers.filter((x) => x.id !== u.chamber.id) }); return agdT('deleted'); })} />])} />
      <Form v={t} set={setT} f={[['receipt_terms', 'terms']]}>
        <B k="save" on={() => run(() => { saveAgriSettings({ cold: t }); return agdT('saved'); })} />
      </Form>
    </>
  );
}
