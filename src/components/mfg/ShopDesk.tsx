/** R13 ShopDesk (`/manufacturing?tab=shop&view=`): a stub until its package replaces this file (same default export and props). */
import type { MfDeskProps } from './desk-props';
import R13Stub from './R13Stub';

export default function ShopDesk(props: MfDeskProps) {
  return <R13Stub desk={props.view ? `shop:${props.view}` : 'shop'} />;
}
