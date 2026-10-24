import { useId, useState } from 'react';
import { Modal } from '../../ui/Modal';
import { BLOCK_DEFAULT_ACCOUNT, saveAsset, validateAsset, type Account, type FixedAsset, type FixedAssetInput } from '../../../lib/ledger';
import { DEPRECIATION_BLOCK_LABELS, depreciationRate, type DepreciationBlock } from '../../../lib/tax-rules';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';
import styles from './ledger.module.css';

interface Props {
  accounts: Account[];
  asset: FixedAsset | null;
  defaultDate: string;
  onClose: () => void;
  onSaved: (a: FixedAsset) => void;
}

const BLOCKS = Object.keys(DEPRECIATION_BLOCK_LABELS) as DepreciationBlock[];
const PAY_GROUPS = new Set(['CASH_BANK', 'TRADE_PAYABLES', 'LOANS_LT', 'LOANS_ST', 'CAPITAL']);

export function AssetModal({ accounts, asset, defaultDate, onClose, onSaved }: Props) {
  const uid = useId();
  const [form, setForm] = useState({
    name: asset?.name ?? '',
    block: asset?.block ?? ('COMPUTER' as DepreciationBlock),
    account_id: asset?.account_id ?? BLOCK_DEFAULT_ACCOUNT.COMPUTER,
    cost: asset ? String(asset.cost) : '',
    acquired_on: asset?.acquired_on ?? defaultDate,
    put_to_use: asset?.put_to_use ?? defaultDate,
    paid_from: asset?.paid_from ?? 'bank',
    party: asset?.party ?? '',
  });
  const [error, setError] = useState('');
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  const fixedAccounts = accounts.filter((a) => a.group === 'FIXED_ASSETS' && a.id !== 'acc_dep');
  const payAccounts = accounts.filter((a) => PAY_GROUPS.has(a.group));

  const save = () => {
    const input: FixedAssetInput = { ...form, id: asset?.id, cost: Number(form.cost) };
    const errors = validateAsset(input);
    if (errors.length) return setError(errors[0]);
    try {
      onSaved(saveAsset(input));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={asset ? `Edit ${asset.name}` : 'Add a fixed asset'}
      subtitle="Depreciation uses Income-tax Act WDV block rates; half the rate in the first year if used for fewer than 180 days. Verify with your CA."
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>Cancel</button>
          <button type="button" className={controls.btnPrimary} onClick={save}>Save asset</button>
        </>
      }
    >
      <div className={books.stack}>
        <div className={styles.formGrid}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-name`}>Asset</label>
            <input id={`${uid}-name`} className={controls.input} value={form.name} placeholder="e.g. Laptop" onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-block`}>Block (rate)</label>
            <select
              id={`${uid}-block`}
              className={controls.select}
              value={form.block}
              onChange={(e) => {
                const block = e.target.value as DepreciationBlock;
                set({ block, account_id: BLOCK_DEFAULT_ACCOUNT[block] });
              }}
            >
              {BLOCKS.map((b) => (
                <option key={b} value={b}>{DEPRECIATION_BLOCK_LABELS[b]} — {depreciationRate(b, form.put_to_use)}%</option>
              ))}
            </select>
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-acct`}>Asset account</label>
            <select id={`${uid}-acct`} className={controls.select} value={form.account_id} onChange={(e) => set({ account_id: e.target.value })}>
              {fixedAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </select>
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-cost`}>Cost ₹ (excl. GST credit)</label>
            <input id={`${uid}-cost`} className={`${controls.input} ${books.numInput}`} inputMode="decimal" type="number" step="0.01" value={form.cost} onChange={(e) => set({ cost: e.target.value })} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-bought`}>Bought on</label>
            <input id={`${uid}-bought`} type="date" className={controls.input} value={form.acquired_on} onChange={(e) => set({ acquired_on: e.target.value })} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-use`}>Put to use on</label>
            <input id={`${uid}-use`} type="date" className={controls.input} value={form.put_to_use} onChange={(e) => set({ put_to_use: e.target.value })} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-paid`}>Paid from</label>
            <select id={`${uid}-paid`} className={controls.select} value={form.paid_from} onChange={(e) => set({ paid_from: e.target.value })}>
              <option value="">Already in the books (no entry)</option>
              {payAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </select>
          </div>
          {form.paid_from === 'creditors' && (
            <div className={controls.field}>
              <label className={controls.label} htmlFor={`${uid}-party`}>Supplier</label>
              <input id={`${uid}-party`} className={controls.input} value={form.party} onChange={(e) => set({ party: e.target.value })} />
            </div>
          )}
        </div>
        <p className={controls.hint}>
          Do not also enter this purchase as a bill — a bill posts to Purchases / expenses. GST credit on capital goods can be recorded with a
          journal (Dr Input IGST/CGST/SGST, Cr the supplier).
        </p>
        {error && <div className={controls.error} role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
