/** R13 StatutoryDesk (`/manufacturing?tab=statutory&view=`): a stub until its package replaces this file (same default export and props). */
import type { MfDeskProps } from './desk-props';
import R13Stub from './R13Stub';

export default function StatutoryDesk(props: MfDeskProps) {
  return <R13Stub desk={props.view ? `statutory:${props.view}` : 'statutory'} />;
}
