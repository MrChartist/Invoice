import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { TemplateEngine } from '../templates/TemplateEngine';
import { DEFAULT_TEMPLATE_ID, templateById } from '../templates/registry';
import {
  BRAND_SWATCHES,
  DATE_FORMATS,
  DEFAULT_DESIGN,
  FONT_OPTIONS,
  MR_CHARTIST_ORANGE,
  WATERMARK_AUTO,
  WATERMARK_NONE,
  applyPreset,
  formatDatePref,
  paperSize,
  presets,
  sanitizeHex,
  type DateFormat,
  type DesignPrefs,
  type Density,
  type LogoPosition,
  type LogoSize,
  type NumberFormat,
  type PaperKind,
  type ShowColumns,
} from '../../lib/design-prefs';
import { calculateInvoice } from '../../lib/invoice-calc';
import { cn } from '../../lib/utils';
import type { InvoiceRecord, SenderProfile } from '../../types/invoice';
import { SAMPLE_SENDER, buildSampleInvoice } from './sample';
import controls from '../../styles/controls.module.css';
import styles from './DesignPanel.module.css';

export interface DesignPanelProps {
  /** Sender profile id this design belongs to (GLOBAL_PROFILE_ID for the default). */
  profileId: string;
  value: DesignPrefs;
  onChange: (next: DesignPrefs) => void;
  /** Accent of the currently chosen template — shown as the "Template" swatch. */
  accent?: string;
  /** Template used by the live preview. */
  templateId?: string;
  /** Replace the sample document, e.g. with the invoice being edited. */
  previewInvoice?: InvoiceRecord;
  previewSender?: SenderProfile;
  /** Called by the Reset button instead of resetting to defaults locally. */
  onReset?: () => void;
  className?: string;
}

interface SegProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}

