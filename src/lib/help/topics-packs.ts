/** R6-A2 help topics: every industry-pack tab (`PACK_TABS`), lazy. Working papers — verify with your CA. */
import { ca, rel, t, type HelpTopic } from './types';

export const TOPICS: readonly HelpTopic[] = [
  t('receivables:marketplace', 'Marketplace', 'मार्केटप्लेस', 'Marketplace seller pack: sales channels, order import, settlements, GST TCS and returns.', 'Each settlement cycle.', {
    statutory: ca(['I1', 'I3', 'I4', 'I5']),
    related: rel(['Channels', '/receivables?tab=marketplace&view=channels'], ['Settlements', '/receivables?tab=marketplace&view=settlements']),
  }),
  t('receivables:marketplace:channels', 'Channels', 'चैनल', 'Each marketplace with its GSTIN, fee heads and SKU mapping.', 'Once per marketplace.', { statutory: ca(['I7', 'I8']) }),
  t('receivables:marketplace:import', 'Order import', 'ऑर्डर इम्पोर्ट', 'Import marketplace order reports as invoices or day summaries.', 'Daily or weekly.', { statutory: ca(['I1', 'I2', 'I3']) }),
  t('receivables:marketplace:settlements', 'Settlements', 'सेटलमेंट', 'Payout statements matched to orders, fees, TCS and refunds.', 'When the marketplace pays out.', { statutory: ca(['I4', 'I7']) }),
  t('receivables:marketplace:tcs', 'GST TCS', 'GST TCS', 'TCS collected by operators, to match with what the portal shows.', 'Monthly, before claiming the credit.', { statutory: ca(['I4', 'I5']) }),
  t('receivables:marketplace:returns', 'Returns', 'वापसी', 'Customer returns and RTO, with claims and credit notes.', 'When goods come back.', { statutory: ca(['I6', 'I9']) }),
  t('recurring:fees', 'Fees', 'फ़ीस', 'Fee plans for students or patients, billed by instalment.', 'Each term or month.', { statutory: ca(['I20', 'I21']) }),
  t('recurring:leases', 'Leases', 'लीज़', 'Rent, CAM and escalation per lease, billed every month.', 'Monthly rent billing.', { statutory: ca(['I28', 'I29', 'I30']) }),
  t('receivables:donations', 'Donations', 'दान', 'Donation receipts with 80G / 35 details and Form 10BD / 10BE.', 'When a donation comes in; yearly for 10BD.', { statutory: ca(['I23', 'I24', 'I25'], '10BD, 10BE') }),
  t('books:funds', 'Funds', 'फ़ंड', 'Fund-wise income and spending, FCRA accounts and Sec 11 application.', 'Monthly and at year end.', { statutory: ca(['I26', 'I27'], 'FC-4') }),
  t('gst-reports:common-credit', 'Common credit (Rule 42 / 43)', 'साझा क्रेडिट (Rule 42 / 43)', 'Splits ITC used for both taxable and exempt supplies and posts the reversal to GSTR-3B 4(B)(1).', 'Monthly, and again at year end.', { statutory: ca(['I22'], 'GSTR-3B 4(B)(1)') }),
  t('distribution:transport', 'Transport', 'ट्रांसपोर्ट', 'Transport (GTA) pack: consignment notes (LR / bilty), trips and vehicles.', 'Each booking.', {
    statutory: ca(['I10', 'I11', 'I12', 'I13']),
    related: rel(['Trips', '/distribution?tab=transport&view=trips'], ['Vehicles', '/distribution?tab=transport&view=vehicles']),
  }),
  t('distribution:transport:trips', 'Trips', 'ट्रिप', 'Trip sheets: LRs carried, lorry hire, expenses and driver advances.', 'Each trip.', { statutory: ca(['I14']) }),
  t('distribution:transport:vehicles', 'Vehicles', 'वाहन', 'Vehicles with permit, fitness and insurance dates.', 'When a vehicle is added or a document renews.'),
  t('time:works', 'Works', 'वर्क्स', 'Works-contract pack: BOQ, measured RA bills, retention and deductions.', 'Each running-account bill.', { statutory: ca(['I15', 'I16', 'I17', 'I18', 'I19']) }),
  t('time:works:retention', 'Retention', 'रिटेंशन', 'Retention money held by clients and when it is due back.', 'When retention is released.', { statutory: ca(['I16']) }),
  t('time:works:sites', 'Sites', 'साइट', 'Sites with material issued against the theoretical use per BOQ unit.', 'Weekly on site.'),
  // R7 hotel (R7-A minimal topics; R7-C extends them with the HT ids)
  t('tables:frontdesk', 'Front desk', 'फ्रंट डेस्क', 'Hotel pack board: arrivals, in-house guests, due-outs and room status for the business date.', 'All day at the front desk.', {
    related: rel(['Room calendar', '/tables?tab=frontdesk&view=calendar'], ['Night audit', '/tables?tab=frontdesk&view=audit']),
  }),
  t('tables:frontdesk:calendar', 'Room calendar', 'रूम कैलेंडर', 'Rooms by date: bookings as bars; tap an empty cell to book that room.', 'When a guest asks what is free.'),
  t('tables:frontdesk:reservations', 'Reservations', 'बुकिंग', 'Bookings with nightly prices, advances and the confirmation message; arrivals, departures and in-house lists.', 'For every booking, change or cancellation.'),
  t('tables:frontdesk:folios', 'Folios', 'फ़ोलियो', 'Running accounts of in-house guests and companies. A folio is not a tax invoice.', 'Before check-out.'),
  t('tables:frontdesk:housekeeping', 'Housekeeping', 'हाउसकीपिंग', 'Room status by floor: clean, dirty, inspected, out of order.', 'After check-outs and through the day.'),
  t('tables:frontdesk:audit', 'Night audit', 'नाइट ऑडिट', 'Closes the business date: posts room nights once, lists no-shows and due-outs, and keeps occupancy, ADR and RevPAR.', 'Every night.'),
  t('tables:frontdesk:guests', 'Guest register', 'गेस्ट रजिस्टर', 'Police / guest register with masked ID numbers, printable and as CSV.', 'When the register is asked for.', { statutory: ca() }),
  t('tables:frontdesk:formc', 'Form C', 'फ़ॉर्म C', 'Foreign guests whose Form C must be filed on the Bureau of Immigration site.', 'Within the deadline after a foreign guest checks in.', { statutory: ca() }),
  t('tables:frontdesk:reports', 'Hotel reports', 'होटल रिपोर्ट', 'Occupancy, ADR, RevPAR, source mix and the guest and city ledgers.', 'Month end.'),
  t('tables:frontdesk:setup', 'Rooms & rates', 'कमरे और रेट', 'Room types, rooms, rate plans (EP / CP / MAP / AP, weekend, seasons) and hotel settings.', 'Once, and when rates change.'),
];
