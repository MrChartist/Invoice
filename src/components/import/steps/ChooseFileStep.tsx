import { useRef, type Dispatch, type DragEvent } from 'react';
import { AlertTriangle, BookOpen, Boxes, Download, FileStack, Package, ReceiptText, Truck, Upload, Users } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { writeCsv } from '../../../lib/csv';
import { KIND_LABELS, TB_TEMPLATE_FILE, isBooksKind, templateFileName, templateRows, trialBalanceTemplateRows, type ImportKind } from '../../../lib/import-mapping';
import { can } from '../../../lib/access';
import { useT } from '../../../i18n';
import { vtT } from '../../../i18n/areas/voucher-types';
import { download } from '../download';
import type { WizardAction, WizardState } from '../wizard-state';
import ctl from '../../../styles/controls.module.css';
import styles from '../ImportWizard.module.css';

const KIND_META: Record<ImportKind, { icon: typeof Users; text: string }> = {
  clients: { icon: Users, text: 'Customers and parties with GSTIN, state and contact details.' },
  items: { icon: Package, text: 'Products and services with HSN/SAC, rate and GST %.' },
  invoices: { icon: ReceiptText, text: 'Past invoices and outstanding balances, keeping their numbers and amounts.' },
  // P1-21 (7Q): books kinds (owner only — one undo copy is taken first).
  ledgers: { icon: BookOpen, text: '' },
  vendors: { icon: Truck, text: '' },
  stock: { icon: Boxes, text: '' },
  vouchers: { icon: FileStack, text: '' },
};
const BOOKS_TEXT = { ledgers: 'kLedgersText', vendors: 'kVendorsText', stock: 'kStockText', vouchers: 'kVouchersText' } as const;
const BOOKS_LABEL = { ledgers: 'kLedgers', vendors: 'kVendors', stock: 'kStock', vouchers: 'kVouchers' } as const;
/** Kinds this user may import (books kinds rewrite the books like a restore: owner only). */
const kindsFor = () => (Object.keys(KIND_LABELS) as ImportKind[]).filter((k) => !isBooksKind(k) || can('data.restore'));
const kindLabel = (k: ImportKind) => (isBooksKind(k) ? vtT(BOOKS_LABEL[k]) : KIND_LABELS[k]);
const kindText = (k: ImportKind) => (isBooksKind(k) ? vtT(BOOKS_TEXT[k]) : KIND_META[k].text);

interface Props {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  onLoadFile: (file: File | undefined) => void;
  onLoadText: (text: string, name: string) => void;
}

/** Step 1: what is being imported, and the file (or pasted rows). */
export function ChooseFileStep({ state, dispatch, onLoadFile, onLoadText }: Props) {
  useT();
  const { kind, table, fileName, delimiterLabel, dragging, pasteOpen, pasted, loadError } = state;
  const fileRef = useRef<HTMLInputElement>(null);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dispatch({ type: 'setDragging', dragging: false });
    onLoadFile(e.dataTransfer.files?.[0]);
  };

  return (
    <div className={styles.stack}>
      <fieldset className={styles.kindSet}>
        <legend className={ctl.label}>What are you importing?</legend>
        <div className={styles.kindGrid}>
          {kindsFor().map((k) => {
            const Icon = KIND_META[k].icon;
            return (
              <label key={k} className={cn(styles.kindCard, kind === k && styles.kindCardOn)}>
                <input
                  type="radio"
                  name="import-kind"
                  className={styles.srOnly}
                  checked={kind === k}
                  onChange={() => dispatch({ type: 'setKind', kind: k })}
                />
                <Icon size={20} aria-hidden />
                <strong>{kindLabel(k)}</strong>
                <span>{kindText(k)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div
        className={cn(styles.drop, dragging && styles.dropOn)}
        onDragOver={(e) => {
          e.preventDefault();
          dispatch({ type: 'setDragging', dragging: true });
        }}
        onDragLeave={() => dispatch({ type: 'setDragging', dragging: false })}
        onDrop={onDrop}
      >
        <Upload size={26} aria-hidden />
        <p className={styles.dropTitle}>{table ? fileName : 'Drop a CSV file here'}</p>
        <p className={ctl.hint}>
          {table
            ? `${table.rows.length.toLocaleString('en-IN')} data rows · ${table.headers.length} columns · ${delimiterLabel}-separated`
            : 'CSV, TSV or TXT exported from Excel, Vyapar, Zoho Books, Tally or Busy. Excel .xlsx works too (first sheet).'}
        </p>
        <div className={styles.dropActions}>
          <button type="button" className={cn(ctl.btn, ctl.btnPrimary)} onClick={() => fileRef.current?.click()}>
            {table ? 'Choose a different file' : 'Choose file'}
          </button>
          <button type="button" className={cn(ctl.btn, ctl.btnGhost)} onClick={() => dispatch({ type: 'setPasteOpen', open: !pasteOpen })} aria-expanded={pasteOpen}>
            Paste instead
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xlsm,text/csv,text/plain,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className={styles.srOnly}
          aria-label="Choose a CSV file"
          onChange={(e) => {
            onLoadFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {pasteOpen && (
        <div className={ctl.field}>
          <label className={ctl.label} htmlFor="import-paste">
            Paste rows (with a header line)
          </label>
          <textarea
            id="import-paste"
            className={cn(ctl.input, ctl.textarea, styles.paste)}
            value={pasted}
            onChange={(e) => dispatch({ type: 'setPasted', text: e.target.value })}
            placeholder={'Name,GSTIN,City\nAcme Traders,27AAPFU0939F1ZV,Mumbai'}
            rows={5}
          />
          <div>
            <button type="button" className={cn(ctl.btn, ctl.btnOutline, ctl.btnSm)} disabled={!pasted.trim()} onClick={() => onLoadText(pasted, 'Pasted data')}>
              Use pasted data
            </button>
          </div>
        </div>
      )}

      {loadError && (
        <p className={ctl.error} role="alert">
          <AlertTriangle size={14} /> {loadError}
        </p>
      )}

      <div className={styles.templates}>
        <span className={ctl.hint}>Starting from scratch? Download a ready-made template:</span>
        {kindsFor().map((k) => (
          <button
            key={k}
            type="button"
            className={cn(ctl.btn, ctl.btnGhost, ctl.btnSm)}
            onClick={() => download(templateFileName(k), writeCsv(templateRows(k), { bom: true }))}
          >
            <Download size={14} /> {kindLabel(k)}
          </button>
        ))}
        {can('data.restore') && (
          <button type="button" className={cn(ctl.btn, ctl.btnGhost, ctl.btnSm)} onClick={() => download(TB_TEMPLATE_FILE, writeCsv(trialBalanceTemplateRows(), { bom: true }))} data-testid="import-tb-template">
            <Download size={14} /> {vtT('tbTemplate')}
          </button>
        )}
      </div>
    </div>
  );
}