function Seg<T extends string>({ label, value, options, onChange }: SegProps<T>) {
  const id = useId();
  return (
    <div className={controls.field}>
      <span className={controls.label} id={id}>
        {label}
      </span>
      <div className={styles.segScroll}>
        <div className={controls.segment} role="radiogroup" aria-labelledby={id}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={value === o.value}
              className={value === o.value ? controls.segmentBtnActive : controls.segmentBtn}
              onClick={() => onChange(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className={controls.check}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}

const COLUMN_LABELS: [keyof ShowColumns, string][] = [
  ['hsn', 'HSN / SAC'],
  ['unit', 'Unit'],
  ['discount', 'Discount'],
  ['tax_rate', 'GST rate'],
  ['taxable', 'Taxable value'],
];

/** Live mini-preview: renders the paper at its real size, scaled to fit the column. */
function LivePreview({
  design,
  templateId,
  invoice,
  sender,
}: {
  design: DesignPrefs;
  templateId: string;
  invoice: InvoiceRecord;
  sender: SenderProfile;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const [paperHeight, setPaperHeight] = useState(0);
  const size = paperSize(design);
  const totals = useMemo(
    () =>
      calculateInvoice({
        items: invoice.items,
        gst_mode: invoice.gst_mode,
        discount_type: invoice.discount_type,
        discount_rate: invoice.discount_rate,
        tax_rate: invoice.tax_rate,
        shipping: invoice.shipping,
        other_charges: invoice.other_charges,
        round_off_enabled: invoice.round_off_enabled,
        amount_paid: invoice.amount_paid,
      }),
    [invoice],
  );

  useEffect(() => {
    const stage = stageRef.current;
    const paper = paperRef.current;
    if (!stage || !paper || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      setStageWidth(stage.clientWidth);
      setPaperHeight(paper.offsetHeight);
    });
    ro.observe(stage);
    ro.observe(paper);
    setStageWidth(stage.clientWidth);
    setPaperHeight(paper.offsetHeight);
    return () => ro.disconnect();
  }, []);

  const scale = stageWidth > 0 ? Math.min(1, stageWidth / size.width) : 0.5;
  const height = Math.max(paperHeight, size.autoHeight ? 0 : size.height) * scale;

  return (
    <div ref={stageRef} className={styles.stage} style={{ height: height || undefined }} data-testid="design-preview">
      <div ref={paperRef} className={styles.scaler} style={{ transform: `scale(${scale})`, width: size.width }}>
        <TemplateEngine invoice={invoice} sender={sender} totals={totals} templateId={templateId} design={design} />
      </div>
    </div>
  );
}

/**
 * Controlled editor for one DesignPrefs row. The parent owns persistence
 * (see lib/design-prefs `saveDesign`), so it can debounce, confirm, or save
 * on explicit button press.
 */
export function DesignPanel({
  profileId,
  value,
  onChange,
  accent,
  templateId = DEFAULT_TEMPLATE_ID,
  previewInvoice,
  previewSender,
  onReset,
  className,
}: DesignPanelProps) {
  const uid = useId();
  const design = value.profile_id === profileId ? value : { ...value, profile_id: profileId };
  const meta = templateById(templateId);
  const templateAccent = accent ?? meta.accent;
  const set = (patch: Partial<DesignPrefs>) => onChange({ ...design, ...patch });
  const effectiveAccent = design.accent ?? templateAccent;
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [customWatermark, setCustomWatermark] = useState(
    design.watermark !== WATERMARK_NONE && design.watermark !== WATERMARK_AUTO ? design.watermark : '',
  );

  const sample = useMemo(() => previewInvoice ?? buildSampleInvoice(), [previewInvoice]);
  const sender = previewSender ?? SAMPLE_SENDER;
  const watermarkMode =
    design.watermark === WATERMARK_NONE ? 'none' : design.watermark === WATERMARK_AUTO ? 'auto' : 'custom';

  const commitHex = (raw: string) => {
    const hex = sanitizeHex(raw.startsWith('#') ? raw : `#${raw}`);
    if (hex) set({ accent: hex });
    setHexDraft(null);
  };

  const reset = () => {
    if (onReset) onReset();
    else onChange({ ...DEFAULT_DESIGN, profile_id: profileId });
    setCustomWatermark('');
  };

  return (
    <div className={cn(styles.root, className)}>
      <div className={styles.controls}>
        <Section title="Presets">
          <div className={styles.presets}>
            {presets.map((p) => (
              <button key={p.id} type="button" className={styles.preset} onClick={() => onChange(applyPreset(design, p.id))}>
                <span className={styles.presetName}>{p.name}</span>
                <span className={styles.presetDesc}>{p.description}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Colour & type">
          <div className={controls.field}>
            <span className={controls.label}>Accent colour</span>
            <div className={styles.swatches} role="group" aria-label="Accent colour">
              <button
                type="button"
                className={design.accent ? styles.swatchTemplate : cn(styles.swatchTemplate, styles.swatchActive)}
                style={{ background: templateAccent }}
                title={`Template default (${meta.name})`}
                aria-label={`Template default colour ${templateAccent}`}
                aria-pressed={!design.accent}
                onClick={() => set({ accent: undefined })}
              />
              {BRAND_SWATCHES.map((s) => (
                <button
                  key={s.hex}
                  type="button"
                  className={design.accent === s.hex ? styles.swatchActive : styles.swatch}
                  style={{ background: s.hex }}
                  title={s.name}
                  aria-label={`${s.name} ${s.hex}`}
                  aria-pressed={design.accent === s.hex}
                  onClick={() => set({ accent: s.hex })}
                />
              ))}
              <input
                type="color"
                className={styles.colorInput}
                value={sanitizeHex(effectiveAccent) ?? MR_CHARTIST_ORANGE}
                onChange={(e) => set({ accent: e.target.value })}
                aria-label="Custom accent colour"
              />
              <input
                className={cn(controls.input, controls.inputMono, styles.hexInput)}
                value={hexDraft ?? effectiveAccent}
                maxLength={7}
                onChange={(e) => setHexDraft(e.target.value)}
                onBlur={(e) => commitHex(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && commitHex(hexDraft ?? effectiveAccent)}
                aria-label="Accent hex code"
                spellCheck={false}
              />
            </div>
          </div>

          <div className={controls.field}>
            <span className={controls.label}>Font</span>
            <div className={styles.segScroll}>
              <div className={controls.segment} role="radiogroup" aria-label="Font">
                <button
                  type="button"
                  role="radio"
                  aria-checked={!design.font}
                  className={!design.font ? controls.segmentBtnActive : controls.segmentBtn}
                  onClick={() => set({ font: undefined })}
                >
                  Template
                </button>
                {FONT_OPTIONS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="radio"
                    aria-checked={design.font === f.id}
                    className={design.font === f.id ? controls.segmentBtnActive : controls.segmentBtn}
                    style={{ fontFamily: f.css }}
                    onClick={() => set({ font: f.id })}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Section>

        <Section title="Page">
          <div className={styles.grid2}>
            <Seg<PaperKind>
              label="Paper"
              value={design.paper}
              options={[
                { value: 'A4', label: 'A4' },
                { value: 'A5', label: 'A5' },
                { value: 'thermal80', label: '80 mm receipt' },
              ]}
              onChange={(paper) => set({ paper })}
            />
            <Seg<Density>
              label="Density"
              value={design.density}
              options={[
                { value: 'compact', label: 'Compact' },
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'spacious', label: 'Spacious' },
              ]}
              onChange={(density) => set({ density })}
            />
            <Seg<LogoPosition>
              label="Logo position"
              value={design.logo_position}
              options={[
                { value: 'auto', label: 'Template' },
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Centre' },
                { value: 'right', label: 'Right' },
              ]}
              onChange={(logo_position) => set({ logo_position })}
            />
            <Seg<LogoSize>
              label="Logo size"
              value={design.logo_size}
              options={[
                { value: 's', label: 'Small' },
                { value: 'm', label: 'Medium' },
                { value: 'l', label: 'Large' },
              ]}
              onChange={(logo_size) => set({ logo_size })}
            />
          </div>
        </Section>

        <Section title="Item columns">
          <div className={styles.checks}>
            {COLUMN_LABELS.map(([key, label]) => (
              <Check
                key={key}
                checked={design.show_columns[key]}
                onChange={(v) => set({ show_columns: { ...design.show_columns, [key]: v } })}
              >
                {label}
              </Check>
            ))}
          </div>
          <p className={controls.hint}>A column with no data (for example HSN when no item has one) stays hidden even when ticked.</p>
        </Section>

        <Section title="Sections">
          <div className={styles.checks}>
            <Check checked={design.show_bank} onChange={(v) => set({ show_bank: v })}>Bank details</Check>
            <Check checked={design.show_qr} onChange={(v) => set({ show_qr: v })}>UPI QR code</Check>
            <Check checked={design.show_signature} onChange={(v) => set({ show_signature: v })}>Signature</Check>
            <Check checked={design.show_terms} onChange={(v) => set({ show_terms: v })}>Terms</Check>
            <Check checked={design.show_amount_in_words} onChange={(v) => set({ show_amount_in_words: v })}>Amount in words</Check>
            <Check checked={design.show_place_of_supply} onChange={(v) => set({ show_place_of_supply: v })}>Place of supply</Check>
          </div>
        </Section>

        <Section title="Watermark & notes">
          <div className={styles.grid2}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor={`${uid}-wm`}>Watermark</label>
              <select
                id={`${uid}-wm`}
                className={controls.select}
                value={watermarkMode}
                onChange={(e) => {
                  const mode = e.target.value;
                  if (mode === 'none') set({ watermark: WATERMARK_NONE });
                  else if (mode === 'auto') set({ watermark: WATERMARK_AUTO });
                  else set({ watermark: customWatermark.trim() || 'SAMPLE' });
                }}
              >
                <option value="none">None</option>
                <option value="auto">Status stamp (Paid / Overdue / Cancelled / Draft)</option>
                <option value="custom">Custom text</option>
              </select>
            </div>
            {watermarkMode === 'custom' && (
              <div className={controls.field}>
                <label className={controls.label} htmlFor={`${uid}-wmt`}>Watermark text</label>
                <input
                  id={`${uid}-wmt`}
                  className={controls.input}
                  value={design.watermark}
                  maxLength={40}
                  onChange={(e) => {
                    setCustomWatermark(e.target.value);
                    set({ watermark: e.target.value });
                  }}
                />
              </div>
            )}
            <div className={controls.field}>
              <label className={controls.label} htmlFor={`${uid}-hn`}>Header note</label>
              <input
                id={`${uid}-hn`}
                className={controls.input}
                value={design.header_note}
                maxLength={160}
                placeholder="e.g. Original for recipient"
                onChange={(e) => set({ header_note: e.target.value })}
              />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor={`${uid}-ft`}>Footer text</label>
              <input
                id={`${uid}-ft`}
                className={controls.input}
                value={design.footer_text}
                maxLength={200}
                placeholder="e.g. Thank you for your business"
                onChange={(e) => set({ footer_text: e.target.value })}
              />
            </div>
          </div>
        </Section>

        <Section title="Formats">
          <div className={styles.grid2}>
            <Seg<NumberFormat>
              label="Number grouping"
              value={design.number_format}
              options={[
                { value: 'indian', label: '12,34,567' },
                { value: 'international', label: '1,234,567' },
              ]}
              onChange={(number_format) => set({ number_format })}
            />
            <div className={controls.field}>
              <label className={controls.label} htmlFor={`${uid}-df`}>Date format</label>
              <select
                id={`${uid}-df`}
                className={controls.select}
                value={design.date_format}
                onChange={(e) => set({ date_format: e.target.value as DateFormat })}
              >
                {DATE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f} — {formatDatePref('2026-04-05', f)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Section>

        <div className={styles.footerRow}>
          <span className={styles.saved}>Changes apply to the preview instantly; save to keep them.</span>
          <button type="button" className={cn(controls.btn, controls.btnOutline)} onClick={reset}>
            <RotateCcw size={14} aria-hidden="true" /> Reset to defaults
          </button>
        </div>
      </div>

      <aside className={styles.previewCol} aria-label="Live preview">
        <div className={styles.previewCard}>
          <div className={styles.previewHead}>
            <span>Live preview</span>
            <span>
              {meta.name} · {paperSize(design).label}
            </span>
          </div>
          <LivePreview design={design} templateId={templateId} invoice={sample} sender={sender} />
        </div>
      </aside>
    </div>
  );
}
