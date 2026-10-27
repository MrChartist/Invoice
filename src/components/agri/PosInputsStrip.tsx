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
import { capWarning, subsidisedBags, subsidisedTest, subsidyErrors } from '../../lib/agri/ag-subsidy';
import { classIndex, licenceLines, unlicensedWarnings } from '../../lib/agri/ag-licences';
import { DEFAULT_SEASONS, seasonDue } from '../../lib/agri/ag-season-credit';
import { readAgriSettings } from '../../lib/agri/ag-settings';
import { agSnapshot } from '../../lib/agri/ag-snapshot';
import type { AgSnapshot } from '../../types/agri-r12';
import type { InvoiceRecord } from '../../types/invoice';
import { Form } from './agd-kit';
import controls from '../../styles/controls.module.css';

export interface PosAgri { ag: AgSnapshot; due?: string; errors: string[] }

export default function PosInputsStrip({ record, onChange }: { record: InvoiceRecord; onChange: (v: PosAgri | null) => void }) {
  useT();
  const [s, isSub, idx] = useMemo(() => [readAgriSettings(), subsidisedTest(), classIndex()] as const, []);
  const [v, setV] = useState<Record<string, string>>({});
  const day = record.issue_date;
  const sub = subsidisedBags(record, isSub);
  const seasons = s.seasons?.length ? s.seasons : DEFAULT_SEASONS;
  const due = v.season ? seasonDue(seasons, v.season, day) : '';
  const id = v.farmer_id?.trim();
  const ag = agSnapshot('inputs', { inputs: { licences: licenceLines(s.licences, day), pos_txn: v.pos_txn?.trim(), farmer_id: id, farmer_id_last4: /^\d{4}$/.test(id ?? '') ? id : undefined, subsidy_bags: sub || undefined, season: due ? v.season : undefined, season_due: due || undefined } });
  const errors = subsidyErrors({ ...record, status: 'Sent', ag }, isSub);
  const warns = [capWarning({ ...record, ag }, localDb.invoices.getAll(), isSub, s.subsidy?.cap), ...unlicensedWarnings(record.items ?? [], s.licences, day, (n) => idx.get(n))];
  const key = JSON.stringify([ag, errors, due]);
  useEffect(() => {
    onChange(ag.inputs || errors.length ? { ag, due: due || undefined, errors } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <div data-agd-pos>
      <Form v={v} set={setV} f={[!!sub && ['pos_txn', 'posTxn', 't', 160], !!sub && ['farmer_id', 'farmerId', 't', 140], ['season', 'creditTill', seasons.map((x) => [x.name, x.name] as const)]]}>
        {due && <span className={controls.hint}>{agdT('dueAt', { date: due })}</span>}
      </Form>
      {[...errors, ...warns].filter(Boolean).map((m) => <p key={m} className={controls.hint} role="alert">{m}</p>)}
    </div>
  );
}
