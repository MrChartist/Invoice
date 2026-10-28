import { useRef, useState } from 'react';
import type { InvoiceRecord } from '../../types/invoice';
import { acceptIssues, buildAcceptance, setQuoteAcceptance } from '../../lib/quote-acceptance';
import { cn, formatCurrency } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import { SignaturePad, type SignaturePadHandle } from '../ui/SignaturePad';
import { useT } from '../../i18n';
import { uxT } from '../../i18n/areas/invoicing-ux';
import controls from '../../styles/controls.module.css';
import ux from './ux.module.css';

/**
 * 8.101 counter acceptance: the client signs on the canvas (mouse, pen or finger), types their name,
 * and the quote gets a one-time `acceptance` snapshot (signer, timestamp, amount, PNG signature),
 * quote_status Accepted and an audit row. "Accepted by message" records a remote acceptance
 * (WhatsApp / e-mail reply to the client copy's Accept link) without a signature.
 */
export function AcceptQuoteDialog({ quote, open, onClose, onDone }: { quote: InvoiceRecord; open: boolean; onClose: () => void; onDone: () => void }) {
  useT();
  const pad = useRef<SignaturePadHandle>(null);
  const [inked, setInked] = useState(false);
  const [signer, setSigner] = useState(quote.client?.name ?? '');
  const [method, setMethod] = useState<'counter' | 'remote'>('counter');
  const [error, setError] = useState('');

  const clear = () => pad.current?.clear();

  const accept = () => {
    const signature = method === 'counter' && inked ? pad.current?.toDataUrl() : undefined;
    const issues = acceptIssues(quote, { signer, signature, method });
    if (issues.length) {
      setError(uxT(`acc_${issues[0]}` as const));
      return;
    }
    try {
      setQuoteAcceptance(quote.id, buildAcceptance(quote, { signer, signature, method }));
      onDone();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={uxT('accTitle', { number: quote.invoice_number })}
      subtitle={uxT('accSub', { amount: formatCurrency(quote.total, quote.currency) })}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{uxT('cancel')}</button>
          <button type="button" className={controls.btnPrimary} onClick={accept} data-accept-quote>{uxT('accConfirm')}</button>
        </>
      }
    >
      <div className={ux.sheet}>
        <div className={controls.segment} role="group" aria-label={uxT('accHow')}>
          <button type="button" className={method === 'counter' ? controls.segmentBtnActive : controls.segmentBtn} aria-pressed={method === 'counter'} onClick={() => setMethod('counter')}>{uxT('accCounter')}</button>
          <button type="button" className={method === 'remote' ? controls.segmentBtnActive : controls.segmentBtn} aria-pressed={method === 'remote'} onClick={() => setMethod('remote')}>{uxT('accRemote')}</button>
        </div>
        <label className={controls.field}>
          <span className={controls.label}>{uxT('accSigner')}</span>
          <input className={controls.input} value={signer} onChange={(e) => setSigner(e.target.value)} autoComplete="name" />
        </label>
        {method === 'counter' && (
          <>
            <span className={controls.label}>{uxT('accSignHere')}</span>
            <SignaturePad ref={pad} label={uxT('accSignHere')} onInk={setInked} />
            <div className={ux.row}>
              <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={clear}>{uxT('accClear')}</button>
              <span className={ux.muted}>{uxT('accSnapshotNote')}</span>
            </div>
          </>
        )}
        {method === 'remote' && <p className={ux.muted}>{uxT('accRemoteNote')}</p>}
        {error && <p className={controls.error} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

export default AcceptQuoteDialog;
