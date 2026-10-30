/** MF-C5 Rule 89(5) working-paper strings (English + Hindi), loaded only with its lazy view. */
import { defineArea } from '../area';

export const iT = defineArea({
  title: 'Inverted-duty refund: Rule 89(5) working paper', from: 'From', to: 'To', rates: 'Inverted output rates',
  inverted: 'Turnover of inverted rated supply', att: 'Adjusted total turnover', netItc: 'Net ITC (inputs only)', availed: 'ITC availed (inputs + input services)', tax: 'Tax payable on inverted supply',
  first: 'Turnover × net ITC ÷ ATT', second: 'Less: tax payable share', refund: 'Maximum refund',
  exclude: 'Leave documents out ({n})', prefill: 'Pre-fill a draft refund claim', prefilled: 'Draft inverted-duty claim added to the refund register.',
} as const, {
  title: 'इनवर्टेड ड्यूटी रिफ़ंड: नियम 89(5) कार्य-पत्र', from: 'से', to: 'तक', rates: 'इनवर्टेड आउटपुट दरें',
  inverted: 'इनवर्टेड दर वाली आपूर्ति का टर्नओवर', att: 'समायोजित कुल टर्नओवर', netItc: 'शुद्ध ITC (केवल इनपुट)', availed: 'लिया गया ITC (इनपुट + इनपुट सेवाएँ)', tax: 'इनवर्टेड आपूर्ति पर देय कर',
  first: 'टर्नओवर × शुद्ध ITC ÷ ATT', second: 'घटाएँ: देय कर का हिस्सा', refund: 'अधिकतम रिफ़ंड',
  exclude: 'दस्तावेज़ बाहर रखें ({n})', prefill: 'ड्राफ़्ट रिफ़ंड दावा भरें', prefilled: 'ड्राफ़्ट इनवर्टेड ड्यूटी दावा रिफ़ंड रजिस्टर में जोड़ा गया।',
});
