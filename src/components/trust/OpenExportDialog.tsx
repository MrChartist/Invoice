/**
 * R4-C6 Settings → Data → "Export everything (CSV / Excel)": the whole company as CSVs (+ optional workbook) with
 * schema.json and README.md, streamed table by table with a progress line. ZIP / XLSX writers load on demand.
 */
import { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { can, requireAccess } from '../../lib/access';
import { DB_PREFIX, getJson, getTable, listKeys, readRaw } from '../../lib/storage';
import { attachmentBytes, base64ToBytes, storedAttachmentIds } from '../../lib/attachments';
import { downloadBlob } from '../../lib/download';
import { localDb } from '../../lib/localDb';
import { todayInput } from '../../lib/utils';
import { toCsv } from '../../lib/csv';
import { AssetSink, buildReadme, buildSchema, csvOf, exportFileName, exportableKeys, flattenObject, flattenTable, type FlatTable } from '../../lib/trust/open-export';
import { useT } from '../../i18n';
import { trErr, trT } from '../../i18n/areas/trade-trust-r4';
import controls from '../../styles/controls.module.css';
import styles from './trust.module.css';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const XLSX_CELL_MAX = 32000;

export default function OpenExportDialog({ onClose }: { onClose: () => void }) {
  useT();
  const [xlsx, setXlsx] = useState(false);
  const [bin, setBin] = useState(false);
  const [att, setAtt] = useState(false);
  const [progress, setProgress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const payroll = can('payroll.view');

  const build = async () => {
    setError('');
    setBusy(true);
    try {
      requireAccess('data.backup');
      const opts = { includeBin: bin, includeAttachments: att, payroll };
      const names = exportableKeys(listKeys(DB_PREFIX), opts);
      const sink = new AssetSink();
      const tables: FlatTable[] = [];
      for (let i = 0; i < names.length; i++) {
        setProgress(trT('openProgress', { done: i, total: names.length }));
        if (i % 8 === 0) await tick();
        const name = names[i];
        const raw = readRaw(DB_PREFIX + name) ?? '';
        if (raw.trimStart().startsWith('[')) tables.push(...flattenTable(name, getTable(name), sink));
        else tables.push(flattenObject(name, getJson(DB_PREFIX + name, null), sink));
      }
      const settings = localDb.settings.get();
      const company = settings.profiles.find((p) => p.id === settings.activeProfileId)?.companyName ?? '';
      const now = new Date().toISOString();
      const files: { name: string; data: string | Uint8Array }[] = tables.map((t) => ({ name: `${t.name}.csv`, data: csvOf(t) }));
      for (const a of sink.files) files.push({ name: a.path, data: base64ToBytes(a.base64) });
      let attachments = 0;
      if (att) {
        const index: unknown[][] = [['id', 'file', 'mime', 'bytes']];
        for (const id of storedAttachmentIds()) {
          const got = attachmentBytes(id);
          if (!got) continue;
          const ext = got.mime === 'application/pdf' ? 'pdf' : got.mime.split('/')[1] ?? 'bin';
          const file = `attachments/${id}.${ext}`;
          files.push({ name: file, data: got.bytes });
          index.push([id, file, got.mime, got.bytes.length]);
          attachments++;
        }
        files.push({ name: 'attachments_index.csv', data: '﻿' + toCsv(index) });
      }
      if (xlsx) {
        setProgress('workbook.xlsx …');
        await tick();
        const { writeXlsx } = await import('../../lib/xlsx');
        const cut = (v: unknown) => (typeof v === 'string' && v.length > XLSX_CELL_MAX ? `${v.slice(0, XLSX_CELL_MAX)}…` : (v as string | number | boolean));
        files.push({ name: 'workbook.xlsx', data: await writeXlsx(tables.map((t) => ({ name: t.name, rows: [t.columns, ...t.rows.map((r) => r.map(cut))] }))) });
      }
      files.push({ name: 'schema.json', data: JSON.stringify(buildSchema(tables, company, now), null, 2) });
      files.push({ name: 'README.md', data: buildReadme(tables, company, now, { ...opts, workbook: xlsx, attachments, images: sink.files.length }) });
      setProgress('ZIP …');
      await tick();
      const { zipBlob } = await import('../../lib/zip');
      downloadBlob(exportFileName(company, todayInput()), await zipBlob(files));
      setProgress(trT('openDone', { n: tables.length }));
    } catch (err) {
      setError(trErr(err));
      setProgress('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="md" title={<><FileSpreadsheet size={18} aria-hidden="true" /> {trT('openTitle')}</>}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{trT('close')}</button><button type="button" className={controls.btnPrimary} disabled={busy} onClick={() => void build()} data-testid="open-export-build">{trT('openBuild')}</button></>}>
      <div className={styles.stack} data-open-export>
        <p className={styles.muted}>{trT('openIntro')}</p>
        <label className={controls.check}><input type="checkbox" checked={xlsx} onChange={(e) => setXlsx(e.target.checked)} /> {trT('openXlsx')}</label>
        <label className={controls.check}><input type="checkbox" checked={bin} onChange={(e) => setBin(e.target.checked)} /> {trT('openBin')}</label>
        <label className={controls.check}><input type="checkbox" checked={att} onChange={(e) => setAtt(e.target.checked)} /> {trT('openAttachments')}</label>
        {!payroll && <p className={styles.muted}>{trT('openPayroll')}</p>}
        {progress && <p className={styles.muted} role="status" aria-live="polite">{progress}</p>}
        {error && <p className={controls.error} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
