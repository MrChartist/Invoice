/**
 * R6-B2: open Help from anywhere without importing it. Empty states, tips and the palette call `openHelp(topic)`;
 * the shell (`DashboardLayout`) listens for the event and opens the Help dialog. The dialog (R6-A2) reads the asked
 * topic with `takeHelpTopic()` when it opens. Tiny on purpose: it is part of the shell.
 */
export const OPEN_HELP_EVENT = 'mrchartist:open-help';

let asked: string | undefined;

export function openHelp(topic?: string): void {
  asked = topic;
  window.dispatchEvent(new CustomEvent(OPEN_HELP_EVENT, { detail: { topic } }));
}

/** The topic the last `openHelp` asked for (cleared once read). */
export function takeHelpTopic(): string | undefined {
  const t = asked;
  asked = undefined;
  return t;
}
