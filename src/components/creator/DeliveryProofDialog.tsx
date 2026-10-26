import { useRef, useState } from 'react';
import type { InvoiceRecord } from '../../types/invoice';
import { proofIssues, setDeliveryProof, type ProofIssue } from '../../lib/doc-evidence';
import { currentRole } from '../../lib/access';
import { cn } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import { SignaturePad, type SignaturePadHandle } from '../ui/SignaturePad';
import { useT } from '../../i18n';
import { d3T } from '../../i18n/areas/docs-r3';
import controls from '../../styles/controls.module.css';
import styles from './DeliveryProofDialog.module.css';

const ISSUE_KEY: Record<ProofIssue, Parameters<typeof d3T>[0]> = {
  notSignable: 'pf.notSignable',
  draft: 'pf.draft',
  cancelled: 'pf.cancelled',
  already: 'pf.already',
  receiver: 'pf.receiver',
  signature: 'pf.signature',
  reason: 'pf.reason',
  owner: 'pf.owner',
};

/**
 * R3-C2 "Get signature": the customer signs for the goods / work on this device and types their name,
 * with an optional remark. Written once on the document (proof of delivery); the owner can replace it
 * with a reason (audited).
 */
export default function DeliveryProofDialog({ invoice, onClose, onDone }: { invoice: InvoiceRecord; onClose: () => void; onDone: () => void }) {
  useT();
  const pad = useRef<SignaturePadHandle>(null);
  const replacing = !!invoice.delivery_proof;
  const [receiver, setReceiver] = useState(replacing ? '' : (invoice.client?.name ?? ''));
  const [remark, setRemark] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const save = () => {
    const input = { receiver, remark, reason, signature: pad.current?.toDataUrl() };
    const issues = proofIssues(invoice, input, currentRole());
    if (issues.length) {
      setError(d3T(ISSUE_KEY[issues[0]]));
      return;
    }
    try {
      setDeliveryProof(invoice.id, input);
      onDone();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={replacing ? d3T('pf.replaceTitle', { number: invoice.invoice_number }) : d3T('pf.title', { number: invoice.invoice_number })}
      subtitle={d3T('pf.sub')}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{d3T('cancel')}</button>
          <button type="button" className={controls.btnPrimary} onClick={save} data-proof-save>{d3T('pf.save')}</button>
        </>
      }
    >
      <div className={styles.sheet}>
        <label className={controls.field}>
          <span className={controls.label}>{d3T('pf.receiverName')}</span>
          <input className={controls.input} value={receiver} onChange={(e) => setReceiver(e.target.value)} autoComplete="name" data-proof-receiver />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{d3T('pf.remark')}</span>
          <input className={controls.input} value={remark} placeholder={d3T('pf.remarkPh')} onChange={(e) => setRemark(e.target.value)} maxLength={120} />
        </label>
        <span className={controls.label}>{d3T('pf.signHere')}</span>
        <SignaturePad ref={pad} label={d3T('pf.signHere')} />
        <div className={styles.row}>
          <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => pad.current?.clear()}>{d3T('pf.clear')}</button>
          <span className={styles.muted}>{d3T('pf.snapshotNote')}</span>
        </div>
        {replacing && (
          <label className={controls.field}>
            <span className={controls.label}>{d3T('pf.reasonLabel')}</span>
            <input className={controls.input} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
          </label>
        )}
        <p className={styles.muted}>{d3T('pf.caNote')}</p>
        {error && <p className={controls.error} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
