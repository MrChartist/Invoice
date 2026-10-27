/**
 * AG-D4 POS strip for an input dealer (mounted by the POS only with the `agri_inputs` pack on, lazily): the fertiliser
 * PoS transaction no. and the farmer ID (Aadhaar last 4 or KCC) when the cart holds a subsidised item, and "credit till
 * harvest" (a season). Reports the `ag.inputs` snapshot, the season due date and the errors that stop the save; the
 * monthly cap and missing licences are warnings shown here. Licence lines valid on the day are snapshotted for the paper.
 */
import { useEffect, useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { agdT } from '../../i18n/areas/agri-r12d';
import { localDb } from '../../lib/localDb';
import { capWarning, subsidisedTest, subsidyErrors } from '../../lib/agri/ag-subsidy';
import { classIndex, licenceLines, unlicensedWarnings } from '../../lib/agri/ag-licences';
import { DEFAULT_SEASONS, seasonDue } from '../../lib/agri/ag-season-credit';
import { readAgriSettings } from '../../lib/agri/ag-settings';
import type { AgSnapshot } from '../../types/agri-r12';
import type { InvoiceRecord } from '../../types/invoice';
import { F, Sel } from './agd-kit';
import controls from '../../styles/controls.module.css';

export interface PosAgri { ag: AgSnapshot; due?: string; errors: string[] }

export default function PosInputsStrip({ record, onChange }: { record: InvoiceRecord; onChange: (v: PosAgri | null) => void }) {
  useT();
  const s = useMemo(() => readAgriSettings(), []);
  const isSub = useMemo(() => subsidisedTest(), []);
  const idx = useMemo(() => classIndex(), []);
  const [v, setV] = useState({ pos_txn: '', farmer_id: '', season: '' });
  const day = record.issue_date;
  const names = (record.items ?? []).map((l) => `${l.name}:${l.quantity}`).join('|');
  const sub = (record.items ?? []).some((l) => l.name && isSub(l.name));
  const seasons = s.seasons?.length ? s.seasons : DEFAULT_SEASONS;
  const due = v.season ? seasonDue(seasons, v.season, day) : '';
  const ag: AgSnapshot = { kind: 'inputs', inputs: { ...(licenceLines(s.licences, day).length ? { licences: licenceLines(s.licences, day) } : {}), ...(v.pos_txn.trim() ? { pos_txn: v.pos_txn.trim() } : {}), ...(v.farmer_id.trim() ? { farmer_id: v.farmer_id.trim() } : {}), ...(due ? { season: v.season, season_due: due } : {}) } };
  const probe = { ...record, status: 'Sent' as const, ag };
  const errors = subsidyErrors(probe, isSub);
  const warns = [capWarning(probe, localDb.invoices.getAll(), isSub, s.subsidy_cap), ...unlicensedWarnings(record.items ?? [], s.licences, day, (n) => idx.get(n))].filter(Boolean) as string[];
  const key = `${names}|${v.pos_txn}|${v.farmer_id}|${v.season}|${day}`;
  useEffect(() => {
    onChange(Object.keys(ag.inputs ?? {}).length ? { ag, ...(due ? { due } : {}), errors } : errors.length ? { ag, errors } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <div className={controls.row} style={{ flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }} data-agd-pos>
      {sub && <F label={agdT('posTxn')} w={160}><input className={controls.input} value={v.pos_txn} onChange={(e) => setV({ ...v, pos_txn: e.target.value })} data-agd="pos-txn" /></F>}
      {sub && <F label={agdT('farmerId')} w={140}><input className={controls.input} value={v.farmer_id} maxLength={20} onChange={(e) => setV({ ...v, farmer_id: e.target.value })} data-agd="farmer-id" /></F>}
      <F label={agdT('creditTill')}><Sel value={v.season} onChange={(x) => setV({ ...v, season: x })} opts={seasons.map((x) => [x.name, x.name])} blank={agdT('noCredit')} data-agd="season" /></F>
      {due && <span className={controls.hint}>{agdT('dueAt', { date: due })}</span>}
      {[...errors, ...warns].map((m) => <p key={m} className={controls.hint} role="alert">{m}</p>)}
    </div>
  );
}
