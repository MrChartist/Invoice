/**
 * QA7 G3: the open dialogs, newest last. Every `Modal` listens for Escape on `document`, so with two dialogs open
 * (F1 Help over a form) both used to close and the form was lost. Only the top dialog acts on Escape (and Tab) now;
 * the shell's F1 stays quiet while any `[aria-modal]` dialog is open (DashboardLayout). Pure (tests/modal-stack.test.ts).
 */
const stack: object[] = [];

/** Register an open dialog; the returned function removes it (wherever it sits in the stack). */
export function pushModal(token: object): () => void {
  stack.push(token);
  return () => {
    const i = stack.lastIndexOf(token);
    if (i >= 0) stack.splice(i, 1);
  };
}

export const isTopModal = (token: object): boolean => stack[stack.length - 1] === token;
