import { useState } from 'react';
import { ArrowDown, ArrowUp, BookmarkPlus, Plus, Trash2 } from 'lucide-react';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import type { ProposalSection, SectionPlace } from '../../types/sales-r2';
import { moveSection, SECTION_PLACES, sectionFromSnippet, snippetsDb } from '../../lib/proposal-sections';
import { generateId } from '../../lib/storage';
import { isImageMime } from '../../lib/attachments';
import { useT } from '../../i18n';
import { s2T } from '../../i18n/areas/sales-r2';
import controls from '../../styles/controls.module.css';
import styles from './ProposalSectionsCard.module.css';
import { SelectField } from '../ui/SelectField';

/**
 * R2-B3 (quotations): proposal sections — cover / before items / after items blocks with plain text and
 * an optional image from this document's attachments — and a small reusable snippet library.
 */
export function ProposalSectionsCard() {
  useT(); // re-render on a language switch (5.4)
  const sections = useInvoiceStore((s) => s.proposal_sections) ?? [];
  const attachments = useInvoiceStore((s) => s.attachments) ?? [];
  const patch = useInvoiceStore((s) => s.patch);
  const [snippets, setSnippets] = useState(() => snippetsDb.all());
  const [note, setNote] = useState('');
  const images = attachments.filter((a) => isImageMime(a.mime));

  const save = (next: ProposalSection[]) => patch({ proposal_sections: next.length ? next : undefined });
  const set = (id: string, p: Partial<ProposalSection>) => save(sections.map((s) => (s.id === id ? { ...s, ...p } : s)));

  return (
    <section className={styles.card} aria-label={s2T('q.sections')} data-proposal-card>
      <div className={styles.head}>
        <div>
          <strong>{s2T('q.sections')}</strong>
          <p className={styles.hint}>{s2T('q.sectionsHint')}</p>
        </div>
        <div className={styles.actions}>
          {snippets.length > 0 && (
            <SelectField className={controls.select} value="" aria-label={s2T('q.snippets')}
              onChange={(e) => {
                const sn = snippets.find((x) => x.id === e.target.value);
                if (sn) save([...sections, sectionFromSnippet(sn)]);
              }}>
              <option value="">{s2T('q.snippets')}</option>
              {snippets.map((sn) => <option key={sn.id} value={sn.id}>{sn.title || sn.body.slice(0, 30)}</option>)}
            </SelectField>
          )}
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} data-add-section
            onClick={() => save([...sections, { id: generateId(), place: 'after', title: '', body: '' }])}>
            <Plus size={14} aria-hidden="true" /> {s2T('q.addSection')}
          </button>
        </div>
      </div>
      {sections.map((s, i) => (
        <div key={s.id} className={styles.section}>
          <div className={styles.row}>
            <input className={controls.input} value={s.title} onChange={(e) => set(s.id, { title: e.target.value })} placeholder={s2T('q.sectionTitle')} aria-label={`${s2T('q.sectionTitle')} ${i + 1}`} data-section-title />
            <SelectField className={controls.select} value={s.place} onChange={(e) => set(s.id, { place: e.target.value as SectionPlace })} aria-label={`${s2T('q.place')} ${i + 1}`}>
              {SECTION_PLACES.map((p) => <option key={p} value={p}>{s2T(`q.place.${p}`)}</option>)}
            </SelectField>
            {images.length > 0 && (
              <SelectField className={controls.select} value={s.attachment_id ?? ''} onChange={(e) => set(s.id, { attachment_id: e.target.value || undefined })} aria-label={`${s2T('q.image')} ${i + 1}`}>
                <option value="">{s2T('q.noImage')}</option>
                {images.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </SelectField>
            )}
          </div>
          <textarea className={controls.textarea} rows={3} value={s.body} onChange={(e) => set(s.id, { body: e.target.value })} placeholder={s2T('q.sectionBody')} aria-label={`${s2T('q.sectionBody')} ${i + 1}`} />
          <div className={styles.rowActions}>
            <button type="button" className={controls.btnIcon} disabled={i === 0} onClick={() => save(moveSection(sections, s.id, -1))} aria-label={s2T('up')}><ArrowUp size={14} /></button>
            <button type="button" className={controls.btnIcon} disabled={i === sections.length - 1} onClick={() => save(moveSection(sections, s.id, 1))} aria-label={s2T('down')}><ArrowDown size={14} /></button>
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`}
              onClick={() => {
                try {
                  snippetsDb.save(s);
                  setSnippets(snippetsDb.all());
                  setNote(s2T('q.snippetSaved'));
                } catch (err) {
                  setNote((err as Error).message);
                }
              }}>
              <BookmarkPlus size={14} aria-hidden="true" /> {s2T('q.saveSnippet')}
            </button>
            <button type="button" className={controls.btnDanger} onClick={() => save(sections.filter((x) => x.id !== s.id))} aria-label={`${s2T('remove')} ${i + 1}`}><Trash2 size={14} /></button>
          </div>
        </div>
      ))}
      {note && <p className={styles.hint} role="status">{note}</p>}
    </section>
  );
}
