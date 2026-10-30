/** Package PL (layout and space): master-detail panes (SplitView) and their inspectors. Lazy, with the list screens. */
import { defineArea } from '../area';

export const splitT = defineArea(
  {
    back: 'Back',
    closePane: 'Close the side pane',
    resize: 'Resize the panes',
    preview: 'Invoice preview',
    open: 'Open',
    balance: 'Balance',
    total: 'Total',
  } as const,
  {
    back: 'वापस',
    closePane: 'साइड पैन बंद करें',
    resize: 'पैन का आकार बदलें',
    preview: 'इनवॉइस प्रीव्यू',
    open: 'खोलें',
    balance: 'बकाया',
    total: 'कुल',
  },
);
