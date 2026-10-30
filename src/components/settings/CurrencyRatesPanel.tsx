import { useRef, useState } from 'react';
import { IndianRupee, Plus, Trash2, Upload } from 'lucide-react';
import { deleteRate, loadRates, parseRatesCsv, saveRates, type CurrencyRate } from '../../lib/currency-rates';
import { can } from '../../lib/access';
import { localDayOf } from '../../lib/dates';
import { useT } from '../../i18n';
import { reachT } from '../../i18n/areas/reach';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './ShopModePanel.module.css';
import { DateField } from '../ui/DateField';

type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;

/** Settings → Defaults → Currency reference rates (8H): manual entry and RBI / FBIL CSV import. */
export function CurrencyRatesPanel({ notify }: { notify: Notify }) {
  useT();
  const [rows, setRows] = useState<CurrencyRate[]>(loadRates);
  const [currency, setCurrency] = useState('USD');
  const [date, setDate] = useState(() => localDayOf(new Date()));
  const [rate, setRate] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const editable = can('master.edit');
  const refresh = () => setRows(loadRates());

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(rate);
    const code = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code) || code === 'INR' || !(n > 0) || !date) return notify(reachT('ratesSub'), 'error');
    try {
      saveRates([{ currency: code, date, rate: n, source: 'manual' }]);
      setRate('');
      refresh();
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const importCsv = async (f?: File) => {
    if (!f) return;
    try {
      const { rows: parsed, skipped } = parseRatesCsv(await f.text(), /fbil/i.test(f.name) ? 'FBIL' : /rbi/i.test(f.name) ? 'RBI' : 'import');
      saveRates(parsed);
      notify(reachT('ratesImported', { n: parsed.length, skipped }));
      refresh();
    } catch (err) {
      notify((err as Error).message, 'error');
    } finally {
      if (file.current) file.current.value = '';
    }
  };

  const recent = rows.slice().sort((a, b) => b.date.localeCompare(a.date) || a.currency.localeCompare(b.currency)).slice(0, 30);

  return (
    <section className={surface.card} aria-labelledby="fx-rates-title">
      <div className={surface.cardHead} id="fx-rates-title">
        <IndianRupee size={16} aria-hidden="true" /> {reachT('ratesTitle')}
      </div>
      <div className={surface.cardBody}>
        <p className={controls.hint}>{reachT('ratesSub')}</p>
        {editable && (
          <form className={controls.row} onSubmit={add}>
            <label className={controls.field}>
              <span className={controls.label}>{reachT('ratesCurrency')}</span>
              <input className={controls.input} maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{reachT('ratesDate')}</span>
              <DateField className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{reachT('ratesRate')}</span>
              <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
            </label>
            <div className={styles.actions}>
              <button type="submit" className={`${controls.btnOutline} ${controls.btnSm}`}><Plus size={14} /> {reachT('ratesAdd')}</button>
              <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => file.current?.click()}><Upload size={14} /> {reachT('ratesImport')}</button>
              <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => void importCsv(e.target.files?.[0])} />
            </div>
          </form>
        )}
        {recent.length === 0 ? (
          <p className={controls.hint}>{reachT('ratesEmpty')}</p>
        ) : (
          <table className={surface.table}>
            <thead>
              <tr><th>{reachT('ratesCurrency')}</th><th>{reachT('ratesDate')}</th><th>{reachT('ratesRate')}</th><th>{reachT('ratesSource')}</th><th /></tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td>{r.currency}</td>
                  <td>{r.date}</td>
                  <td>{r.rate}</td>
                  <td>{r.source}</td>
                  <td>
                    {editable && (
                      <button type="button" className={controls.btnIcon} aria-label={reachT('ratesDelete', { currency: r.currency, date: r.date })} onClick={() => { deleteRate(r.id); refresh(); }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
