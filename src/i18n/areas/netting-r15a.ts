/** R15-A3: party netting (customer ↔ supplier set-off). */
import { defineArea } from '../area';

export const netT = defineArea(
  {
    title: 'Netting',
    open: 'Netting with {name}',
    none: 'No customer is also a supplier.',
    receivable: 'They owe you (open invoices)',
    payable: 'You owe them (open bills)',
    amount: 'Amount to set off',
    date: 'Date',
    rcm: 'Reverse-charge GST paid',
    post: 'Set off',
    done: 'Set off {amount}.',
    reverse: 'Reverse',
    reversed: 'Netting reversed.',
    note: 'No cash moves; GST / TDS untouched (verify with your CA).',
    link: 'Also customer',
    linkNone: '—',
  } as const,
  {
    title: 'आपसी समायोजन (नेटिंग)',
    open: '{name} के साथ नेटिंग',
    none: 'कोई ग्राहक आपूर्तिकर्ता नहीं है।',
    receivable: 'उन्हें देना है (खुले इनवॉइस)',
    payable: 'आपको देना है (खुले बिल)',
    amount: 'समायोजन राशि',
    date: 'तारीख़',
    rcm: 'रिवर्स चार्ज GST चुकाया',
    post: 'समायोजित करें',
    done: '{amount} समायोजित।',
    reverse: 'उलटें',
    reversed: 'नेटिंग उलटी गई।',
    note: 'नकद नहीं; GST / TDS पर असर नहीं (CA से जाँचें)।',
    link: 'ग्राहक भी',
    linkNone: '—',
  },
);
