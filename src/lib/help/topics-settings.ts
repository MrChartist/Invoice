/** R6-A2 help topics: Settings and its tabs (lazy). */
import { rel, t, type HelpTopic } from './types';

export const TOPICS: readonly HelpTopic[] = [
  t('settings', 'Settings', 'सेटिंग्स', 'Your business profiles, items, custom fields, defaults, data and backups, activity log and security.', 'Once at start, then when something changes.', {
    related: rel(['Business', '/settings?tab=business'], ['Data & backup', '/settings?tab=data']),
  }),
  t('settings:business', 'Business', 'कारोबार', 'Business profiles: name, GSTIN, address, bank and UPI, logo and signature. Saved invoices keep their own copy.', 'At start, and when your details change.', {
    steps: ['Fill name, GSTIN and state.', 'Add UPI or bank details so invoices carry a pay link / QR.'],
  }),
  t('settings:items', 'Items', 'आइटम', 'The item catalogue: name, HSN / SAC, rate and GST rate used in the editor.', 'Before billing, or when prices change.'),
  t('settings:fields', 'Custom fields', 'कस्टम फ़ील्ड', 'Extra fields on invoices and clients (PO number, vehicle, site …).', 'When your documents need more fields.'),
  t('settings:defaults', 'Defaults', 'डिफ़ॉल्ट', 'Numbering, terms, notes, business type, packs and "Show all features".', 'Once, then rarely.'),
  t('settings:data', 'Data & backup', 'डेटा और बैकअप', 'Backup and restore, automatic backups, imports, folder sync and storage health.', 'Take a backup every week, and before trying something new.', {
    steps: ['Download backup (or an encrypted one) and keep the file safe.', 'Restore brings everything back exactly.'],
  }),
  t('settings:activity', 'Activity', 'गतिविधि', 'The edit log: who changed what and when.', 'To check a change.'),
  t('settings:security', 'Security', 'सुरक्षा', 'PIN, idle lock, local users and roles, and vault encryption.', 'At start, and when someone else uses the device.'),
];
