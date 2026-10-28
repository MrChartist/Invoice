/** TR-B3 broker on a sale or a goods bill (lazy; commodity / agency pack). "Default for this party" stores it on the party. */
import { useMemo, useState } from 'react';
import { tbT } from '../../i18n/areas/trade-r8b';
import { loadBrokers } from '../../lib/trade/tr-brokers';
import controls from '../../styles/controls.module.css';

export default function BrokerPicker({ value, onChange, onRemember }: { value?: string; onChange: (id: string | undefined) => void; onRemember?: (id: string | undefined) => void }) {
  const brokers = useMemo(() => loadBrokers().filter((b) => b.active !== false || b.id === value), [value]);
  const [kept, setKept] = useState(false);
  if (!brokers.length) return null;
  return (
    <label className={controls.field} data-broker-picker>
      <span className={controls.label}>{tbT('broker')}</span>
      <select className={controls.select} value={value ?? ''} onChange={(e) => { onChange(e.target.value || undefined); setKept(false); }} data-broker>
        <option value="">{tbT('none')}</option>
        {brokers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      {onRemember && (
        <span className={controls.check}>
          <input type="checkbox" checked={kept} onChange={(e) => { setKept(e.target.checked); if (e.target.checked) onRemember(value); }} /> {tbT('remember')}
        </span>
      )}
    </label>
  );
}
