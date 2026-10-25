import { useEffect, useRef, useState } from 'react';
import type { InvoiceRecord } from '../../types/invoice';
import { acceptIssues, buildAcceptance, setQuoteAcceptance } from '../../lib/quote-acceptance';
import { cn, formatCurrency } from '../../lib/utils';
import { Modal } from '../ui/Modal';
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
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [inked, setInked] = useState(false);
  const [signer, setSigner] = useState(quote.client?.name ?? '');
  const [method, setMethod] = useState<'counter' | 'remote'>('counter');
  const [error, setError] = useState('');

  useEffect(() => {
    const c = canvas.current;
    if (!open || !c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = getComputedStyle(c).color || 'black';
  }, [open, method]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    const [x, y] = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    const [x, y] = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!inked) setInked(true);
  };
  const up = () => {
    drawing.current = false;
  };
  const clear = () => {
    const c = canvas.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setInked(false);
  };

  const accept = () => {
    const signature = method === 'counter' && inked ? canvas.current?.toDataURL('image/png') : undefined;
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
            <canvas
              ref={canvas}
              className={ux.sigPad}
              aria-label={uxT('accSignHere')}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerLeave={up}
              data-signature-pad
            />
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
