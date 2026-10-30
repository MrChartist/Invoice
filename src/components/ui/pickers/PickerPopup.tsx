/**
 * The one lazy chunk of the pickers (docs/theme/IOS-UI.md, Pickers): the inline calendar (UIDatePicker .inline), the
 * range calendar with presets, the month grid, the time wheels and the list of a pop-up button. A regular-material
 * popover anchored to the field from 600px, the app's Modal bottom sheet on phones. Loaded on the first open only.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { dateLocale, getLanguage, useT } from '../../../i18n';
import { pkT } from '../../../i18n/areas/pickers';
import { isTopModal, pushModal } from '../../../lib/modal-stack';
import { addDays, addMonths, fyBounds, monthEnd } from '../../../lib/day-math';
import { dayOf, localDate } from '../../../lib/date-input';
import { Modal, PHONE_QUERY } from '../Modal';
import type { DateChip, DatePopupSpec, ListPopupSpec, PopupSpec, RangePreset, TimePopupSpec } from './types';
import s from './pickers.module.css';

/** Indian business weeks start on Monday (0 = Sunday … 6 = Saturday). */
export const WEEK_START = 1;

const isPhone = () => typeof matchMedia === 'function' && matchMedia(PHONE_QUERY).matches;
const todayIso = () => dayOf(new Date());
const pad = (n: number) => String(n).padStart(2, '0');
const ym = (y: number, m: number) => `${y}-${pad(m + 1)}`;
const stop = (e: SyntheticEvent) => e.stopPropagation();

export default function PickerPopup({ spec }: { spec: PopupSpec }) {
  useT();
  const [phone] = useState(isPhone);
  const close = (refocus = true) => spec.onClose(refocus);
  const title = spec.label || pkT(spec.kind === 'list' ? 'chooseOption' : spec.kind === 'time' ? 'chooseTime' : spec.kind === 'month' ? 'chooseMonth' : 'chooseDate');
  const body =
    spec.kind === 'list' ? <ListBody spec={spec} phone={phone} close={close} />
    : spec.kind === 'time' ? <TimeBody spec={spec} phone={phone} />
    : spec.kind === 'month' ? <MonthBody spec={spec} phone={phone} close={close} />
    : <DateBody spec={spec} phone={phone} close={close} />;
  if (phone) {
    const clear = spec.kind !== 'list' && spec.clearable && (spec.value || (spec.kind !== 'time' && spec.range && (spec.range.from || spec.range.to)));
    return (
      <Modal
        open
        onClose={() => close()}
        title={title}
        size="sm"
        detent={spec.kind === 'list' ? 'medium' : undefined}
        flush={spec.kind === 'list'}
        dialogProps={{ 'data-picker': spec.kind }}
        footer={
          <div className={s.sheetFoot}>
            {clear && (
              <button type="button" className="btn quiet" onClick={() => { if (spec.kind === 'date' && spec.range) spec.range.onRange('', ''); else spec.onPick(''); close(); }}>
                {pkT('clear')}
              </button>
            )}
            <button type="button" className="btn primary" onClick={() => close()}>{pkT('done')}</button>
          </div>
        }
      >
        <div onClick={stop} onKeyDown={stop} onMouseDown={stop} onPointerDown={stop}>{body}</div>
      </Modal>
    );
  }
  return <Popover spec={spec} title={title}>{body}</Popover>;
}

/* ── Popover (600px and up) ─────────────────────────────────────── */

