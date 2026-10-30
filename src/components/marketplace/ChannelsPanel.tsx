/** R5-A2: the channel master — operator GSTINs / TAN, party, godowns, payout cycle, fee %, claim window, clearing. */
import { useMemo, useState } from 'react';
import { Store } from 'lucide-react';
import { mT } from '../../i18n/areas/packs-marketplace-r5';
import { PLATFORMS, OPERATOR_NAMES, saveChannel, validateChannel } from '../../lib/marketplace/channels';
import { clearingBalance } from '../../lib/marketplace/settlement-post';
import { bankAccountsDb } from '../../lib/bank-accounts';
import { godownsDb } from '../../lib/godowns';
import { localDb } from '../../lib/localDb';
import type { ChannelPlatform, SalesChannel } from '../../types/marketplace-r5';
import { errText, fmtMoney, today, type PanelProps } from './file-read';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './marketplace.module.css';
import { SelectField } from '../ui/SelectField';

/** Channel select shared by the sub-views. */
export function ChannelPicker({ channels, channel, setChannelId }: Pick<PanelProps, 'channels' | 'channel' | 'setChannelId'>) {
  if (!channels.length) return <p className={styles.warn}>{mT('noChannels')}</p>;
  return (
    <label className={controls.field}>
      <span className={controls.label}>{mT('channel')}</span>
      <SelectField className={controls.select} value={channel?.id ?? ''} onChange={(e) => setChannelId(e.target.value)} data-mkt-channel>
        {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </SelectField>
    </label>
  );
}

interface Form {
  id?: string;
  name: string;
  platform: ChannelPlatform;
  party: string;
  gstins: string;
  tan: string;
  godown: string;
  damaged: string;
  cycle: string;
  feePct: string;
  window: string;
}

const blank = (): Form => ({ name: '', platform: 'amazon', party: OPERATOR_NAMES.amazon, gstins: '', tan: '', godown: '', damaged: '', cycle: '14', feePct: '', window: '' });

function toForm(c: SalesChannel): Form {
  return {
    id: c.id, name: c.name, platform: c.platform, party: localDb.clients.getById(c.party_id)?.name ?? '',
    gstins: c.gstins.map((g) => g.gstin).join('\n'), tan: c.tan ?? '', godown: c.godown_id ?? '', damaged: c.damaged_godown_id ?? '',
    cycle: String(c.payout_cycle_days ?? 14), feePct: c.expected_fee_pct?.find((r) => !r.group_id)?.pct?.toString() ?? '',
    window: c.claim_window?.[c.claim_window.length - 1]?.days?.toString() ?? '',
  };
}

export function ChannelsPanel({ channels, notify, refresh, tick }: PanelProps) {
  const [f, setF] = useState<Form>(blank);
  const godowns = useMemo(() => godownsDb.list(), []);
  const banks = useMemo(() => new Map(bankAccountsDb.all().map((b) => [b.id, b.name])), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const gstins = f.gstins.split(/[\s,;]+/).map((g) => g.trim().toUpperCase()).filter(Boolean).map((gstin) => ({ state: gstin.slice(0, 2), gstin }));
  const check = validateChannel({ name: f.name || 'x', gstins, tan: f.tan.trim() || undefined });
  const set = (patch: Partial<Form>) => setF((p) => ({ ...p, ...patch }));

  const save = () => {
    try {
      const prev = channels.find((c) => c.id === f.id);
      const fee = Number(f.feePct);
      const win = Number(f.window);
      const row = saveChannel({
        ...(prev ?? {}),
        id: f.id, name: f.name, platform: f.platform, party_name: f.party, gstins, tan: f.tan,
        godown_id: f.godown || undefined, damaged_godown_id: f.damaged || undefined,
        payout_cycle_days: Number(f.cycle) || undefined,
        expected_fee_pct: f.feePct.trim() && fee >= 0 ? [{ pct: fee }] : undefined,
        claim_window: f.window.trim() && win >= 0 ? [{ from: '2017-07-01', days: Math.round(win) }] : undefined,
      });
      notify(mT('chSaved', { name: bankAccountsDb.all().find((b) => b.id === row.clearing_bank_id)?.name ?? '' }));
      setF(blank());
      refresh();
    } catch (err) {
      notify(errText(err), 'error');
    }
  };

  return (
    <div className={styles.stack}>
      {channels.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{mT('chName')}</th><th>{mT('chPlatform')}</th><th>GSTIN</th><th>{mT('chClearing')}</th><th className={surface.numeric}>{mT('chBalance')}</th><th /></tr></thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.id}>
                  <td><Store size={14} aria-hidden="true" /> {c.name}</td>
                  <td>{mT(`platform.${c.platform}`)}</td>
                  <td className={surface.mono}>{c.gstins.map((g) => g.gstin).join(', ') || '-'}</td>
                  <td>{banks.get(c.clearing_bank_id) ?? '-'}</td>
                  <td className={surface.numeric}>{fmtMoney(clearingBalance(c.clearing_bank_id, today()))}</td>
                  <td><button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => setF(toForm(c))}>{mT('edit')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3 className={surface.cardHead}>{f.id ? f.name : mT('chNew')}</h3>
      <div className={styles.grid}>
        <label className={controls.field}><span className={controls.label}>{mT('chName')}</span>
          <input className={controls.input} value={f.name} onChange={(e) => set({ name: e.target.value })} data-mkt-ch-name /></label>
        <label className={controls.field}><span className={controls.label}>{mT('chPlatform')}</span>
          <SelectField className={controls.select} value={f.platform} onChange={(e) => { const p = e.target.value as ChannelPlatform; set({ platform: p, party: f.party && f.party !== OPERATOR_NAMES[f.platform] ? f.party : OPERATOR_NAMES[p] }); }}>
            {PLATFORMS.map((p) => <option key={p} value={p}>{mT(`platform.${p}`)}</option>)}
          </SelectField></label>
        <label className={controls.field}><span className={controls.label}>{mT('chParty')}</span>
          <input className={controls.input} value={f.party} onChange={(e) => set({ party: e.target.value })} /></label>
        <label className={controls.field}><span className={controls.label}>{mT('chTan')}</span>
          <input className={controls.input} value={f.tan} onChange={(e) => set({ tan: e.target.value.toUpperCase() })} maxLength={10} /></label>
        <label className={controls.field}><span className={controls.label}>{mT('chGodown')}</span>
          <SelectField className={controls.select} value={f.godown} onChange={(e) => set({ godown: e.target.value })}>
            <option value="">{mT('defaultGodown')}</option>
            {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </SelectField></label>
        <label className={controls.field}><span className={controls.label}>{mT('chDamaged')}</span>
          <SelectField className={controls.select} value={f.damaged} onChange={(e) => set({ damaged: e.target.value })}>
            <option value="">{mT('none')}</option>
            {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </SelectField></label>
        <label className={controls.field}><span className={controls.label}>{mT('chCycle')}</span>
          <input className={controls.input} inputMode="numeric" value={f.cycle} onChange={(e) => set({ cycle: e.target.value })} /></label>
        <label className={controls.field}><span className={controls.label}>{mT('chFeePct')}</span>
          <input className={controls.input} inputMode="decimal" value={f.feePct} onChange={(e) => set({ feePct: e.target.value })} /></label>
        <label className={controls.field}><span className={controls.label}>{mT('chWindow')}</span>
          <input className={controls.input} inputMode="numeric" value={f.window} onChange={(e) => set({ window: e.target.value })} /></label>
      </div>
      <label className={controls.field}><span className={controls.label}>{mT('chGstins')}</span>
        <textarea className={`${controls.textarea} ${styles.textarea}`} value={f.gstins} onChange={(e) => set({ gstins: e.target.value })} data-mkt-ch-gstins />
        <span className={controls.hint}>{mT('chGstinsHint')}</span></label>
      {f.gstins.trim() && [...check.errors.filter((e) => !e.startsWith('Give')), ...check.notes].map((m) => <p key={m} className={styles.warn}>{m}</p>)}
      <div className={styles.toolbar}>
        <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} onClick={save} data-mkt-ch-save>{mT('save')}</button>
        {f.id && <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={() => setF(blank())}>{mT('cancel')}</button>}
      </div>
    </div>
  );
}
