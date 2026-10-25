/**
 * Notes to accounts editor (R2-C1): the editable text notes (starting from suggested wording) and an
 * extra paragraph under each automatic note, saved per FY in `notes_to_accounts`.
 */
import { useState } from 'react';
import type { NoteText } from '../../../types/books-r2';
import type { PackNote } from '../../../lib/ledger/notes-auto';
import { TEXT_NOTES } from '../../../lib/ledger/notes-auto';
import type { EntityType } from '../../../types/books-r2';
import { useT } from '../../../i18n';
import { br2T } from '../../../i18n/areas/books-r2';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';

export function NotesEditor({
  notes,
  stored,
  entity,
  editable,
  onSave,
}: {
  notes: PackNote[];
  stored: Record<string, NoteText>;
  entity: EntityType;
  editable: boolean;
  onSave: (next: Record<string, NoteText>) => void;
}) {
  useT();
  const starter = (id: string) => TEXT_NOTES.find((t) => t.id === id)?.starter(entity) ?? '';
  const [draft, setDraft] = useState<Record<string, NoteText>>(() => {
    const d: Record<string, NoteText> = {};
    for (const n of notes) d[n.id] = n.kind === 'text' ? { text: stored[n.id]?.text?.trim() ? stored[n.id].text : starter(n.id) } : { extra: stored[n.id]?.extra ?? '' };
    return d;
  });
  const set = (id: string, patch: NoteText) => setDraft((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  const save = () => {
    // A text note still equal to its starter wording is not stored (it follows the entity type).
    const out: Record<string, NoteText> = {};
    for (const n of notes) {
      const v = draft[n.id] ?? {};
      if (n.kind === 'text' && v.text && v.text.trim() !== starter(n.id).trim()) out[n.id] = { text: v.text };
      if (n.kind === 'auto' && v.extra?.trim()) out[n.id] = { extra: v.extra };
    }
    onSave(out);
  };
  return (
    <section className={books.stack} aria-labelledby="notes-editor-head" data-notes-editor>
      <h3 id="notes-editor-head" className={controls.label}>{br2T('notes')}</h3>
      <p className={controls.hint}>{br2T('notesHint')}</p>
      {notes.map((n) => (
        <div key={n.id} className={controls.field}>
          <label className={controls.label} htmlFor={`note-${n.id}`}>
            {n.no}. {n.title} <span className={books.muted}>· {n.kind === 'auto' ? br2T('autoNote') : br2T('textNote')}</span>
          </label>
          <textarea
            id={`note-${n.id}`}
            className={controls.textarea}
            rows={n.kind === 'text' ? 4 : 2}
            readOnly={!editable}
            value={(n.kind === 'text' ? draft[n.id]?.text : draft[n.id]?.extra) ?? ''}
            placeholder={n.kind === 'auto' ? br2T('extraPh') : undefined}
            onChange={(e) => set(n.id, n.kind === 'text' ? { text: e.target.value } : { extra: e.target.value })}
          />
          {n.kind === 'text' && editable && (
            <div>
              <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => set(n.id, { text: starter(n.id) })}>{br2T('resetNote')}</button>
            </div>
          )}
        </div>
      ))}
      {editable && (
        <div>
          <button type="button" className={controls.btnPrimary} onClick={save} data-notes-save>{br2T('saveNotes')}</button>
        </div>
      )}
    </section>
  );
}
