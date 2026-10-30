/** Package PL (layout and space): the shell's sidebar rail toggle (first paint; the panes' strings are in split-pl.ts). */
import { defineArea } from '../area';

export const plT = defineArea(
  {
    railShow: 'Show sidebar labels',
    railHide: 'Collapse sidebar to icons',
  } as const,
  {
    railShow: 'साइडबार के नाम दिखाएँ',
    railHide: 'साइडबार को आइकन तक छोटा करें',
  },
);
