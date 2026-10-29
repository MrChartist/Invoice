import { lazy, Suspense, useId, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { gstRateOptions } from '../../lib/tax-rules';
import { cleanAltUnits, compoundUnits, unitSymbols, unitsDb, validateAltUnits } from '../../lib/units';
import { stockCategoriesDb, stockGroupsDb, treeRows } from '../../lib/stock-groups';
import { cleanPriceList, validatePriceList } from '../../lib/stock-query';
import { MastersFields, type MastersDraft } from './ItemMastersFields';
import { num } from '../../lib/invoice-calc';
import { hsnCompatible, type StockItem } from '../../lib/inventory';
import { duplicateSerials, parseSerials } from '../../lib/stock-tracking';
import { useT } from '../../i18n';
import { invT } from '../../i18n/areas/inventory';
import controls from '../../styles/controls.module.css';
import styles from './inventory.module.css';
import { EditLogButton } from '../audit/EditLogButton';
import { catalogueEntryFor, setStockItemFields, setStockShortCode } from '../../lib/catalog';
import { CustomFieldInputs } from '../custom-fields/CustomFieldInputs';
import { cleanValueMap, customFieldsDb } from '../../lib/custom-fields';
import { retailT } from '../../i18n/areas/retail';
import { impliedPacks } from '../../lib/shop-mode';
import { localDb } from '../../lib/localDb';
import { errText, libMsg } from '../../i18n/lib-msg';

const LeadTimeRow = lazy(() => import('../mfg/LeadTimeRow')); // R13 MF-A4: lead / make days (shopfloor pack)
const PackSizeRow = lazy(() => import('../agri/PackSizeRow')); // R12 AG-C4: agri class, pack size, labelled (mill / agri pack)
const ServiceRecipeRow = lazy(() => import('../services-r10/ServiceRecipeRow')); // R10 SV-C4 (PENDING #21): products used per service

export interface ItemFormModalProps {
  open: boolean;
  /** Item being edited, or a blank item from `blankStockItem()` when adding. */
  item: StockItem | null;
  isNew: boolean;
  /** Names already used by other stock items (lower-cased) — blocks duplicates. */
  takenNames: string[];
  onSave: (item: StockItem) => void;
  onClose: () => void;
}

interface Draft {
  name: string; sku: string; barcode: string; hsn: string; unit: string; track_stock: boolean;
  opening_qty: string; opening_rate: string; reorder_level: string;
  sale_rate: string; tax_rate: string; location: string;
  track_batches: boolean; track_serials: boolean; warranty_months: string; opening_serials: string;
  /** R8-B (TR-B1): bags / weight sub-row on lines. */
  sold_by_weight_bags: boolean;
  /** WP-8 masters: group / category, alternate units, price lists. */
  masters: MastersDraft;
}

function toDraft(i: StockItem): Draft {
  return {
    name: i.name, sku: i.sku ?? '', barcode: i.barcode ?? '', hsn: i.hsn ?? '', unit: i.unit || 'NOS', track_stock: i.track_stock,
    opening_qty: String(i.opening_qty || ''), opening_rate: String(i.opening_rate || ''),
    reorder_level: String(i.reorder_level || ''), sale_rate: i.sale_rate ? String(i.sale_rate) : '',
    tax_rate: i.tax_rate !== undefined ? String(i.tax_rate) : '', location: i.location ?? '',
    track_batches: !!i.track_batches, track_serials: !!i.track_serials, sold_by_weight_bags: !!i.sold_by_weight_bags,
    warranty_months: i.warranty_months ? String(i.warranty_months) : '', opening_serials: (i.opening_serials ?? []).join('\n'),
    masters: {
      group_id: i.group_id ?? '', category_id: i.category_id ?? '',
      alt: (i.alt_units ?? []).map((a) => ({ unit: a.unit, factor: String(a.factor) })),
      costs: (i.standard_costs ?? []).map((e) => ({ from: e.from, rate: String(e.rate) })),
      prices: (i.selling_prices ?? []).map((e) => ({ from: e.from, rate: String(e.rate) })),
      qc: !!i.qc_on_receipt, // R4-A4
    },
  };
}

/** Mounts the form fresh each time it opens, so drafts never leak between items. */
export function ItemFormModal(props: ItemFormModalProps) {
  if (!props.open || !props.item) return null;
  return <ItemForm key={props.item.id} {...props} item={props.item} />;
}

function ItemForm({ open, item, isNew, takenNames, onSave, onClose }: ItemFormModalProps & { item: StockItem }) {
  useT(); // re-render on a language switch (5.4)
  const [d, setD] = useState<Draft>(() => toDraft(item));
  const [weighOn] = useState(() => impliedPacks(localDb.settings.get()).some((p) => p === 'commodity' || p === 'agency') || !!item.sold_by_weight_bags); // R8-B
  const [touched, setTouched] = useState(false);
  // R12 AG-C4: agri class / pack size / labelled, shown with the mill or agri pack (or when already set on the item).
  const [ag, setAg] = useState<Pick<StockItem, 'ag_class' | 'ag_pack_kg' | 'ag_labelled'>>(() => ({ ag_class: item.ag_class, ag_pack_kg: item.ag_pack_kg, ag_labelled: item.ag_labelled }));
  const [lead, setLead] = useState<Pick<StockItem, 'lead_days' | 'make_days'>>(() => ({ lead_days: item.lead_days, make_days: item.make_days })); // R13 MF-A4
  const [mfOn] = useState(() => impliedPacks(localDb.settings.get()).includes('shopfloor') || item.lead_days !== undefined || item.make_days !== undefined);
  const [agOn] = useState(() => impliedPacks(localDb.settings.get()).some((p) => p === 'mill' || p === 'agri') || !!(item.ag_class || item.ag_pack_kg));
  // R10 SV-C4 (PENDING #21): products used per service, with a services pack (or an item already a kit).
  const [svOn] = useState(() => impliedPacks(localDb.settings.get()).some((p) => p === 'salon' || p === 'fitness' || p === 'clinic' || p === 'workshop') || !!item.kit);
  const [recipe, setRecipe] = useState<{ lines: unknown[]; problem: string; commit: (itemId: string) => void } | null>(null);
  const uid = useId();
  // QA-3 F24: the counter short code lives on the catalogue entry of the same name; it is edited here too.
  const [shortCode, setShortCode] = useState(() => catalogueEntryFor(item.name)?.short_code ?? '');
  const [shortError, setShortError] = useState('');
  // 6.23 (PENDING #25): item custom fields live on the catalogue entry of the same name, edited here too.
  const [itemFields, setItemFields] = useState(() => catalogueEntryFor(item.name)?.custom_fields);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const name = d.name.trim();
  const dup = takenNames.includes(name.toLowerCase());
  const nameError = !name ? invT('errName') : dup ? invT('errDupName') : '';
  const negative = [d.opening_qty, d.opening_rate, d.reorder_level, d.sale_rate].some((v) => num(v) < 0);
  const taxBad = d.tax_rate !== '' && (num(d.tax_rate) < 0 || num(d.tax_rate) > 100);
  const openingSerials = d.track_stock && d.track_serials ? parseSerials(d.opening_serials) : [];
  const dupSerials = duplicateSerials(openingSerials);
  const serialError = !d.track_stock || !d.track_serials ? ''
    : dupSerials.length ? invT('errSerialTwice', { serial: dupSerials[0] })
    : openingSerials.length && openingSerials.length !== num(d.opening_qty) ? invT('errOpeningSerials', { listed: openingSerials.length, qty: num(d.opening_qty) })
    : '';
  // WP-8 masters: lists read once per form; alternate units never apply to serial-tracked items.
  const masters = useMemo(() => {
    const stored = unitsDb.stored();
    return { units: unitSymbols(stored, item.unit), compounds: compoundUnits(stored), groups: treeRows(stockGroupsDb.all()), categories: treeRows(stockCategoriesDb.all()) };
  }, [item.unit]);
  const serialItem = d.track_stock && d.track_serials;
  const altList = serialItem ? [] : d.masters.alt.map((a) => ({ unit: a.unit, factor: num(a.factor) }));
  const mastersError = validateAltUnits(altList, d.unit) || validatePriceList(d.masters.costs) || validatePriceList(d.masters.prices);
  const valid = !nameError && !negative && !taxBad && !serialError && !mastersError && num(d.warranty_months) >= 0 && !recipe?.problem;

  const submit = () => {
    setTouched(true);
    if (!valid) return;
    const sc = setStockShortCode({ name, hsn: d.hsn, unit: d.unit, sale_rate: d.sale_rate === '' ? undefined : num(d.sale_rate), tax_rate: d.tax_rate === '' ? undefined : num(d.tax_rate) }, shortCode);
    if (!sc.ok) return setShortError(libMsg(sc.error.message));
    try {
      setStockItemFields({ name, hsn: d.hsn, unit: d.unit, sale_rate: d.sale_rate === '' ? undefined : num(d.sale_rate), tax_rate: d.tax_rate === '' ? undefined : num(d.tax_rate) }, cleanValueMap(itemFields, customFieldsDb.all()));
    } catch (err) {
      return setShortError(errText(err));
    }
    onSave({
      ...item,
      name,
      sku: d.sku.trim() || undefined,
      barcode: d.barcode.trim() || undefined,
      hsn: d.hsn.trim() || undefined,
      unit: d.unit,
      track_stock: d.track_stock,
      opening_qty: num(d.opening_qty),
      opening_rate: num(d.opening_rate),
      reorder_level: num(d.reorder_level),
      sale_rate: d.sale_rate === '' ? undefined : num(d.sale_rate),
      tax_rate: d.tax_rate === '' ? undefined : num(d.tax_rate),
      location: d.location.trim() || undefined,
      // Opt-in tracking: stored only when on, so simple items keep their exact shape.
      track_batches: d.track_stock && d.track_batches ? true : undefined,
      track_serials: d.track_stock && d.track_serials ? true : undefined,
      warranty_months: d.track_stock && d.track_serials && num(d.warranty_months) > 0 ? Math.round(num(d.warranty_months)) : undefined,
      opening_serials: openingSerials.length ? openingSerials : undefined,
      // WP-8 masters: stored only when set, so plain items keep their exact shape.
      group_id: d.masters.group_id || undefined,
      category_id: d.masters.category_id || undefined,
      alt_units: d.track_stock ? cleanAltUnits(altList, d.unit) : undefined,
      standard_costs: cleanPriceList(d.masters.costs.map((e) => ({ from: e.from, rate: e.rate === '' ? undefined : num(e.rate) }))),
      selling_prices: cleanPriceList(d.masters.prices.map((e) => ({ from: e.from, rate: e.rate === '' ? undefined : num(e.rate) }))),
      qc_on_receipt: d.track_stock && d.masters.qc ? true : undefined, // R4-A4
      sold_by_weight_bags: d.sold_by_weight_bags || undefined, // R8-B
      ...(mfOn ? { lead_days: lead.lead_days, make_days: lead.make_days } : {}), // R13 MF-A4
      ...(agOn ? { ag_class: ag.ag_class || undefined, ag_pack_kg: ag.ag_pack_kg && ag.ag_pack_kg > 0 ? ag.ag_pack_kg : undefined, ag_labelled: ag.ag_labelled || undefined } : {}), // R12 AG-C4
      // R10 SV-C4: a service with products used is a kit (not stock itself); an emptied list switches the kit off.
      ...(recipe ? (recipe.lines.length ? { kit: true, track_stock: false } : { kit: undefined }) : {}),
    });
    if (recipe?.lines.length) {
      try {
        recipe.commit(item.id);
      } catch (err) {
        window.alert(errText(err));
      }
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={isNew ? invT('addStockItem') : invT('editStockItem')}
      subtitle={invT('itemSub')}
      footer={
        <>
          {!isNew && <EditLogButton recordId={item.id} name={item.name} />}
          <button type="button" className={controls.btnOutline} onClick={onClose}>{invT('cancel')}</button>
          <button type="button" className={controls.btnPrimary} onClick={submit}>
            {isNew ? invT('addItem') : invT('saveChanges')}
          </button>
        </>
      }
    >
      <form className={styles.form} onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <div className={controls.field}>
          <label className={controls.label} htmlFor={`${uid}-name`}>{invT('itemName')}</label>
          <input
            id={`${uid}-name`}
            className={`${controls.input} ${touched && nameError ? controls.inputInvalid : ''}`}
            value={d.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder={invT('itemNamePh')}
            aria-invalid={touched && !!nameError}
            autoComplete="off"
          />
          {touched && nameError && <span className={controls.error} role="alert">{nameError}</span>}
          {!isNew && name && item.name.trim() && name.toLowerCase() !== item.name.trim().toLowerCase() && (
            <span className={controls.hint}>Documents saved as “{item.name.trim()}” stay linked: the old name is kept as an alias.</span>
          )}
        </div>

        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-sku`}>{invT('sku')}</label>
            <input id={`${uid}-sku`} className={controls.input} value={d.sku} onChange={(e) => set('sku', e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-barcode`}>{invT('barcode')}</label>
            <input id={`${uid}-barcode`} className={controls.input} value={d.barcode} onChange={(e) => set('barcode', e.target.value)} placeholder={invT('scanOrType')} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-short`}>{retailT('shortCode')}</label>
            <input id={`${uid}-short`} className={`${controls.input} ${controls.inputMono}`} value={shortCode} maxLength={12} onChange={(e) => { setShortCode(e.target.value.replace(/\s/g, '')); setShortError(''); }} placeholder={retailT('shortCodePh')} aria-invalid={!!shortError} data-stock-short-code />
            {shortError && <span className={controls.error} role="alert">{shortError}</span>}
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-hsn`}>{invT('hsn')}</label>
            <input
              id={`${uid}-hsn`} className={controls.input} inputMode="numeric" value={d.hsn}
              onChange={(e) => set('hsn', e.target.value.replace(/[^0-9]/g, '').slice(0, 8))}
            />
            {!isNew && !hsnCompatible(d.hsn, item.hsn) && (
              <span className={controls.hint} role="alert">Bills and invoices with HSN {item.hsn} will stop matching this item (its stock history detaches).</span>
            )}
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-unit`}>{invT('unit')}</label>
            <select id={`${uid}-unit`} className={controls.select} value={d.unit} onChange={(e) => set('unit', e.target.value)}>
              {masters.units.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>

        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-sale`}>{invT('saleRate')}</label>
            <input id={`${uid}-sale`} className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={d.sale_rate} onChange={(e) => set('sale_rate', e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-gst`}>{invT('gstPct')}</label>
            <input
              id={`${uid}-gst`} className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal"
              list={`${uid}-slabs`} value={d.tax_rate} onChange={(e) => set('tax_rate', e.target.value)}
              aria-invalid={taxBad}
            />
            <datalist id={`${uid}-slabs`}>{gstRateOptions().map((s) => <option key={s} value={s} />)}</datalist>
            {taxBad && <span className={controls.error} role="alert">{invT('errGst')}</span>}
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-loc`}>{invT('location')}</label>
            <input id={`${uid}-loc`} className={controls.input} value={d.location} onChange={(e) => set('location', e.target.value)} placeholder={invT('locationPh')} />
          </div>
        </div>

        <label className={controls.check}>
          <input type="checkbox" checked={d.track_stock} onChange={(e) => set('track_stock', e.target.checked)} />
          {invT('trackStock')}
        </label>

        {d.track_stock && (
          <>
            <p className={styles.sectionLabel}>{invT('openingSection')}</p>
            <div className={controls.row3}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor={`${uid}-oq`}>{invT('openingQty')}</label>
                <input id={`${uid}-oq`} className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={d.opening_qty} onChange={(e) => set('opening_qty', e.target.value)} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor={`${uid}-or`}>{invT('openingRate')}</label>
                <input id={`${uid}-or`} className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={d.opening_rate} onChange={(e) => set('opening_rate', e.target.value)} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor={`${uid}-rl`}>{invT('reorderLevel')}</label>
                <input id={`${uid}-rl`} className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={d.reorder_level} onChange={(e) => set('reorder_level', e.target.value)} />
              </div>
            </div>
          </>
        )}
        {d.track_stock && (
          <>
            <p className={styles.sectionLabel}>{invT('trackingSection')}</p>
            <label className={controls.check}>
              <input type="checkbox" checked={d.track_batches} onChange={(e) => set('track_batches', e.target.checked)} />
              {invT('trackBatches')}
            </label>
            <label className={controls.check}>
              <input type="checkbox" checked={d.track_serials} onChange={(e) => set('track_serials', e.target.checked)} />
              {invT('trackSerials')}
            </label>
            {d.track_serials && (
              <div className={controls.row}>
                <div className={controls.field}>
                  <label className={controls.label} htmlFor={`${uid}-wm`}>{invT('warranty')}</label>
                  <input id={`${uid}-wm`} className={`${controls.input} ${controls.inputNumeric}`} inputMode="numeric" value={d.warranty_months} onChange={(e) => set('warranty_months', e.target.value.replace(/[^0-9]/g, ''))} placeholder={invT('warrantyPh')} />
                </div>
                {num(d.opening_qty) > 0 && (
                  <div className={controls.field}>
                    <label className={controls.label} htmlFor={`${uid}-os`}>{invT('openingSerials')}</label>
                    <textarea id={`${uid}-os`} className={controls.textarea} rows={3} value={d.opening_serials} onChange={(e) => set('opening_serials', e.target.value)} aria-invalid={touched && !!serialError} />
                  </div>
                )}
              </div>
            )}
            {touched && serialError && <span className={controls.error} role="alert">{serialError}</span>}
          </>
        )}
        {weighOn && <label className={controls.check}><input type="checkbox" checked={d.sold_by_weight_bags} onChange={(e) => set('sold_by_weight_bags', e.target.checked)} data-sold-by-weight /> {invT('soldByWeight')}</label>}
        {mfOn && d.track_stock && <Suspense fallback={null}><LeadTimeRow value={lead} onChange={setLead} /></Suspense>}
        {agOn && <Suspense fallback={null}><PackSizeRow value={ag} unit={d.unit} onChange={setAg} /></Suspense>}
        {svOn && <Suspense fallback={null}><ServiceRecipeRow item={item} onChange={setRecipe} /></Suspense>}
        {touched && recipe?.problem && <span className={controls.error} role="alert">{recipe.problem}</span>}
        <CustomFieldInputs scope="item" idPrefix={`${uid}-item`} value={itemFields} onChange={setItemFields} />
        <MastersFields
          draft={d.masters}
          onChange={(m) => set('masters', m)}
          baseUnit={d.unit}
          trackStock={d.track_stock}
          serialItem={serialItem}
          units={masters.units}
          compounds={masters.compounds}
          groups={masters.groups}
          categories={masters.categories}
        />
        {touched && mastersError && <span className={controls.error} role="alert">{libMsg(mastersError)}</span>}
        {touched && negative && <span className={controls.error} role="alert">{invT('errNegative')}</span>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
