/** MF-C2 bundle tickets: QR of `<lot>/<no>`, lot, style, size, colour, pieces, and tear-off coupons per operation — 8 or 12 per A4. */
import { useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { CutPlan } from '../../types/mfg-r13';
import { bundleId, livePieces } from '../../lib/mfg/mf-bundles';
import { printHtmlDocument } from '../../lib/voucher-print';
import { downloadText } from '../../lib/download';
import { gT } from '../../i18n/areas/mfg-r13c';
import { Btn, F, In, Sel } from './garments-ui';
import { row } from './garments-util';
import { PRINT_FONT, PRINT_FONT_FACE } from '../../lib/print-fonts';

const page = (body: string, per: number) => `<!doctype html><html><head><meta charset="utf-8"><title>Bundle tickets</title><style>${PRINT_FONT_FACE}
@page{size:A4;margin:8mm}body{font:12px ${PRINT_FONT};margin:0}.t{display:grid;grid-template-columns:repeat(${per === 12 ? 3 : 2},1fr);gap:4mm}
.k{border:1px dashed #555;padding:2mm;break-inside:avoid;height:${per === 12 ? 66 : 68}mm;overflow:hidden}.c{border-top:1px dashed #999;padding-top:1mm;margin-top:1mm}
</style></head><body>${body}</body></html>`;

export default function BundleTickets({ plan, styleName, onClose }: { plan: CutPlan; styleName: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [per, setPer] = useState('8');
  const [ops, setOps] = useState('Stitching:38, Finishing:4');
  const coupons = ops.split(',').map((s) => s.split(':').map((x) => x.trim())).filter(([n]) => n);
  const print = () => printHtmlDocument(page(ref.current?.innerHTML ?? '', Number(per)), (h) => downloadText('bundle-tickets.html', h, 'text/html'));
  return (
    <section data-mfc-tickets>
      <div style={row}>
        <F label={gT('perSheet')} w={110}><Sel v={per} set={setPer} o={[['8', '8'], ['12', '12']]} /></F>
        <F label={gT('coupons')}><In v={ops} set={setOps} /></F>
        <Btn kind="btnPrimary" on={print} data-mfc="t-print">{gT('print')}</Btn>
        <Btn kind="btnGhost" on={onClose}>{gT('cancel')}</Btn>
      </div>
      <div ref={ref} style={{ maxHeight: 360, overflow: 'auto' }}>
        <div className="t" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {(plan.bundles ?? []).map((b) => {
            const id = bundleId(plan.number, b.no);
            return (
              <div key={b.no} className="k" data-mfc-ticket={id} style={{ border: '1px dashed var(--sep)', padding: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <QRCodeSVG value={id} size={64} />
                  <div><strong>{id}</strong><br />{styleName}<br />{b.size} · {b.colour}{b.shade ? ` · ${b.shade}` : ''}<br />{gT('pieces')}: {livePieces(b)}</div>
                </div>
                {coupons.map(([n, r]) => <div key={n} className="c" style={{ borderTop: '1px dashed var(--sep)', marginTop: 4 }}>{id} · {n}{r ? ` · ₹${r}` : ''} · {livePieces(b)} {gT('pcs')}</div>)}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
