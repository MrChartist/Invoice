/**
 * R14 PS-C4 platforms view: the payment platforms (`prof_settings.platforms[]`: kind, payout bank, fee head, vendor,
 * non-resident), the default purpose code (PS39) and the open foreign-currency invoices with "Receive via platform".
 */
import { lazy, Suspense, useMemo, useState } from 'react';
import { localDb } from '../../lib/localDb';
import { formatCurrency } from '../../lib/utils';
import { pickableBankAccounts } from '../../lib/bank-accounts';
import { loadPlatforms, PLATFORM_KINDS, readPurposeCode, savePlatforms, savePurposeCode, type Platform } from '../../lib/prof/ps-platforms';
import { PURPOSE_BY_KIND, purposeCodes } from '../../lib/prof/ps-platforms';
import { pcT } from '../../i18n/areas/prof-r14c-export';
import { Tbl } from './pc-ui';
import { Field } from './ps-ui';
import { runner, type Notify } from './pc-run';
import controls from '../../styles/controls.module.css';
import css from './exportsvc.module.css';

const PlatformReceiptDialog = lazy(() => import('./PlatformReceiptDialog'));
const sm = `${controls.btnOutline} ${controls.btnSm}`;

export default function PlatformsView({ notify }: { notify: Notify }) {
  const [tick, setTick] = useState(0);
  const run = runner(notify, () => setTick((n) => n + 1));
  const [list, setList] = useState<Platform[]>(() => loadPlatforms());
  const [code, setCode] = useState(() => readPurposeCode() ?? PURPOSE_BY_KIND[localDb.settings.get().prof_kind ?? 'other'] ?? '');
  const banks = useMemo(() => pickableBankAccounts('any'), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const open = useMemo(() => localDb.invoices.getAll().filter((i) => String(i.currency || 'INR').toUpperCase() !== 'INR' && i.status !== 'Draft' && i.status !== 'Cancelled' && i.status !== 'Paid' && Number(i.balance_due) > 0.005), [tick]);
  const set = (i: number, p: Partial<Platform>) => setList(list.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <>
      <Tbl tag="plat" head={[pcT('name'), pcT('pkind'), pcT('bank'), pcT('feeLedger'), pcT('nonResident'), '']} rows={list.map((p, i) => [
        <input key="n" className={controls.input} aria-label={pcT('name')} value={p.name} onChange={(e) => set(i, { name: e.target.value })} data-ps-plat-name />,
        <select key="k" className={controls.select} aria-label={pcT('pkind')} value={p.kind} onChange={(e) => set(i, { kind: e.target.value as Platform['kind'] })}>{PLATFORM_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>,
        <select key="b" className={controls.select} aria-label={pcT('bank')} value={p.bank_account_id ?? ''} onChange={(e) => set(i, { bank_account_id: e.target.value || undefined })}><option value="">-</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>,
        <input key="f" className={controls.input} aria-label={pcT('feeLedger')} value={p.fee_ledger ?? ''} onChange={(e) => set(i, { fee_ledger: e.target.value })} />,
        <input key="r" type="checkbox" aria-label={pcT('nonResident')} checked={!!p.non_resident} onChange={(e) => set(i, { non_resident: e.target.checked })} data-ps-plat-nr />,
        <button key="x" type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setList(list.filter((_, j) => j !== i))}>{pcT('remove')}</button>,
      ])} />
      <div className={css.bar}>
        <button type="button" className={sm} onClick={() => setList([...list, { name: '', kind: 'payoneer', non_resident: true }])} data-ps-plat-add>{pcT('addPlatform')}</button>
        <button type="button" className={controls.btnPrimary} onClick={() => run(() => void setList(savePlatforms(list)))} data-ps-plat-list-save>{pcT('save')}</button>
        <Field label={pcT('defPurpose')}><select className={controls.select} value={code} onChange={(e) => setCode(e.target.value)}>{purposeCodes().map(([c, l]) => <option key={c} value={c}>{`${c}: ${l}`}</option>)}</select></Field>
        <button type="button" className={sm} onClick={() => run(() => savePurposeCode(code))}>{pcT('save')}</button>
      </div>
      <Tbl tag="plat-open" head={[pcT('invoice'), pcT('date'), pcT('party'), pcT('value'), '']} rows={open.map((i) => [i.invoice_number, i.issue_date, i.client?.name ?? '', formatCurrency(i.balance_due ?? 0, i.currency), <Suspense key="r" fallback={null}><PlatformReceiptDialog invoice={i} notify={notify} onDone={() => setTick((n) => n + 1)} /></Suspense>])} />
    </>
  );
}
