/** TR-C2 statutory prompt (one lazy chunk per mount, so each host page preloads only what it needs). Working paper — verify with your CA. */
import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { trT } from '../../i18n/areas/trade-r8c';
import { rcmGoodsMatches, supplierKinds } from '../../lib/trade/tr-statutory';
import { stockDb } from '../../lib/inventory';
import controls from '../../styles/controls.module.css';
import own from '../distribution/dist.module.css';

type Line = { hsn?: string; name?: string; description?: string; item_id?: string };

export default function RcmGoodsNotice({ lines, date, vendor, onApply }: { lines: readonly Line[]; date: string; vendor?: { gstin?: string; principal_kind?: string; rcm_maker?: boolean }; onApply: () => void }) {
  useT();
  const kinds = supplierKinds(vendor);
  // R13 (MF-B3): metal scrap from an unregistered supplier (N 6/2024-CT(R)) — one lazy class lookup, only for such a supplier.
  const [scrap, setScrap] = useState<string | null>(null);
  const unreg = kinds.includes('unregistered');
  const sig = unreg ? lines.map((l) => `${l.hsn ?? ''}|${l.item_id ?? ''}`).join(',') : '';
  useEffect(() => {
    let live = true;
    if (sig) {
      void import('../../lib/mfg/mf-scrap-tax').then((m) => {
        const items = stockDb.items();
        if (live) setScrap(m.scrapRcm(lines, vendor, date, (id) => items.find((i) => i.id === id))?.ref ?? null);
      });
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, date]);
  const hits = rcmGoodsMatches(lines, kinds, date);
  if (!hits.length && !(sig && scrap)) return null;
  const who = kinds.includes('agriculturist') ? 'agriculturist' : kinds.includes('unregistered') ? 'unregistered' : 'maker';
  return (
    <div className={own.notice} role="note" data-rcm-goods>
      <strong>{trT('rcmTitle')}</strong>{' '}
      {hits.map((h) => trT('rcmText', { goods: h.goods, who: trT(`who.${who}`), ref: h.notification })).join(' ')}{' '}
      {sig && scrap && <span data-rcm-scrap>{trT('rcmText', { goods: 'Metal scrap (ch 72–81 waste)', who: trT('who.unregistered'), ref: scrap })} </span>}
      <button type="button" className={controls.btnGhost} onClick={onApply}>{trT('rcmApply')}</button> <small>{trT('workingPaper')}</small>
    </div>
  );
}
