/** TR-C2 statutory prompt (one lazy chunk per mount, so each host page preloads only what it needs). Working paper — verify with your CA. */
import { useT } from '../../i18n';
import { trT } from '../../i18n/areas/trade-r8c';
import { rcmGoodsMatches, supplierKinds } from '../../lib/trade/tr-statutory';
import controls from '../../styles/controls.module.css';
import own from '../distribution/dist.module.css';

export default function RcmGoodsNotice({ lines, date, vendor, onApply }: { lines: readonly { hsn?: string }[]; date: string; vendor?: { gstin?: string; principal_kind?: string }; onApply: () => void }) {
  useT();
  const kinds = supplierKinds(vendor);
  const hits = rcmGoodsMatches(lines, kinds, date);
  if (!hits.length) return null;
  const who = kinds.includes('agriculturist') ? 'agriculturist' : kinds.includes('unregistered') ? 'unregistered' : 'maker';
  return (
    <div className={own.notice} role="note" data-rcm-goods>
      <strong>{trT('rcmTitle')}</strong>{' '}
      {hits.map((h) => trT('rcmText', { goods: h.goods, who: trT(`who.${who}`), ref: h.notification })).join(' ')}{' '}
      <button type="button" className={controls.btnGhost} onClick={onApply}>{trT('rcmApply')}</button> <small>{trT('workingPaper')}</small>
    </div>
  );
}
