/** R13 MouldingDesk (`/manufacturing?tab=moulding&view=`): a stub until its package replaces this file (same default export and props). */
import type { MfDeskProps } from './desk-props';
import R13Stub from './R13Stub';

export default function MouldingDesk(props: MfDeskProps) {
  return <R13Stub desk={props.view ? `moulding:${props.view}` : 'moulding'} />;
}
