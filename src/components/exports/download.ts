/** Browser download helpers for the Export Center (kept out of the tested lib). */

import type { ExportFile } from '../../lib/accounting-export';

export function downloadFile(file: ExportFile): void {
  const blob = new Blob([file.content], { type: file.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on a later tick so the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Download several files one after another (browsers throttle simultaneous downloads). */
export async function downloadSequentially(files: ExportFile[], gapMs = 450): Promise<void> {
  for (const f of files) {
    downloadFile(f);
    await new Promise((r) => setTimeout(r, gapMs));
  }
}
