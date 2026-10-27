/** R13 FoodDesk (`/manufacturing?tab=food&view=`): a stub until its package replaces this file (same default export and props). */
import type { MfDeskProps } from './desk-props';
import R13Stub from './R13Stub';

export default function FoodDesk(props: MfDeskProps) {
  return <R13Stub desk={props.view ? `food:${props.view}` : 'food'} />;
}
