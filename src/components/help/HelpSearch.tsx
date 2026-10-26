/** R6-A2 search over every help topic (same tokeniser and scorer as Ctrl+K, `search.ts`). Topics load on first use. */
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useT } from '../../i18n';
import { helpT } from '../../i18n/areas/help-r6';
import { helpIndex } from '../../lib/help/registry';
import { prepareTokens, scoreTokens, type Field } from '../../lib/search';
import type { HelpTopic } from '../../lib/help/types';
import { topicTitle } from './labels';
import controls from '../../styles/controls.module.css';
import styles from './help.module.css';

type Indexed = HelpTopic & { href: string; fields: Field[] };

export function HelpSearch({ onPick }: { onPick: (topic: HelpTopic) => void }) {
  useT();
  const [q, setQ] = useState('');
  const [index, setIndex] = useState<Indexed[] | null>(null);

  useEffect(() => {
    if (!q.trim() || index) return;
    let alive = true;
    helpIndex().then(
      (all) => alive && setIndex(all.map((x) => ({ ...x, fields: [
        { text: x.title, weight: 3, isTitle: true },
        { text: x.hiTitle, weight: 3 },
        { text: x.id.replace(/[:-]/g, ' '), weight: 2 },
        { text: x.what, weight: 1 },
      ] }))),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [q, index]);

  const results = useMemo(() => {
    if (!index || !q.trim()) return [];
    const tokens = prepareTokens(q);
    return index
      .map((x) => ({ x, s: scoreTokens(tokens, x.fields) }))
      .filter((r): r is { x: Indexed; s: NonNullable<typeof r.s> } => !!r.s && r.s.score > 0)
      .sort((a, b) => b.s.score - a.s.score)
      .slice(0, 12)
      .map((r) => r.x);
  }, [index, q]);

  return (
    <div className={styles.stack} style={{ gap: '0.5rem' }}>
      <label className={controls.field}>
        <span className={controls.label}><Search size={13} aria-hidden="true" /> {helpT('search')}</span>
        <input className={controls.input} type="search" value={q} placeholder={helpT('searchPh')} onChange={(e) => setQ(e.target.value)} data-help-search />
      </label>
      {q.trim() && index && (
        results.length ? (
          <ul className={styles.results}>
            {results.map((r) => (
              <li key={r.id}>
                <button type="button" className={styles.result} onClick={() => onPick(r)} data-help-result={r.id}>
                  {topicTitle(r)}
                  <span className={styles.resultWhat}>{r.what.length > 110 ? `${r.what.slice(0, 110)}…` : r.what}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>{helpT('noResults', { q: q.trim() })}</p>
        )
      )}
    </div>
  );
}
