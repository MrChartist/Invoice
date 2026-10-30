/** R14: a from / to period (this month by default) with its two date fields, for the WIP desk's reports. */
import { useState } from 'react';
import { todayInput } from '../../lib/utils';
import { psT } from '../../i18n/areas/prof-r14-common';
import controls from '../../styles/controls.module.css';
import { Field } from './ps-ui';
import { DateField } from '../ui/DateField';

export function usePeriod() {
  const [from, setFrom] = useState(() => `${todayInput().slice(0, 8)}01`);
  const [to, setTo] = useState(todayInput);
  const inputs = (
    <>
      <Field label={psT('from')}><DateField className={controls.input} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label={psT('to')}><DateField className={controls.input} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
    </>
  );
  return { from, to, inputs };
}
