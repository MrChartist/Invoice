import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import { createItemFromCode, quickItemDraft } from '../../lib/catalog';
import { UNITS, type InvoiceItem } from '../../types/invoice';
import { gstRateOptions } from '../../lib/tax-rules';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n';
import { retailT } from '../../i18n/areas/retail';
import controls from '../../styles/controls.module.css';
import { SelectField } from '../ui/SelectField';

/**
 * A scanned / typed code that no item has (8.149, the Tally Alt+C / myBillBook habit): create the item
 * on the spot — code prefilled, name, rate, GST %, HSN, unit — saved to the catalogue (`master.edit`),
 * then the caller adds it to the bill / editor line. "Search instead" keeps the text for a name search.
 */
export function QuickItemSheet({ code, onClose, onSaved, onSearch, defaultTax = 18 }: {
  code: string;
  onClose: () => void;
  onSaved: (item: InvoiceItem) => void;
  onSearch?: () => void;
  defaultTax?: number;
}) {
  useT();
  const [name, setName] = useState('');
  const [rate, setRate] = useState(0);
  const [tax, setTax] = useState(defaultTax);
  const [hsn, setHsn] = useState('');
  const [unit, setUnit] = useState('NOS');
  const [error, setError] = useState('');
  const draft = quickItemDraft(code, { name, rate, tax_rate: tax, hsn, unit });

  const save = () => {
    try {
      const r = createItemFromCode(code, { name, rate, tax_rate: tax, hsn, unit });
      if (!r.ok) return setError(r.error.message);
      onSaved(r.item);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={retailT('qiTitle')}
      subtitle={retailT(draft.short_code ? 'qiSubShort' : 'qiSub', { code })}
      footer={
        <>
          {onSearch && <button type="button" className={controls.btnGhost} onClick={onSearch} data-qi-search>{retailT('qiSearch')}</button>}
          <button type="button" className={controls.btnOutline} onClick={onClose}>{retailT('cancel')}</button>
          <button type="button" className={controls.btnPrimary} onClick={save} data-qi-save>{retailT('qiSave')}</button>
        </>
      }
    >
      <form
        className={controls.field}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        data-quick-item={code}
      >
        <label className={controls.field}>
          <span className={controls.label}>{retailT('qiName')}</span>
          <input id="qi-name" className={controls.input} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>{retailT('qiRate')}</span>
            <NumberInput id="qi-rate" className={cn(controls.input, controls.inputNumeric)} value={rate} onChange={setRate} placeholder="0.00" />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{retailT('qiGst')}</span>
            <SelectField className={controls.select} value={tax} onChange={(e) => setTax(Number(e.target.value))}>
              {gstRateOptions(undefined, tax).map((r) => <option key={r} value={r}>{r}%</option>)}
            </SelectField>
          </label>
        </div>
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>HSN</span>
            <input className={cn(controls.input, controls.inputMono)} value={hsn} inputMode="numeric" maxLength={8} onChange={(e) => setHsn(e.target.value.replace(/\D/g, ''))} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{retailT('qiUnit')}</span>
            <SelectField className={controls.select} value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNITS.map((u) => <option key={u}>{u}</option>)}
            </SelectField>
          </label>
        </div>
        {error && <p className={controls.error} role="alert">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
