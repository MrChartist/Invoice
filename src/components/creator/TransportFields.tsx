import { useMemo, type ChangeEvent } from 'react';
import { Truck } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { pick } from '../../store/pick';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { resolveEInvoiceMeta } from '../../lib/einvoice-print';
import { cleanVehicle, ewayPrefillAvailable, hasTransport, normalizeTransport, transportFromEway, TRANSPORT_MODES } from '../../lib/transport';
import type { TransportDetails, TransportMode } from '../../types/invoice';
import { useT } from '../../i18n';
import { printT } from '../../i18n/areas/printing';
import controls from '../../styles/controls.module.css';

const MODE_KEY: Record<TransportMode, 'road' | 'rail' | 'air' | 'ship'> = { ROAD: 'road', RAIL: 'rail', AIR: 'air', SHIP: 'ship' };

/**
 * Transport / dispatch details (P1-24): mode, vehicle, transporter, LR / RR, e-Way bill no.
 * Collapsed until used. Typing keeps the raw text; the record is normalised on save / print.
 */
export function TransportFields() {
  useT(); // re-render on language change
  const s = useInvoiceStore(useShallow((st) => pick(st, ['id', 'transport', 'patch'])));
  const t: TransportDetails = s.transport ?? {};
  // e-Way details saved by the e-Invoice module for this document (vehicle, transporter, EWB no.).
  const meta = useMemo(() => resolveEInvoiceMeta(s.id), [s.id]);
  const canPrefill = ewayPrefillAvailable(meta, s.transport);

  const set = (patch: Partial<TransportDetails>) => {
    const next: Record<string, unknown> = { ...t, ...patch };
    for (const k of Object.keys(next)) if (next[k] === '' || next[k] === undefined) delete next[k];
    s.patch({ transport: Object.keys(next).length ? (next as TransportDetails) : undefined });
  };
  const text = (key: keyof TransportDetails) => ({
    value: (t[key] as string | undefined) ?? '',
    onChange: (e: ChangeEvent<HTMLInputElement>) => set({ [key]: e.target.value }),
  });

  return (
    <details open={hasTransport(t) || undefined}>
      <summary className={controls.label} style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Truck size={14} aria-hidden="true" /> {printT('transport')}
      </summary>
      <p className={controls.hint}>{printT('transportHint')}</p>
      <div className={controls.row3}>
        <label className={controls.field}>
          <span className={controls.label}>{printT('mode')}</span>
          <select className={controls.select} value={t.mode ?? ''} onChange={(e) => set({ mode: (e.target.value || undefined) as TransportMode | undefined })}>
            <option value="">{printT('modeNone')}</option>
            {TRANSPORT_MODES.map((m) => (
              <option key={m} value={m}>{printT(MODE_KEY[m])}</option>
            ))}
          </select>
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{printT('vehicle')}</span>
          <input
            className={`${controls.input} ${controls.inputMono}`}
            value={t.vehicle_no ?? ''}
            onChange={(e) => set({ vehicle_no: e.target.value.toUpperCase() })}
            onBlur={(e) => set({ vehicle_no: cleanVehicle(e.target.value) })}
            placeholder="MH12AB1234"
            autoComplete="off"
          />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{printT('ewayNo')}</span>
          <input className={`${controls.input} ${controls.inputMono}`} inputMode="numeric" {...text('eway_bill_no')} autoComplete="off" />
        </label>
      </div>
      <div className={controls.row3}>
        <label className={controls.field}>
          <span className={controls.label}>{printT('transporterName')}</span>
          <input className={controls.input} {...text('transporter_name')} />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{printT('transporterId')}</span>
          <input className={`${controls.input} ${controls.inputMono}`} value={t.transporter_id ?? ''} onChange={(e) => set({ transporter_id: e.target.value.toUpperCase() })} maxLength={15} autoComplete="off" />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{printT('distance')}</span>
          <input
            className={controls.input}
            type="number"
            min={0}
            max={4000}
            value={t.distance_km ?? ''}
            onChange={(e) => set({ distance_km: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) || undefined })}
          />
        </label>
      </div>
      <div className={controls.row3}>
        <label className={controls.field}>
          <span className={controls.label}>{printT('lrNo')}</span>
          <input className={controls.input} {...text('lr_no')} />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{printT('lrDate')}</span>
          <input className={controls.input} type="date" {...text('lr_date')} />
        </label>
        <div className={controls.field} style={{ justifyContent: 'flex-end', flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          {canPrefill && (
            <button type="button" className={controls.btnOutline} onClick={() => s.patch({ transport: transportFromEway(meta, normalizeTransport(s.transport)) })}>
              {printT('fromEway')}
            </button>
          )}
          {hasTransport(t) && (
            <button type="button" className={controls.btnGhost} onClick={() => s.patch({ transport: undefined })}>
              {printT('clear')}
            </button>
          )}
        </div>
      </div>
    </details>
  );
}
