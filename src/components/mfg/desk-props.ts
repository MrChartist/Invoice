/** Props of every Round 13 desk mounted by `Manufacturing.tsx` (`?tab=<desk>&view=<view>`). Types only. */
import type { MfgContext } from '../manufacturing/context';

export interface MfDeskProps {
  view?: string;
  ctx: MfgContext;
}
