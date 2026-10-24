import { useEffect } from 'react';
import { isSaveShortcut } from '../components/creator/line-keys';

/**
 * Keyboard handling of the invoice editor:
 * - Ctrl/⌘+S (and Ctrl/⌘+Enter) saves, Ctrl/⌘+P opens the preview;
 * - Esc leaves the editor when no field or dialog is active (drafts autosave, so nothing is lost).
 */
export function useCreatorKeys({ onSave, onPreview, onExit }: { onSave: () => void; onPreview: () => void; onExit: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (isSaveShortcut(e)) {
        e.preventDefault();
        onSave();
      } else if (key === 's') {
        e.preventDefault();
        onSave();
      } else if (key === 'p') {
        e.preventDefault();
        onPreview();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSave, onPreview]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable]') || t.closest('[role="dialog"]'))) return;
      if (document.querySelector('[role="dialog"]')) return;
      onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);
}

/** Warn before a refresh/tab close would drop unsaved edits (`active` = dirty saved document). */
export function useUnsavedChangesWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}
