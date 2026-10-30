/**
 * Round 14 PS-D small parts mounted outside the desks (Receivables → TDS chase panel, the editor's expected-TDS hint,
 * the practice board's Bill link) — English and Hindi. Kept apart from the desk areas so those pages load a few words only.
 */
import { defineArea } from '../area';

export const ptT = defineArea(
  {
    chase: 'Certificates to chase (Form 131 / 16A)',
    none: 'Nothing to chase.',
    client: 'Client',
    quarter: 'Quarter',
    due: 'Due by',
    tds: 'TDS',
    overdue: 'Overdue',
    letter: 'Letter',
    whatsapp: 'WhatsApp',
    email: 'Email',
    bill: 'Bill',
    notYet: 'TDS not expected yet: ₹{sofar} of ₹{limit} this year ({section}).',
    onBase: 'TDS expected u/s {section} at {rate}% on the fee base ₹{base} (GST and pure-agent recoveries out): ₹{amount}, verify with your CA.',
  } as const,
  {
    chase: 'माँगने वाले प्रमाणपत्र (फ़ॉर्म 131 / 16A)',
    none: 'माँगने को कुछ नहीं।',
    client: 'क्लाइंट',
    quarter: 'तिमाही',
    due: 'देय तारीख़',
    tds: 'TDS',
    overdue: 'देर हो गई',
    letter: 'पत्र',
    whatsapp: 'WhatsApp',
    email: 'ईमेल',
    bill: 'बिल',
    notYet: 'अभी TDS अपेक्षित नहीं: इस वर्ष ₹{limit} में से ₹{sofar} ({section})।',
    onBase: 'धारा {section} के तहत फ़ीस आधार ₹{base} पर {rate}% की दर से अपेक्षित TDS (GST और शुद्ध एजेंट प्रतिपूर्ति बाहर): ₹{amount}, अपने CA से जाँच लें।',
  },
);
