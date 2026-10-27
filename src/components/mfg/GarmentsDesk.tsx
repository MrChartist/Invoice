/** R13 GarmentsDesk (`/manufacturing?tab=garments&view=`): a stub until its package replaces this file (same default export and props). */
import type { MfDeskProps } from './desk-props';
import R13Stub from './R13Stub';

export default function GarmentsDesk(props: MfDeskProps) {
  return <R13Stub desk={props.view ? `garments:${props.view}` : 'garments'} />;
}
