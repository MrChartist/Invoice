/** R13 PressDesk (`/manufacturing?tab=press&view=`): a stub until its package replaces this file (same default export and props). */
import type { MfDeskProps } from './desk-props';
import R13Stub from './R13Stub';

export default function PressDesk(props: MfDeskProps) {
  return <R13Stub desk={props.view ? `press:${props.view}` : 'press'} />;
}
