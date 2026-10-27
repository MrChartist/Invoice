/** AG-D4 credit till harvest: seasons and their due dates, put a bill on season credit, open season bills with days past due. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { agdT } from '../../i18n/areas/agri-r12d';
import { todayInput } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import { requireAccess } from '../../lib/access';
import { DEFAULT_SEASONS, seasonCredit, withSeason } from '../../lib/agri/ag-season-credit';
import { readAgriSettings, saveAgriSettings } from '../../lib/agri/ag-settings';
import { B, Form, Tbl } from './agd-kit';
import { fmt, useRun, type Done } from './agd-ui';

export default function SeasonCreditView({ onDone }: { onDone: Done }) {
  const { tick, run } = useRun(onDone);
  const s = useMemo(() => { void tick; return readAgriSettings(); }, [tick]);
  const seasons = s.seasons?.length ? s.seasons : [...DEFAULT_SEASONS];
  const inv = useMemo(() => { void tick; return localDb.invoices.getAll(); }, [tick]);
  const [n, setN] = useState<Record<string, string>>({});
  const [b, setB] = useState<Record<string, string>>({});
  const open = inv.filter((i) => i.doc_type !== 'CREDIT_NOTE' && i.status !== 'Cancelled' && (i.balance_due ?? 0) > 0 && !i.ag?.inputs?.season_due);
  const rows = seasonCredit(inv, todayInput());
  return (
    <>
      <Tbl head={['season', 'dueOn', '']} rows={seasons.map((x, i) => [x.name, x.due, <B key="d" k="delete" on={() => run(() => { saveAgriSettings({ seasons: seasons.filter((_, j) => j !== i) }); return agdT('deleted'); })} />])} />
      <Form v={n} set={setN} f={[['name', 'season', 't', 140], ['due', 'dueOn', 't', 140]]}>
        <B k="add" on={() => run(() => {
          if (!n.name?.trim() || !/^(\d{4}-)?\d{2}-\d{2}$/.test(n.due ?? '')) throw new Error(agdT('seasonNeed'));
          saveAgriSettings({ seasons: [...seasons.filter((x) => x.name !== n.name.trim()), { name: n.name.trim(), due: n.due }] });
          return agdT('saved');
        })} />
      </Form>
      <h3>{agdT('onSeason')}</h3>
      <Form v={b} set={setB} f={[['bill', 'bill', open.map((i) => [i.id, `${i.invoice_number} · ${i.client?.name ?? ''} · ${fmt(i.balance_due ?? 0)}`] as const)], ['season', 'season', seasons.map((x) => [x.name, x.name] as const)]]}>
        <B k="setSeason" off={!b.bill || !b.season} on={() => run(() => {
          requireAccess('doc.edit');
          const next = withSeason(localDb.invoices.getById(b.bill)!, seasons, b.season);
          localDb.invoices.save(next);
          return agdT('dueAt', { date: next.due_date });
        })} />
      </Form>
      <Tbl head={['bill', 'party', 'season', 'dueOn', 'due', 'daysPast']} flag={rows.map((r) => r.overdueDays > 0)} rows={rows.map((r) => [r.invoice.invoice_number, r.invoice.client?.name ?? '', r.season, r.due, fmt(r.balance), r.overdueDays || ''])} />
      <p><Link to="/receivables?tab=interest">{agdT('interestLink')}</Link></p>
    </>
  );
}
