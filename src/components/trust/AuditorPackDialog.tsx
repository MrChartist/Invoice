/**
 * R4-C5 Settings → Activity → "Auditor pack…": one ZIP per FY (edit log incl. archive segments, deletions,
 * back-dated entries, overrides / approvals, users, integrity.txt with its SHA-256, README). The ZIP writer is
 * loaded on demand; the year-end checklist step "Auditor pack generated" is marked. Verify with your CA.
 */
import { useState } from 'react';
import { FileArchive, ShieldCheck } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { audit, auditSegments } from '../../lib/audit';
import { can } from '../../lib/access';
import { listUsers } from '../../lib/auth';
import { getIndianFY } from '../../lib/invoice-number';
import { localDb } from '../../lib/localDb';
import { getTable, peekTable } from '../../lib/storage';
import { downloadBlob } from '../../lib/download';
import { verifyAuditChain } from '../../lib/audit-chain';
import { buildAuditorPack, markAuditorPack, type DatedDoc } from '../../lib/trust/auditor-pack';
import { useT } from '../../i18n';
import { trErr, trT } from '../../i18n/areas/trade-trust-r4';
import controls from '../../styles/controls.module.css';
import styles from './trust.module.css';

type Row = Record<string, unknown>;
const s = (v: unknown) => (typeof v === 'string' ? v : '');

/** Documents, vouchers and bills with their date and creation time (for the back-dated list). */
function datedDocs(): DatedDoc[] {
  const out: DatedDoc[] = [];
  for (const r of peekTable<Row>('invoices')) out.push({ kind: s(r.doc_type) || 'INVOICE', number: s(r.invoice_number), date: s(r.issue_date).slice(0, 10), created_at: s(r.created_at), party: s((r.client as Row | undefined)?.name) });
  for (const r of peekTable<Row>('vouchers')) out.push({ kind: `Voucher ${s(r.type).toLowerCase()}`, number: s(r.number), date: s(r.date), created_at: s(r.created_at) });
  for (const r of peekTable<Row>('purchases')) out.push({ kind: s(r.kind) === 'EXPENSE' ? 'Expense' : 'Supplier bill', number: s(r.bill_number), date: s(r.date).slice(0, 10), created_at: s(r.created_at), party: s(r.vendor_name) });
  return out;
}

export default function AuditorPackDialog({ onClose }: { onClose: () => void }) {
  useT();
  const current = getIndianFY().startYear;
  const fys = Array.from({ length: 9 }, (_, i) => current - i).map((y) => `FY${String(y).slice(2)}-${String(y + 1).slice(2)}`);
  // Audit season (April–September): last year by default.
  const [fy, setFy] = useState(() => fys[new Date().getMonth() >= 3 && new Date().getMonth() <= 8 ? 1 : 0]);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ sha256: string; counts: ReturnType<typeof buildAuditorPack>['counts']; ok: boolean } | null>(null);
  const [error, setError] = useState('');

  const build = async () => {
    setBusy(true);
    setError('');
    try {
      const chain = audit.fullRows();
      const settings = localDb.settings.get();
      const company = settings.profiles.find((p) => p.id === settings.activeProfileId)?.companyName ?? '';
      const pack = buildAuditorPack({
        fy,
        chain,
        segments: auditSegments().map((name) => ({ name, rows: getTable(name).length })),
        company,
        generatedAt: new Date().toISOString(),
        docs: datedDocs(),
        users: listUsers().map((u) => ({ name: u.name, role: u.role, createdAt: u.createdAt })),
        payroll: can('payroll.view'),
        backdatedDays: days,
      });
      const { zipBlob } = await import('../../lib/zip');
      const blob = await zipBlob(pack.files.map((f) => ({ name: `auditor-pack-${fy}/${f.name}`, data: f.text })));
      downloadBlob(`auditor-pack-${fy}-${(company || 'company').replace(/[^A-Za-z0-9]+/g, '-')}.zip`, blob);
      setDone({ sha256: pack.sha256, counts: pack.counts, ok: verifyAuditChain(chain).ok });
      // Year-end checklist (WP-7): "Auditor pack generated" for that FY.
      try {
        markAuditorPack(2000 + Number(fy.slice(2, 4)));
      } catch {
        /* a viewer may download the pack without marking the books */
      }
    } catch (err) {
      setError(trErr(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="md" title={<><FileArchive size={18} aria-hidden="true" /> {trT('packTitle')}</>}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{trT('close')}</button><button type="button" className={controls.btnPrimary} disabled={busy} onClick={() => void build()} data-testid="pack-build">{busy ? trT('packBuilding') : trT('packBuild')}</button></>}>
      <div className={styles.stack} data-auditor-pack>
        <p className={styles.muted}>{trT('packIntro')}</p>
        <div className={styles.inline}>
          <label className={controls.field}>
            <span className={controls.label}>{trT('packFy')}</span>
            <select className={controls.select} value={fy} onChange={(e) => setFy(e.target.value)}>{fys.map((f) => <option key={f} value={f}>{f}</option>)}</select>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{trT('packDays')}</span>
            <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="numeric" value={String(days)} onChange={(e) => setDays(Math.max(1, Math.min(365, Number(e.target.value.replace(/\D/g, '')) || 7)))} />
          </label>
        </div>
        {done && (
          <div className={styles.stack} role="status">
            <p className={done.ok ? styles.ok : styles.bad}><ShieldCheck size={14} aria-hidden="true" /> {done.ok ? trT('packChainOk') : trT('packChainBroken')} {trT('packDone', { fy })}</p>
            <p className={styles.muted}>{trT('packCounts', done.counts)}</p>
            <span className={controls.label}>{trT('packHash')}</span>
            <code className={styles.hash} data-testid="pack-hash">{done.sha256}</code>
          </div>
        )}
        {error && <p className={controls.error} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
