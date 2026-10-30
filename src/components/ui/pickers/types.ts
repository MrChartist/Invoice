/** Shared shapes of the picker shells and their one lazy popup chunk (docs/theme/IOS-UI.md, Pickers). Types only. */

/** A quick chip under the calendar. Relative chips count from `chipBase` (the field's value, else today). */
export type DateChip = 'onReceipt' | 'today' | 'yesterday' | 'tomorrow' | '+7' | '+15' | '+30' | '+45' | '+60' | '+90' | 'monthEnd' | 'fyStart' | 'fyEnd' | 'monthStart';

/** Range presets (`DateRangeField`, or a `range` on two `DateField`s). */
export type RangePreset = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'lastQuarter' | 'thisFy' | 'lastFy' | 'last7' | 'last30';

export interface RangeSpec {
  from: string;
  to: string;
  onRange: (from: string, to: string) => void;
  /** Which end the field holding the popup edits first. */
  edge: 'from' | 'to';
  presets?: RangePreset[];
}

interface Base {
  anchor: HTMLElement;
  /** Sheet title on phones, accessible name of the popover. */
  label: string;
  /** Move focus into the popup (opened from the keyboard, or a select). */
  focus: boolean;
  onClose: (refocus: boolean) => void;
}

export interface DatePopupSpec extends Base {
  kind: 'date' | 'month';
  value: string;
  min?: string;
  max?: string;
  chips?: DateChip[];
  chipBase?: string;
  clearable: boolean;
  isDisabled?: (iso: string) => boolean;
  range?: RangeSpec;
  onPick: (value: string) => void;
}

export interface TimePopupSpec extends Base {
  kind: 'time';
  value: string;
  clearable: boolean;
  h12: boolean;
  onPick: (value: string) => void;
}

export interface ListPopupSpec extends Base {
  kind: 'list';
  select: HTMLSelectElement;
  onPick: (value: string) => void;
}

export type PopupSpec = DatePopupSpec | TimePopupSpec | ListPopupSpec;

/** What a picker field hands its `onChange`: `e.target.value` reads like a native input's. */
export interface PickerChange {
  target: { value: string; name: string; id: string };
  currentTarget: { value: string; name: string; id: string };
}
