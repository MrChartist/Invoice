/**
 * R4-C7 field-level sync conflict resolution, lazy inside the Sync panel: labelled differences (plain words,
 * formatted values, contact / bank values hidden without `settings.manage`), Mine / Theirs per field for masters
 * and per group for documents ("Lines, taxes & totals" is one choice; the number comes with its date), and the
 * bulk actions. The merge itself runs in `resolveConflict` (sync-engine.ts) after a re-scan and validation.
 */
import { useState } from 'react';
import { FileDiff } from 'lucide-react';
import type { RowConflict, SyncConflict, Resolution } from '../../lib/sync-engine';
import { can } from '../../lib/access';
import type { FieldPick, FieldPicks } from '../../lib/trust/field-merge';
import { useT } from '../../i18n';
import { trT, type TrKey } from '../../i18n/areas/trade-trust-r4';
import controls from '../../styles/controls.module.css';
import styles from './trust.module.css';

type Resolve = (id: string, choice: Resolution, override?: boolean) => Promise<void>;

/** The merge helpers, handed in by the Sync panel (they live in the sync chunk with `resolveConflict`). */
export type FieldMergeApi = typeof import('../../lib/trust/field-merge');

const label = (fm: FieldMergeApi, key: string) => {
  const k = `f_${key}` as TrKey;
  return Object.hasOwn(trT.en, k) ? trT(k) : fm.fieldLabel(key);
};

function Pick({ name, value, onChange, mine, theirs }: { name: string; value: FieldPick; onChange: (p: FieldPick) => void; mine: string; theirs: string }) {
  return (
    <>
      <label className={styles.side}><input type="radio" name={name} checked={value === 'mine'} onChange={() => onChange('mine')} /> <span><b>{trT('mine')}:</b> {mine}</span></label>
      <label className={styles.side}><input type="radio" name={name} checked={value === 'theirs'} onChange={() => onChange('theirs')} /> <span><b>{trT('theirs')}:</b> {theirs}</span></label>
    </>
  );
}

export default function ConflictMerge({ c, onResolve, fm }: { c: RowConflict; onResolve: Resolve; fm: FieldMergeApi }) {
  useT();
  const { fieldDiffs, groupDiffs, mergeKind, showValue, tableOfKey } = fm;
  const [picks, setPicks] = useState<FieldPicks>({});
  const table = tableOfKey(c.key);
  const kind = mergeKind(table);
  const seePrivate = can('settings.manage');
  const local = c.local.value as Record<string, unknown> | null;
  const remote = c.remote.value as Record<string, unknown> | null;
  const currency = typeof local?.currency === 'string' ? local.currency : 'INR';
  const show = (k: string, v: unknown) => {
    const t = showValue(k, v, { seePrivate, currency });
    return t === '(changed)' ? trT('changed') : t;
  };
  const mergeable = c.reason === 'concurrent' && kind !== 'none' && !!local && !!remote && !c.locked;
  const set = (k: string, p: FieldPick) => setPicks((x) => ({ ...x, [k]: p }));
  const id = `m-${c.id}`;

  if (!local || !remote) return null;
  if (kind === 'document') {
    const groups = groupDiffs(local, remote);
    if (!groups.length) return null;
    return (
      <div className={styles.merge} data-conflict-merge>
        <strong><FileDiff size={14} aria-hidden="true" /> {trT('mergeTitle')}</strong>
        <p className={styles.muted}>{trT('mergeGroupsIntro')}</p>
        {groups.map((g) => (
          <div key={g.id}>
            <div className={styles.group}>{trT(`g_${g.id}`)}</div>
            {g.fields.map((d) => <div key={d.key} className={styles.mergeRow}><b>{label(fm, d.key)}</b><span>{show(d.key, d.mine)}</span><span>{show(d.key, d.theirs)}</span></div>)}
            {mergeable && <div className={styles.mergeRow}><span /><Pick name={`${id}-${g.id}`} value={picks[g.id] ?? 'mine'} onChange={(p) => set(g.id, p)} mine={trT('mine')} theirs={trT('theirs')} /></div>}
          </div>
        ))}
        {mergeable && <div className={styles.actions}><button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void onResolve(c.id, { merge: picks })}>{trT('mergeSave')}</button></div>}
      </div>
    );
  }
  const diffs = fieldDiffs(local, remote);
  if (!diffs.length) return null;
  return (
    <div className={styles.merge} data-conflict-merge>
      <strong><FileDiff size={14} aria-hidden="true" /> {mergeable ? trT('mergeTitle') : trT('mergeIntro')}</strong>
      {mergeable && <p className={styles.muted}>{trT('mergeIntro')}</p>}
      {diffs.map((d) =>
        mergeable ? (
          <div key={d.key} className={styles.mergeRow}><b>{label(fm, d.key)}</b><Pick name={`${id}-${d.key}`} value={picks[d.key] ?? 'mine'} onChange={(p) => set(d.key, p)} mine={show(d.key, d.mine)} theirs={show(d.key, d.theirs)} /></div>
        ) : (
          <div key={d.key} className={styles.mergeRow}><b>{label(fm, d.key)}</b><span>{trT('mine')}: {show(d.key, d.mine)}</span><span>{trT('theirs')}: {show(d.key, d.theirs)}</span></div>
        ),
      )}
      {mergeable && <div className={styles.actions}><button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void onResolve(c.id, { merge: picks })}>{trT('mergeSave')}</button></div>}
    </div>
  );
}

/** Bulk: keep mine / use theirs for every plain concurrent conflict, or merge masters changed on one side per field. */
export function BulkMerge({ conflicts, resolve, onDone, fm }: { conflicts: readonly SyncConflict[]; resolve: (id: string, choice: Resolution) => Promise<{ ok: boolean }>; onDone: (msg: string) => void; fm: FieldMergeApi }) {
  useT();
  const { mergeKind, nonOverlappingPicks, remoteFollowsKnown, tableOfKey } = fm;
  const plain = conflicts.filter((c): c is RowConflict => c.kind === 'row' && c.reason === 'concurrent' && !c.locked);
  const [busy, setBusy] = useState(false);
  if (plain.length < 2) return null;
  const run = async (choose: (c: RowConflict) => Resolution | null) => {
    setBusy(true);
    let n = 0;
    for (const c of plain) {
      const choice = choose(c);
      if (!choice) continue;
      if ((await resolve(c.id, choice)).ok) n++;
    }
    setBusy(false);
    onDone(trT('bulkDone', { n, left: plain.length - n }));
  };
  const masters = (c: RowConflict): Resolution | null => {
    if (mergeKind(tableOfKey(c.key)) !== 'master' || !remoteFollowsKnown(c.local, c.remote)) return null;
    const picks = nonOverlappingPicks(c.local.value, c.remote.value);
    return picks ? { merge: picks } : null;
  };
  return (
    <div className={styles.actions} data-bulk-merge>
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={busy} onClick={() => void run(() => 'mine')}>{trT('keepMineAll')}</button>
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={busy} onClick={() => void run(() => 'theirs')}>{trT('useTheirsAll')}</button>
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={busy} title={trT('mergeMastersHint')} onClick={() => void run(masters)}>{trT('mergeMasters')}</button>
    </div>
  );
}
