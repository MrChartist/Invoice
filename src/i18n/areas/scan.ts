/** Barcode scan box and camera scanner (POS and the invoice editor). */
import { defineArea } from '../area';

export const scanT = defineArea(
  {
    placeholder: 'Scan or type a barcode / SKU, then Enter',
    noCamera: 'Camera scanning needs a browser with barcode detection (Chrome or Edge on Android, ChromeOS, macOS). Use a USB scanner or type the code.',
    withCamera: 'Scan with camera',
    camera: 'Camera',
    sub: 'Hold the barcode inside the frame',
    done: 'Done',
    cancel: 'Cancel',
    refused: 'Camera access was refused. Allow the camera for this site in the browser settings, or use a USB scanner / type the code.',
    failed: 'The camera could not be started. Use a USB scanner or type the code instead.',
    preview: 'Camera preview',
    read: 'Read {code}',
    local: 'Nothing is uploaded — the image is read on this device.',
  } as const,
  {
    placeholder: 'बारकोड / SKU स्कैन करें या टाइप करें, फिर Enter',
    noCamera: 'कैमरे से स्कैन के लिए बारकोड पहचान वाला ब्राउज़र चाहिए (Android, ChromeOS, macOS पर Chrome या Edge)। USB स्कैनर इस्तेमाल करें या कोड टाइप करें।',
    withCamera: 'कैमरे से स्कैन करें',
    camera: 'कैमरा',
    sub: 'बारकोड को फ़्रेम के भीतर रखें',
    done: 'हो गया',
    cancel: 'रद्द करें',
    refused: 'कैमरे की अनुमति नहीं मिली। ब्राउज़र सेटिंग्स में इस साइट के लिए कैमरा चालू करें, या USB स्कैनर इस्तेमाल करें / कोड टाइप करें।',
    failed: 'कैमरा शुरू नहीं हो सका। USB स्कैनर इस्तेमाल करें या कोड टाइप करें।',
    preview: 'कैमरा प्रीव्यू',
    read: '{code} पढ़ा गया',
    local: 'कुछ भी अपलोड नहीं होता — तस्वीर इसी डिवाइस पर पढ़ी जाती है।',
  },
);
