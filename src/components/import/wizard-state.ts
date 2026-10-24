/**
 * State of the CSV import wizard as one reducer (was ~24 useState calls in ImportWizard.tsx).
 * Pure: no storage or DOM access, so tests/import-wizard-state.test.ts drives it directly.
 * Reading existing records and running the import stay in the component; their results come in
 * through actions.
 */
import { guessMapping, type ColumnMapping, type ImportKind } from '../../lib/import-mapping';
import type { ExistingData, ImportReport, ImportTable } from '../../lib/importers';

export const PAGE = 100;
export const LAST_STEP = 3;

export type DuplicateMode = 'update' | 'skip';
export type RowFilter = 'all' | 'issues' | 'errors';

export interface WizardState {
  step: number;
  kind: ImportKind;
  // step 1: source
  fileName: string;
  table: ImportTable | null;
  delimiterLabel: string;
  loadError: string;
  pasteOpen: boolean;
  pasted: string;
  dragging: boolean;
  // step 2: mapping
  mapping: ColumnMapping;
  confidence: Record<string, number>;
  presetId: string;
  // step 3: review
  duplicateMode: DuplicateMode;
  strictGstin: boolean;
  skipped: ReadonlySet<number>;
  filter: RowFilter;
  editing: number | null;
  visible: number;
  // step 4: run
  running: boolean;
  progress: number;
  report: ImportReport | null;
  saveError: string;
  /** Records already stored, re-read before review and after the import (duplicate check). */
  existing: ExistingData;
}

export type WizardAction =
  | { type: 'loaded'; fileName: string; table: ImportTable; delimiter: string }
  | { type: 'loadFailed'; message: string; clearTable?: boolean }
  | { type: 'setKind'; kind: ImportKind }
  | { type: 'setColumn'; key: string; col: number | undefined }
  | { type: 'applyPreset'; presetId: string }
  | { type: 'toggleSkip'; sourceIndexes: readonly number[] }
  | { type: 'editCell'; rowIndex: number; col: number; value: string }
  | { type: 'setFilter'; filter: RowFilter }
  | { type: 'toggleEdit'; index: number }
  | { type: 'showMore' }
  | { type: 'setDuplicateMode'; mode: DuplicateMode }
  | { type: 'setStrictGstin'; strict: boolean }
  | { type: 'setPasteOpen'; open: boolean }
  | { type: 'setPasted'; text: string }
  | { type: 'setDragging'; dragging: boolean }
  | { type: 'next'; existing?: ExistingData }
  | { type: 'back' }
  | { type: 'runStarted' }
  | { type: 'runProgress'; done: number }
  | { type: 'runSucceeded'; report: ImportReport; existing: ExistingData }
  | { type: 'runFailed'; message: string }
  | { type: 'runEnded' };

export type { ExistingData };

export function initialWizardState(kind: ImportKind | undefined, existing: ExistingData): WizardState {
  return {
    step: 0,
    kind: kind ?? 'clients',
    fileName: '',
    table: null,
    delimiterLabel: '',
    loadError: '',
    pasteOpen: false,
    pasted: '',
    dragging: false,
    mapping: {},
    confidence: {},
    presetId: 'generic',
    duplicateMode: 'update',
    strictGstin: true,
    skipped: new Set(),
    filter: 'all',
    editing: null,
    visible: PAGE,
    running: false,
    progress: 0,
    report: null,
    saveError: '',
    existing,
  };
}

export function delimiterName(delimiter: string): string {
  return delimiter === '\t' ? 'tab' : delimiter === ';' ? 'semicolon' : delimiter === '|' ? 'pipe' : 'comma';
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'loaded': {
      const guess = guessMapping(state.kind, action.table.headers, action.table.rows);
      return {
        ...state,
        loadError: '',
        fileName: action.fileName,
        table: action.table,
        delimiterLabel: delimiterName(action.delimiter),
        mapping: guess.mapping,
        confidence: guess.confidence,
        presetId: guess.presetId ?? 'generic',
        skipped: new Set(),
        editing: null,
      };
    }
    case 'loadFailed':
      return { ...state, loadError: action.message, table: action.clearTable ? null : state.table };
    case 'setKind': {
      if (!state.table) return { ...state, kind: action.kind };
      const guess = guessMapping(action.kind, state.table.headers, state.table.rows);
      return {
        ...state,
        kind: action.kind,
        mapping: guess.mapping,
        confidence: guess.confidence,
        presetId: guess.presetId ?? 'generic',
        skipped: new Set(),
      };
    }
    case 'setColumn': {
      const mapping: ColumnMapping = { ...state.mapping };
      if (action.col === undefined) delete mapping[action.key];
      else {
        for (const k of Object.keys(mapping)) if (mapping[k] === action.col) delete mapping[k]; // one column, one field
        mapping[action.key] = action.col;
      }
      return { ...state, mapping, confidence: { ...state.confidence, [action.key]: action.col === undefined ? 0 : 1 } };
    }
    case 'applyPreset': {
      if (!state.table) return state;
      const id = action.presetId;
      const guess = guessMapping(state.kind, state.table.headers, state.table.rows, id === 'generic' ? undefined : id);
      return { ...state, presetId: id, mapping: guess.mapping, confidence: guess.confidence };
    }
    case 'toggleSkip': {
      const skipped = new Set(state.skipped);
      for (const i of action.sourceIndexes) {
        if (skipped.has(i)) skipped.delete(i);
        else skipped.add(i);
      }
      return { ...state, skipped };
    }
    case 'editCell': {
      const t = state.table;
      if (!t) return state;
      const rows = t.rows.map((row, i) => (i === action.rowIndex ? row.map((c, ci) => (ci === action.col ? action.value : c)) : row));
      return { ...state, table: { ...t, rows } };
    }
    case 'setFilter':
      return { ...state, filter: action.filter, visible: PAGE };
    case 'toggleEdit':
      return { ...state, editing: state.editing === action.index ? null : action.index };
    case 'showMore':
      return { ...state, visible: state.visible + PAGE * 4 };
    case 'setDuplicateMode':
      return { ...state, duplicateMode: action.mode };
    case 'setStrictGstin':
      return { ...state, strictGstin: action.strict };
    case 'setPasteOpen':
      return { ...state, pasteOpen: action.open };
    case 'setPasted':
      return { ...state, pasted: action.text };
    case 'setDragging':
      return { ...state, dragging: action.dragging };
    case 'next':
      return { ...state, existing: action.existing ?? state.existing, step: Math.min(state.step + 1, LAST_STEP) };
    case 'back':
      return { ...state, step: state.step - 1 };
    case 'runStarted':
      return { ...state, running: true, saveError: '', progress: 0 };
    case 'runProgress':
      return { ...state, progress: action.done };
    case 'runSucceeded':
      return { ...state, report: action.report, existing: action.existing };
    case 'runFailed':
      return { ...state, saveError: action.message };
    case 'runEnded':
      return { ...state, running: false };
    default:
      return state;
  }
}
