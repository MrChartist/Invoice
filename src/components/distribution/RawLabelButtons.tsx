import { useState } from 'react';
import { Download, Usb } from 'lucide-react';
import type { LabelItem, LabelLayout } from '../../lib/label-sheet';
import { RAW_LANGUAGES, rawBytes, rawLabels, type RawLanguage } from '../../lib/label-raw';
import { downloadText } from '../../lib/download';
import { useT } from '../../i18n';
import { skT } from '../../i18n/areas/stock-depth';
import controls from '../../styles/controls.module.css';

/** 8.87: raw TSPL / EPL / ZPL for thermal roll layouts — over Web Serial (feature-detected) or as a file. */
export default function RawLabelButtons({ items, layout, onMessage }: { items: LabelItem[]; layout: LabelLayout; onMessage: (m: string) => void }) {
  useT();
  const [lang, setLang] = useState<RawLanguage>('tspl');
  if (!layout.roll) return null;
  const serial = typeof navigator !== 'undefined' && 'serial' in navigator;
  const text = () => rawLabels(items, layout, lang);
  const send = async () => {
    try {
      const { sendToSerial } = await import('../../lib/escpos');
      await sendToSerial(rawBytes(text()), 9600);
      onMessage(skT('rawSent'));
    } catch (err) {
      onMessage((err as Error).message);
    }
  };
  return (
    <>
      <select className={controls.select} value={lang} aria-label={skT('rawLang')} onChange={(e) => setLang(e.target.value as RawLanguage)}>
        {RAW_LANGUAGES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
      </select>
      {serial && <button type="button" className={controls.btnOutline} disabled={!items.some((i) => i.copies > 0)} onClick={() => void send()}><Usb size={16} aria-hidden="true" /> {skT('sendSerial')}</button>}
      <button type="button" className={controls.btnOutline} disabled={!items.some((i) => i.copies > 0)} onClick={() => downloadText(`labels.${lang === 'zpl' ? 'zpl' : 'prn'}`, text())}><Download size={16} aria-hidden="true" /> {skT('saveRaw')}</button>
    </>
  );
}
