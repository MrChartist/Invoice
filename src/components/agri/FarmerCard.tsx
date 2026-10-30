/** AG-A2 farmer cards: code + QR of the code (`qrcode.react`), name, village, member no. — 8 per A4 sheet. */
import { useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { agT } from '../../i18n/areas/agri-r12a';
import { printHtmlDocument } from '../../lib/voucher-print';
import { downloadText } from '../../lib/download';
import { cardsPage } from '../../lib/agri/ag-print';
import type { Farmer } from '../../lib/agri/ag-farmers';
import controls from '../../styles/controls.module.css';

export default function FarmerCard({ farmers, centre, onClose }: { farmers: readonly Farmer[]; centre: (id?: string) => string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const print = () => {
    const html = cardsPage(ref.current?.innerHTML ?? '');
    printHtmlDocument(html, (h) => downloadText('farmer-cards.html', h, 'text/html'));
  };
  return (
    <section data-ag-cards>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="button" className={controls.btnPrimary} onClick={print}>{agT('print')}</button>
        <button type="button" className={controls.btnGhost} onClick={onClose}>{agT('cancel')}</button>
      </div>
      <div ref={ref} style={{ maxHeight: 320, overflow: 'auto' }}>
        <div className="cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {farmers.map((f) => (
            <div key={f.id} className="card" style={{ display: 'flex', gap: 8, alignItems: 'center', border: '1px solid var(--sep)', padding: 8 }}>
              <QRCodeSVG value={f.ag.code} size={72} />
              <div><strong>{f.ag.code}</strong><br />{f.name}<br />{[f.ag.village, centre(f.ag.centre_id)].filter(Boolean).join(' · ')}{f.ag.member_no ? <><br />{agT('memberNo')} {f.ag.member_no}</> : null}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
