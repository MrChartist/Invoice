/** 8I: "Scan bill" in the Expenses header — camera / photo / file chooser (English + Hindi). */
import { defineArea } from '../area';

export const bsT = defineArea(
  {
    scanBill: 'Scan bill',
    title: 'Scan a supplier bill',
    hint: 'An e-invoice QR fills a draft bill straight away; any other photo or PDF waits in the Inbox to become a bill or an expense. Nothing leaves this device.',
    camera: 'Scan e-invoice QR with the camera',
    photo: 'Take a photo of the bill',
    file: 'Choose a photo or PDF',
    noCamera: 'Live QR scanning needs Chrome / Edge on a secure page — take or choose a photo instead.',
    reading: 'Reading…',
    kept: 'Kept in the Inbox.',
  } as const,
  {
    scanBill: 'बिल स्कैन करें',
    title: 'सप्लायर बिल स्कैन करें',
    hint: 'e-Invoice QR से तुरंत ड्राफ़्ट बिल भर जाता है; कोई और फ़ोटो या PDF बिल या ख़र्च बनाने के लिए Inbox में रहता है। कुछ भी इस डिवाइस से बाहर नहीं जाता।',
    camera: 'कैमरे से e-Invoice QR स्कैन करें',
    photo: 'बिल की फ़ोटो लें',
    file: 'फ़ोटो या PDF चुनें',
    noCamera: 'लाइव QR स्कैन के लिए सुरक्षित पेज पर Chrome / Edge चाहिए — इसके बजाय फ़ोटो लें या चुनें।',
    reading: 'पढ़ा जा रहा है…',
    kept: 'Inbox में रखा गया।',
  },
);
