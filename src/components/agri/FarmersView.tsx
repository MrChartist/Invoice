/**
 * AG-A2 Farm → Farmers: farmers / members by centre and village with balances, search by code / phone / name, add and
 * edit (Aadhaar: last 4 digits only), duplicate warnings, centres, CSV import / export and farmer cards (8 per A4).
 */
import { lazy, Suspense, useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { agT } from '../../i18n/areas/agri-r12a';
import { getTable, peekTable } from '../../lib/storage';
import { downloadText } from '../../lib/download';
import { parseTable } from '../../lib/csv';
import { aadhaarProblem, duplicateWarnings, farmerBalances, farmersCsv, importFarmers, loadFarmers, nextFarmerCode, saveFarmer, searchFarmers, type Farmer } from '../../lib/agri/ag-farmers';
import { readAgriSettings, saveAgriSettings } from '../../lib/agri/ag-settings';
import type { AgCentre, FarmerCycle } from '../../types/agri-r12';
import controls from '../../styles/controls.module.css';
import { F, Grid, In } from './agri-ui';
import { money, useRun, wrap, type Done } from './agri-util';
import { SelectField } from '../ui/SelectField';

const FarmerCard = lazy(() => import('./FarmerCard'));
type Form = { id?: string; name: string; code: string; village: string; centre_id: string; member_no: string; member: boolean; phone: string; account: string; ifsc: string; upi: string; aadhaar_last4: string; language: string };
const blank = (): Form => ({ name: '', code: '', village: '', centre_id: '', member_no: '', member: false, phone: '', account: '', ifsc: '', upi: '', aadhaar_last4: '', language: 'en' });
const formOf = (f: Farmer): Form => ({ id: f.id, name: f.name, code: f.ag.code, village: f.ag.village ?? '', centre_id: f.ag.centre_id ?? '', member_no: f.ag.member_no ?? '', member: !!f.ag.member, phone: f.ag.phone ?? '', account: f.ag.bank?.account ?? '', ifsc: f.ag.bank?.ifsc ?? '', upi: f.ag.upi ?? '', aadhaar_last4: f.ag.aadhaar_last4 ?? '', language: f.ag.language ?? 'en' });

export default function FarmersView({ onDone }: { onDone: Done }) {
  useT();
  const { tick, run } = useRun(onDone);
  const [q, setQ] = useState('');
  const [f, setF] = useState<Form | null>(null);
  const [centre, setCentre] = useState('');
  const [cards, setCards] = useState(false);
  /* eslint-disable react-hooks/exhaustive-deps */
  const all = useMemo(() => loadFarmers(), [tick]);
  const centres = useMemo(() => readAgriSettings().centres ?? [], [tick]);
  const bal = useMemo(() => farmerBalances(all, getTable('purchases'), peekTable<FarmerCycle>('farmer_cycles'), getTable('clients'), getTable('invoices'), getTable('transactions')), [tick, all]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const list = searchFarmers(all, q);
  const set = (p: Partial<Form>) => setF((x) => (x ? { ...x, ...p } : x));
  const ag = f && { code: f.code, village: f.village, centre_id: f.centre_id, member_no: f.member_no, member: f.member, phone: f.phone, upi: f.upi, aadhaar_last4: f.aadhaar_last4, language: f.language as 'en', bank: { account: f.account, ifsc: f.ifsc } };
  const warn = f && ag ? [aadhaarProblem(f.aadhaar_last4), ...duplicateWarnings({ id: f.id, ag }, all)].filter(Boolean) : [];
  const cName = (id?: string) => centres.find((c) => c.id === id)?.name ?? '';
  const importCsv = async (file: File) => {
    const t = parseTable(await file.text());
    run(() => agT('imported', { n: importFarmers(t.rows.map((r) => Object.fromEntries(t.headers.map((h, i) => [h, r[i] ?? ''])))) }));
  };
  return (
    <div data-ag-farmers>
      <div style={wrap}>
        <F label={agT('search')}><In v={q} set={setQ} /></F>
        <button type="button" className={controls.btnPrimary} onClick={() => setF({ ...blank(), code: nextFarmerCode(all.map((x) => x.ag.code)) })} data-ag-add-farmer>{agT('addFarmer')}</button>
        <button type="button" className={controls.btnOutline} onClick={() => downloadText('farmers.csv', farmersCsv(list, bal), 'text/csv')}>{agT('export')}</button>
        <label className={controls.btnOutline}>{agT('importCsv')}<input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && void importCsv(e.target.files[0])} /></label>
        <button type="button" className={controls.btnOutline} onClick={() => setCards(true)} disabled={!list.length}>{agT('cards')}</button>
      </div>
      {f && (
        <fieldset className={controls.field} data-ag-farmer-form>
          <div style={wrap}>
            <F label={agT('name')}><In v={f.name} set={(v) => set({ name: v })} data-ag-farmer-name /></F>
            <F label={agT('code')}><In v={f.code} set={(v) => set({ code: v })} w={90} /></F>
            <F label={agT('village')}><In v={f.village} set={(v) => set({ village: v })} /></F>
            <F label={agT('centre')}><SelectField className={controls.select} value={f.centre_id} onChange={(e) => set({ centre_id: e.target.value })}><option value="">-</option>{centres.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField></F>
            <F label={agT('memberNo')}><In v={f.member_no} set={(v) => set({ member_no: v })} w={90} /></F>
            <label className={controls.check}><input type="checkbox" checked={f.member} onChange={(e) => set({ member: e.target.checked })} /> {agT('member')}</label>
            <F label={agT('phone')}><In v={f.phone} set={(v) => set({ phone: v })} type="tel" /></F>
            <F label={agT('account')}><In v={f.account} set={(v) => set({ account: v })} /></F>
            <F label="IFSC"><In v={f.ifsc} set={(v) => set({ ifsc: v.toUpperCase() })} w={120} /></F>
            <F label="UPI"><In v={f.upi} set={(v) => set({ upi: v })} /></F>
            <F label={agT('aadhaar4')}><In v={f.aadhaar_last4} set={(v) => set({ aadhaar_last4: v })} inputMode="numeric" w={80} data-ag-aadhaar /></F>
            <F label={agT('language')}><SelectField className={controls.select} value={f.language} onChange={(e) => set({ language: e.target.value })}><option value="en">English</option><option value="hi">हिन्दी</option></SelectField></F>
          </div>
          {warn.map((w) => <p key={w} className={controls.hint} role="alert" data-ag-warn>{w}</p>)}
          <div style={wrap}>
            <button type="button" className={controls.btnPrimary} onClick={() => run(() => { saveFarmer({ id: f.id, name: f.name, ag: ag! }); setF(null); return agT('saved'); })} data-ag-save-farmer>{agT('save')}</button>
            <button type="button" className={controls.btnGhost} onClick={() => setF(null)}>{agT('cancel')}</button>
          </div>
        </fieldset>
      )}
      <Grid attr="farmers" head={[agT('code'), agT('name'), agT('village'), agT('centre'), agT('phone'), agT('payable'), agT('receivable'), '']} rows={list.map((x) => [x.ag.code, x.name, x.ag.village ?? '', cName(x.ag.centre_id), x.ag.phone ?? '', money(bal.get(x.id)?.payable), <span key="r" data-ag-carry={bal.get(x.id)?.carry ?? 0}>{money(bal.get(x.id)?.receivable)}{bal.get(x.id)?.carry ? <small className={controls.hint}> · {agT('inclCarry', { amt: money(bal.get(x.id)?.carry) })}</small> : null}</span>, <button key="e" type="button" className={controls.btnGhost} onClick={() => setF(formOf(x))}>{agT('edit')}</button>])} />
      <div style={wrap}>
        <F label={agT('newCentre')}><In v={centre} set={setCentre} /></F>
        <button type="button" className={controls.btnOutline} disabled={!centre.trim()} onClick={() => run(() => { saveAgriSettings({ centres: [...centres, { id: '', name: centre, kind: 'cluster' } as AgCentre] }); setCentre(''); return agT('saved'); })}>{agT('addCentre')}</button>
      </div>
      {cards && <Suspense fallback={null}><FarmerCard farmers={list} centre={cName} onClose={() => setCards(false)} /></Suspense>}
    </div>
  );
}