function Popover({ spec, title, children }: { spec: PopupSpec; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' });
  const onClose = useRef(spec.onClose);
  useEffect(() => {
    onClose.current = spec.onClose;
  });

  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const a = spec.anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const gap = 6;
      const below = vh - a.bottom - gap;
      const top = below >= h || a.top < h + gap ? Math.min(a.bottom + gap, Math.max(8, vh - h - 8)) : a.top - gap - h;
      const left = Math.max(8, Math.min(a.left, vw - w - 8));
      setPos({ top, left, minWidth: spec.kind === 'list' ? a.width : undefined });
    };
    place();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (ref.current) ro?.observe(ref.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [spec.anchor, spec.kind]);

  useEffect(() => {
    const token = {};
    const unstack = pushModal(token);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !spec.anchor.contains(t)) onClose.current(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!isTopModal(token)) return;
      const inside = ref.current?.contains(document.activeElement);
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose.current(true);
      } else if (e.key === 'Tab' && inside) {
        e.preventDefault();
        onClose.current(true);
      }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      unstack();
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [spec.anchor]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      data-picker={spec.kind}
      className={cn('material', 'no-print', s.pop, spec.kind === 'list' && s.popList)}
      data-mat="regular"
      style={pos}
      // Keep the field's own handlers (rows, forms, Gateway keys) from seeing clicks and keys meant for the popup.
      onClick={stop}
      onKeyDown={stop}
      onMouseDown={stop}
      onPointerDown={stop}
    >
      {children}
    </div>,
    document.body,
  );
}

/* ── Calendar ───────────────────────────────────────────────────── */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions, key: string) {
  const loc = dateLocale(getLanguage());
  const k = `${loc}|${key}`;
  let f = fmtCache.get(k);
  if (!f) fmtCache.set(k, (f = new Intl.DateTimeFormat(loc, { ...opts, timeZone: 'UTC' })));
  return f;
}
const utc = (y: number, m: number, d = 1) => Date.UTC(y, m, d);
const monthTitle = (y: number, m: number) => fmt({ month: 'long', year: 'numeric' }, 'my').format(utc(y, m));
const monthShort = (m: number) => fmt({ month: 'short' }, 'm').format(utc(2026, m));
const longDay = (iso: string) => {
  const d = localDate(iso)!;
  return fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }, 'full').format(utc(d.getFullYear(), d.getMonth(), d.getDate()));
};
/** Weekday initials from WEEK_START (1 Jan 2024 was a Monday). */
const weekdays = () => Array.from({ length: 7 }, (_, i) => {
  const day = (WEEK_START + i) % 7;
  const at = utc(2023, 11, 31 + day); // 31 Dec 2023 was a Sunday
  return { short: fmt({ weekday: 'short' }, 'wd').format(at), long: fmt({ weekday: 'long' }, 'wdl').format(at) };
});

/** The 42 days (6 weeks) shown for month `m` of year `y`, starting on WEEK_START. */
function monthCells(y: number, m: number): string[] {
  const first = new Date(y, m, 1);
  const lead = (first.getDay() - WEEK_START + 7) % 7;
  return Array.from({ length: 42 }, (_, i) => dayOf(new Date(y, m, 1 - lead + i)));
}

function chipValue(c: DateChip, base: string): string {
  const today = todayIso();
  switch (c) {
    case 'today': return today;
    case 'yesterday': return addDays(today, -1);
    case 'tomorrow': return addDays(today, 1);
    case 'onReceipt': return base;
    case 'monthStart': return `${base.slice(0, 7)}-01`;
    case 'monthEnd': return monthEnd(base);
    case 'fyStart': return fyBounds(base).start;
    case 'fyEnd': return fyBounds(base).end;
    default: return addDays(base, Number(c));
  }
}
const chipLabel = (c: DateChip) => (c.startsWith('+') ? pkT('plusDays', { n: c.slice(1) }) : pkT(c as Exclude<DateChip, `+${string}`>));

function presetRange(p: RangePreset): [string, string] {
  const t = todayIso();
  const y = +t.slice(0, 4);
  const m = +t.slice(5, 7) - 1;
  const qStart = (yy: number, mm: number) => dayOf(new Date(yy, mm - (mm % 3), 1));
  switch (p) {
    case 'thisMonth': return [`${t.slice(0, 7)}-01`, monthEnd(t)];
    case 'lastMonth': { const a = addMonths(`${t.slice(0, 7)}-01`, -1); return [a, monthEnd(a)]; }
    case 'thisQuarter': { const a = qStart(y, m); return [a, monthEnd(addMonths(a, 2))]; }
    case 'lastQuarter': { const a = addMonths(qStart(y, m), -3); return [a, monthEnd(addMonths(a, 2))]; }
    case 'thisFy': { const b = fyBounds(t); return [b.start, b.end]; }
    case 'lastFy': { const b = fyBounds(addDays(fyBounds(t).start, -1)); return [b.start, b.end]; }
    case 'last7': return [addDays(t, -6), t];
    case 'last30': return [addDays(t, -29), t];
  }
}
const DEFAULT_PRESETS: RangePreset[] = ['thisMonth', 'lastMonth', 'thisQuarter', 'thisFy', 'lastFy', 'last7', 'last30'];

function DateBody({ spec, phone, close }: { spec: DatePopupSpec; phone: boolean; close: (refocus?: boolean) => void }) {
  const range = spec.range;
  const [phase, setPhase] = useState<'from' | 'to'>(range?.edge ?? 'from');
  const anchorDay = (range ? (phase === 'to' ? range.to || range.from : range.from || range.to) : spec.value) || clampToday(spec.min, spec.max);
  const start = localDate(anchorDay) ?? new Date();
  const [view, setView] = useState({ y: start.getFullYear(), m: start.getMonth() });
  const [focusDay, setFocusDay] = useState(anchorDay);
  const [hover, setHover] = useState('');
  const [grid, setGrid] = useState(false);
  const months = range && !phone ? 2 : 1;
  const gridRef = useRef<HTMLDivElement>(null);
  const wantFocus = useRef(spec.focus);
  const titleId = useId();
  const today = todayIso();
  const wd = useMemo(() => weekdays(), []);

  const disabled = (iso: string) => (!!spec.min && iso < spec.min) || (!!spec.max && iso > spec.max) || !!spec.isDisabled?.(iso);

  useEffect(() => {
    if (!wantFocus.current) return;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus({ preventScroll: true });
  }, [focusDay, view]);

  const moveFocus = (iso: string) => {
    wantFocus.current = true;
    const d = localDate(iso)!;
    const first = view.y * 12 + view.m;
    const at = d.getFullYear() * 12 + d.getMonth();
    if (at < first || at > first + months - 1) setView({ y: d.getFullYear(), m: d.getMonth() - (at > first ? months - 1 : 0) });
    setFocusDay(iso);
  };
  const shiftView = (n: number) => {
    const d = new Date(view.y, view.m + n, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
    const f = localDate(focusDay) ?? d;
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    setFocusDay(dayOf(new Date(d.getFullYear(), d.getMonth(), Math.min(f.getDate(), last))));
  };

  const pick = (iso: string) => {
    if (disabled(iso)) return;
    if (!range) {
      spec.onPick(iso);
      close();
      return;
    }
    if (phase === 'from' || (range.from && iso < range.from)) {
      range.onRange(iso, range.to && range.to >= iso ? range.to : iso);
      setPhase('to');
    } else {
      range.onRange(range.from || iso, iso);
      close();
    }
  };

  const onKey = (e: KeyboardEvent) => {
    const map: Record<string, () => string> = {
      ArrowLeft: () => addDays(focusDay, -1),
      ArrowRight: () => addDays(focusDay, 1),
      ArrowUp: () => addDays(focusDay, -7),
      ArrowDown: () => addDays(focusDay, 7),
      PageUp: () => addMonths(focusDay, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focusDay, e.shiftKey ? 12 : 1),
      Home: () => addDays(focusDay, -((localDate(focusDay)!.getDay() - WEEK_START + 7) % 7)),
      End: () => addDays(focusDay, 6 - ((localDate(focusDay)!.getDay() - WEEK_START + 7) % 7)),
    };
    if (map[e.key]) {
      e.preventDefault();
      moveFocus(map[e.key]());
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(focusDay);
    }
  };

  const lo = range ? range.from : '';
  const hi = range ? (phase === 'to' && hover && range.from && hover >= range.from ? hover : range.to) : '';

  const monthGrid = (k: number) => {
    const d = new Date(view.y, view.m + k, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    const cells = monthCells(y, m);
    const rows = Array.from({ length: 6 }, (_, r) => cells.slice(r * 7, r * 7 + 7));
    return (
      <div key={k} className={s.month}>
        {months > 1 && <div className={s.monthName} aria-hidden="true">{monthTitle(y, m)}</div>}
        <table role="grid" className={s.grid} aria-label={monthTitle(y, m)} onKeyDown={onKey}>
          <thead>
            <tr>
              {wd.map((w) => <th key={w.long} scope="col" abbr={w.long} className={s.wd}>{w.short}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((iso) => {
                  const out = iso.slice(0, 7) !== ym(y, m);
                  if (out && months > 1) return <td key={iso} role="gridcell" className={s.cell} />;
                  const sel = range ? iso === range.from || iso === range.to : iso === spec.value;
                  const inRange = !!range && !!lo && !!hi && iso > lo && iso < hi;
                  const off = disabled(iso);
                  return (
                    <td key={iso} role="gridcell" aria-selected={sel || inRange || undefined} className={cn(s.cell, inRange && s.inRange, range && iso === lo && hi && hi > lo && s.rangeStart, range && iso === hi && lo && hi > lo && s.rangeEnd)}>
                      <button
                        type="button"
                        data-day={iso}
                        tabIndex={iso === focusDay ? 0 : -1}
                        aria-label={longDay(iso)}
                        aria-current={iso === today ? 'date' : undefined}
                        aria-disabled={off || undefined}
                        className={cn(s.day, out && s.outside, iso === today && s.today, sel && s.selected, off && s.disabled)}
                        onClick={() => pick(iso)}
                        onMouseEnter={() => range && setHover(iso)}
                        onFocus={() => setFocusDay(iso)}
                      >
                        {+iso.slice(8)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const chips: DateChip[] = range ? [] : uniq<DateChip>(['today', ...(spec.chips ?? ['yesterday'])]);
  const base = spec.chipBase || spec.value || today;

  return (
    <div className={cn(s.cal, months > 1 && s.calWide)} ref={gridRef}>
      <div className={s.head}>
        <button type="button" id={titleId} className={s.title} aria-expanded={grid} aria-label={`${monthTitle(view.y, view.m)}, ${pkT('pickMonthYear')}`} onClick={() => setGrid((g) => !g)}>
          {months > 1 ? `${monthTitle(view.y, view.m)} · ${monthTitle(new Date(view.y, view.m + 1).getFullYear(), (view.m + 1) % 12)}` : monthTitle(view.y, view.m)}
          <ChevronRight size={16} aria-hidden="true" className={cn(s.titleGlyph, grid && s.titleOpen)} />
        </button>
        {!grid && (
          <span className={s.nav}>
            <button type="button" className="btn quiet icon sm" aria-label={pkT('prevMonth')} onClick={() => shiftView(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
            <button type="button" className="btn quiet icon sm" aria-label={pkT('nextMonth')} onClick={() => shiftView(1)}><ChevronRight size={18} aria-hidden="true" /></button>
          </span>
        )}
      </div>
      {grid ? (
        <MonthYearGrid
          y={view.y}
          m={view.m}
          onPick={(y, m) => {
            setView({ y, m });
            const last = new Date(y, m + 1, 0).getDate();
            setFocusDay(dayOf(new Date(y, m, Math.min(localDate(focusDay)?.getDate() ?? 1, last))));
            setGrid(false);
          }}
        />
      ) : (
        <div className={s.months}>{Array.from({ length: months }, (_, k) => monthGrid(k))}</div>
      )}
      {range && phase === 'to' && <p className={s.hint} role="status">{pkT('pickEnd')}</p>}
      {(chips.length > 0 || range) && (
        <div className={s.chips} role="group" aria-label={range ? pkT('presets') : pkT('quick')}>
          {range
            ? (range.presets ?? DEFAULT_PRESETS).map((p) => {
                const [a, b] = presetRange(p);
                const on = range.from === a && range.to === b;
                return (
                  <button key={p} type="button" className="chip" aria-pressed={on} onClick={() => { range.onRange(a, b); close(); }}>
                    {pkT(p)}
                  </button>
                );
              })
            : chips.map((c) => {
                const v = chipValue(c, base);
                const off = disabled(v);
                return (
                  <button key={c} type="button" className="chip" disabled={off} aria-pressed={v === spec.value} title={longDay(v)} onClick={() => pick(v)}>
                    {chipLabel(c)}
                  </button>
                );
              })}
        </div>
      )}
      {!phone && spec.clearable && (range ? range.from || range.to : spec.value) && (
        <div className={s.foot}>
          <button type="button" className="lk" onClick={() => { if (range) range.onRange('', ''); else spec.onPick(''); close(); }}>{pkT('clear')}</button>
        </div>
      )}
    </div>
  );
}

const uniq = <T,>(xs: T[]) => [...new Set(xs)];
function clampToday(min?: string, max?: string) {
  const t = todayIso();
  return min && t < min ? min : max && t > max ? max : t;
}

function MonthYearGrid({ y, m, onPick, min, max, selected }: { y: number; m: number; onPick: (y: number, m: number) => void; min?: string; max?: string; selected?: string }) {
  const [year, setYear] = useState(y);
  const ref = useRef<HTMLDivElement>(null);
  const [focusM, setFocusM] = useState(m);
  const keyed = useRef(false);
  useEffect(() => {
    if (keyed.current) ref.current?.querySelector<HTMLButtonElement>(`[data-m="${focusM}"]`)?.focus();
  }, [focusM, year]);
  const off = (mm: number) => (!!min && ym(year, mm) < min.slice(0, 7)) || (!!max && ym(year, mm) > max.slice(0, 7));
  const onKey = (e: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3, PageUp: -12, PageDown: 12 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    keyed.current = true;
    const n = year * 12 + focusM + step;
    setYear(Math.floor(n / 12));
    setFocusM(((n % 12) + 12) % 12);
  };
  const cur = selected ?? ym(y, m);
  return (
    <div className={s.mgrid} ref={ref}>
      <div className={s.yearRow}>
        <button type="button" className="btn quiet icon sm" aria-label={pkT('prevYear')} onClick={() => setYear(year - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
        <span className={s.year} aria-live="polite">{year}</span>
        <button type="button" className="btn quiet icon sm" aria-label={pkT('nextYear')} onClick={() => setYear(year + 1)}><ChevronRight size={18} aria-hidden="true" /></button>
      </div>
      <div className={s.monthsGrid} role="grid" aria-label={String(year)} onKeyDown={onKey}>
        {[0, 1, 2, 3].map((r) => (
          <div key={r} role="row" className={s.mrow}>
            {[0, 1, 2].map((c) => {
              const mm = r * 3 + c;
              const sel = cur === ym(year, mm);
              return (
                <span key={mm} role="gridcell" aria-selected={sel || undefined}>
                  <button
                    type="button"
                    data-m={mm}
                    tabIndex={mm === focusM ? 0 : -1}
                    disabled={off(mm)}
                    className={cn(s.mcell, sel && s.selected, ym(year, mm) === todayIso().slice(0, 7) && s.today)}
                    onClick={() => onPick(year, mm)}
                  >
                    {monthShort(mm)}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthBody({ spec, phone, close }: { spec: DatePopupSpec; phone: boolean; close: (refocus?: boolean) => void }) {
  const v = spec.value || todayIso().slice(0, 7);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (spec.focus) ref.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus({ preventScroll: true });
  }, [spec.focus]);
  const t = todayIso().slice(0, 7);
  const last = addMonths(`${t}-01`, -1).slice(0, 7);
  return (
    <div className={s.cal} ref={ref}>
      <MonthYearGrid y={+v.slice(0, 4)} m={+v.slice(5, 7) - 1} selected={spec.value} min={spec.min} max={spec.max} onPick={(y, m) => { spec.onPick(ym(y, m)); close(); }} />
      <div className={s.chips} role="group" aria-label={pkT('quick')}>
        <button type="button" className="chip" aria-pressed={spec.value === t} onClick={() => { spec.onPick(t); close(); }}>{pkT('thisMonth')}</button>
        <button type="button" className="chip" aria-pressed={spec.value === last} onClick={() => { spec.onPick(last); close(); }}>{pkT('lastMonth')}</button>
      </div>
      {!phone && spec.clearable && spec.value && (
        <div className={s.foot}>
          <button type="button" className="lk" onClick={() => { spec.onPick(''); close(); }}>{pkT('clear')}</button>
        </div>
      )}
    </div>
  );
}

/* ── Time wheels ────────────────────────────────────────────────── */

function Wheel({ label, items, value, onPick, focus }: { label: string; items: { v: number; text: string }[]; value: number; onPick: (v: number) => void; focus?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-v="${value}"]`);
    if (el && ref.current) ref.current.scrollTop = el.offsetTop - ref.current.clientHeight / 2 + el.offsetHeight / 2;
  }, [value]);
  useEffect(() => {
    if (focus) ref.current?.focus({ preventScroll: true });
  }, [focus]);
  const i = Math.max(0, items.findIndex((x) => x.v === value));
  return (
    <div
      ref={ref}
      role="listbox"
      tabIndex={0}
      aria-label={label}
      aria-activedescendant={`${id}-${value}`}
      className={s.wheel}
      onKeyDown={(e) => {
        const step = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5, Home: -999, End: 999 }[e.key];
        if (step === undefined) return;
        e.preventDefault();
        onPick(items[Math.max(0, Math.min(items.length - 1, i + step))].v);
      }}
    >
      {items.map((x) => (
        <div key={x.v} id={`${id}-${x.v}`} data-v={x.v} role="option" aria-selected={x.v === value} className={cn(s.wheelItem, x.v === value && s.selected)} onClick={() => onPick(x.v)}>
          {x.text}
        </div>
      ))}
    </div>
  );
}

function TimeBody({ spec, phone }: { spec: TimePopupSpec; phone: boolean }) {
  const [h, m] = (spec.value || nowHm()).split(':').map(Number);
  const set = (hh: number, mm: number) => spec.onPick(`${pad(hh)}:${pad(mm)}`);
  const hours = spec.h12
    ? Array.from({ length: 12 }, (_, k) => ({ v: k + 1, text: String(k + 1) }))
    : Array.from({ length: 24 }, (_, k) => ({ v: k, text: pad(k) }));
  const pm = h >= 12;
  return (
    <div className={s.time}>
      <div className={s.wheels}>
        <Wheel label={pkT('hour')} items={hours} value={spec.h12 ? h % 12 || 12 : h} focus={spec.focus} onPick={(v) => set(spec.h12 ? (v % 12) + (pm ? 12 : 0) : v, m)} />
        <span className={s.colon} aria-hidden="true">:</span>
        <Wheel label={pkT('minute')} items={Array.from({ length: 60 }, (_, k) => ({ v: k, text: pad(k) }))} value={m} onPick={(v) => set(h, v)} />
        {spec.h12 && <Wheel label={pkT('period')} items={[{ v: 0, text: 'am' }, { v: 1, text: 'pm' }]} value={pm ? 1 : 0} onPick={(v) => set((h % 12) + (v ? 12 : 0), m)} />}
      </div>
      <div className={s.chips}>
        <button type="button" className="chip" onClick={() => spec.onPick(nowHm())}>{pkT('now')}</button>
        {!phone && spec.clearable && spec.value && <button type="button" className="lk" onClick={() => spec.onPick('')}>{pkT('clear')}</button>}
      </div>
    </div>
  );
}
const nowHm = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/* ── List (pop-up button) ───────────────────────────────────────── */

interface Opt { value: string; label: string; disabled: boolean; group: string; i: number }

function readOptions(select: HTMLSelectElement): Opt[] {
  return Array.from(select.options)
    .filter((o) => !o.hidden)
    .map((o, i) => ({
      value: o.value,
      label: o.label || o.text,
      disabled: o.disabled || (o.parentElement instanceof HTMLOptGroupElement && o.parentElement.disabled),
      group: o.parentElement instanceof HTMLOptGroupElement ? o.parentElement.label : '',
      i,
    }));
}

const fold = (x: string) => x.toLocaleLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const at = fold(text).indexOf(fold(q));
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className={s.mark}>{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

function ListBody({ spec, phone, close }: { spec: ListPopupSpec; phone: boolean; close: (refocus?: boolean) => void }) {
  const all = useMemo(() => readOptions(spec.select), [spec.select]);
  const current = spec.select.value;
  const searchable = all.length > 8;
  const [q, setQ] = useState('');
  const shown = useMemo(() => (q ? all.filter((o) => fold(`${o.label} ${o.group}`).includes(fold(q))) : all), [all, q]);
  const enabled = shown.filter((o) => !o.disabled);
  const [active, setActive] = useState(() => Math.max(0, enabled.findIndex((o) => o.value === current)));
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const typed = useRef({ text: '', at: 0 });
  const act = enabled[Math.min(active, enabled.length - 1)];

  useEffect(() => {
    if (!spec.focus) return;
    (searchable && !phone ? searchRef.current : listRef.current)?.focus({ preventScroll: true });
  }, [spec.focus, searchable, phone]);
  useLayoutEffect(() => {
    if (!act) return;
    listRef.current?.querySelector(`[data-i="${act.i}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [act]);

  const choose = (o: Opt | undefined) => {
    if (!o || o.disabled) return;
    spec.onPick(o.value);
    close();
  };
  const onKey = (e: KeyboardEvent) => {
    const n = enabled.length;
    const step: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 };
    if (e.key in step) {
      e.preventDefault();
      setActive((a) => Math.max(0, Math.min(n - 1, a + step[e.key])));
    } else if (e.key === 'Home' && e.currentTarget !== searchRef.current) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && e.currentTarget !== searchRef.current) {
      e.preventDefault();
      setActive(n - 1);
    } else if (e.key === 'Enter' || (e.key === ' ' && e.currentTarget !== searchRef.current)) {
      e.preventDefault();
      choose(act);
    } else if (e.currentTarget !== searchRef.current && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Type-ahead on the list: jump to the next option starting with what was typed.
      const now = Date.now();
      const t = typed.current;
      t.text = now - t.at > 700 ? e.key : t.text + e.key;
      t.at = now;
      const hit = enabled.findIndex((o) => fold(o.label).startsWith(fold(t.text)));
      if (hit >= 0) setActive(hit);
    }
  };

  let lastGroup = '';
  const rows: ReactNode[] = [];
  for (const o of shown) {
    if (o.group !== lastGroup) {
      lastGroup = o.group;
      if (o.group) rows.push(<div key={`g-${o.i}`} role="presentation" className={s.group}>{o.group}</div>);
    }
    const sel = o.value === current;
    const on = act === o;
    rows.push(
      <div
        key={o.i}
        id={`${id}-${o.i}`}
        data-i={o.i}
        role="option"
        aria-selected={sel}
        aria-disabled={o.disabled || undefined}
        title={o.label}
        className={cn(s.opt, on && s.active, sel && s.checked, o.disabled && s.disabled)}
        onMouseMove={() => !o.disabled && setActive(enabled.indexOf(o))}
        onClick={() => choose(o)}
      >
        <span className={s.check} aria-hidden="true">{sel && <Check size={16} />}</span>
        <span className={s.optLabel}><Highlight text={o.label || ' '} q={q} /></span>
      </div>,
    );
  }

  return (
    <div className={s.list}>
      {searchable && (
        <div className={s.searchRow}>
          <Search size={16} aria-hidden="true" className={s.searchGlyph} />
          <input
            ref={searchRef}
            className={s.search}
            type="search"
            role="combobox"
            aria-label={pkT('search')}
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={act ? `${id}-${act.i}` : undefined}
            aria-autocomplete="list"
            placeholder={pkT('search')}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
          />
        </div>
      )}
      <div
        ref={listRef}
        id={`${id}-list`}
        role="listbox"
        tabIndex={searchable && !phone ? -1 : 0}
        aria-label={spec.label || pkT('chooseOption')}
        aria-activedescendant={act ? `${id}-${act.i}` : undefined}
        className={s.options}
        onKeyDown={onKey}
      >
        {rows.length ? rows : <div className={s.empty} role="status">{pkT('noMatch')}</div>}
      </div>
    </div>
  );
}
