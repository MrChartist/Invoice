/** R6-A2 help topics: Dashboard, invoices, the editor, clients, receivables, recurring, time, POS and tables (lazy). */
import { ca, rel, t, type HelpTopic } from './types';

export const TOPICS: readonly HelpTopic[] = [
  t('dashboard', 'Dashboard', 'डैशबोर्ड', "Today's position: sales, money due, quick actions and the setup checklist.", 'Start here each day; the tiles follow your business type.', {
    steps: ['Use the quick-action row for a new invoice, money received, POS or an expense.', 'Work through "Get set up" — skip any step that does not apply.', 'Ctrl+K finds any screen, client or document.'],
    related: rel(['New invoice', '/invoice'], ['Receivables', '/receivables'], ['Settings', '/settings']),
  }),
  t('invoice', 'Invoice editor', 'इनवॉइस एडिटर', 'Create or edit a sales document: invoice, quotation, order, challan, credit / debit note.', 'Whenever you bill a customer. A saved invoice keeps a snapshot of your business details, so old invoices never change.', {
    steps: ['Pick or type the client; GST type follows their state.', 'Add lines from the catalogue or type them.', 'Save (Ctrl+S); Alt+R repeats the last bill.', 'Preview (Ctrl+P) to print, download the PDF or share.'],
    statutory: ca(['G2', 'G5', 'G12'], 'Tax invoice / bill of supply (Rule 46 / 49)'),
    related: rel(['All invoices', '/transactions'], ['Clients', '/clients']),
  }),
  t('transactions', 'Invoices', 'इनवॉइस सूची', 'Every sales document with its status, amount due and quick actions (payment, remind, duplicate, convert).', 'To find a document, record a payment or follow up.', {
    steps: ['Search by name, number or amount (try "> 5000").', 'Filter by type, status or date.', 'Use ₹ on a row to record a payment.'],
    related: rel(['Receivables', '/receivables'], ['New invoice', '/invoice']),
  }),
  t('clients', 'Clients', 'ग्राहक', 'Your customers with GSTIN, state, contacts, default terms and their balance.', 'Add a client before billing them, or open one to see their ledger and send a statement.', {
    steps: ['Add a client with GSTIN; the state fills in from it.', '₹ Received records a payment; Remind sends a WhatsApp / e-mail reminder.'],
    related: rel(['Receivables', '/receivables'], ['Statements', '/receivables?tab=statements']),
  }),
  t('receivables', 'Receivables', 'प्राप्य', 'Who owes you and since when: ageing, statements, follow-ups and collections.', 'Weekly, to chase overdue money.', { related: rel(['Ageing', '/receivables?tab=aging'], ['Follow-ups', '/receivables?tab=followups']) }),
  t('receivables:aging', 'Ageing', 'एजिंग', 'Outstanding by customer in 0–30 / 31–60 / 61–90 / 90+ day buckets. Netting (scales button) sets off a customer who is also your supplier.', 'To see which dues are getting old.'),
  t('receivables:statements', 'Statements', 'स्टेटमेंट', 'A statement of account per customer for a period, to print or share.', 'Month end, or when a customer asks for their balance.'),
  t('receivables:followups', 'Follow-ups', 'फ़ॉलो-अप', 'Reminders due today, promises to pay and notes per customer.', 'Daily, to work the collection list.'),
  t('receivables:collections', 'Collections', 'वसूली', 'Collection settings, payment terms, write-offs and recoveries.', 'When a debt will not be paid, or to set default terms.', { statutory: ca(['G9', 'T22', 'AC17']) }),
  t('receivables:advances', 'Advances', 'अग्रिम', 'Money received before the invoice, and how it is adjusted against later invoices.', 'When a customer pays in advance.', { statutory: ca(['G3', 'G4'], 'GSTR-1 Table 11A / 11B') }),
  t('receivables:tds', 'TDS by customers', 'ग्राहकों द्वारा TDS', 'TDS customers deducted from your receipts, to match with Form 26AS / AIS.', 'Quarterly, before your own income-tax working.', { statutory: ca(['T12'], '26AS / AIS') }),
  t('receivables:giftvouchers', 'Gift vouchers', 'गिफ़्ट वाउचर', 'Gift vouchers sold and redeemed, and what is still outstanding.', 'When you sell or redeem a voucher.', { statutory: ca(['G47', 'T23']) }),
  t('recurring', 'Recurring', 'आवर्ती', 'Schedules that create invoices on their own (rent, retainers, AMC).', 'For any bill you raise on a fixed cycle.', {
    steps: ['Create a schedule from a saved invoice.', 'Choose draft (numbered when issued) or auto-issue.'],
  }),
  t('recurring:schedules', 'Schedules', 'शेड्यूल', 'The list of recurring schedules with their next run date.', 'To pause, edit or run a schedule now.'),
  t('recurring:batch', 'Batch invoices', 'बैच इनवॉइस', 'Create many invoices at once from a list or a template.', 'Monthly bulk billing.'),
  t('time', 'Time & projects', 'समय और प्रोजेक्ट', 'Timesheets, mileage, projects, retainers and turning time into invoices.', 'For service work billed by the hour or by retainer.'),
  t('time:timesheet', 'Timesheet', 'टाइमशीट', 'Hours per client, project and task.', 'Daily or weekly time entry.'),
  t('time:mileage', 'Mileage', 'माइलेज', 'Travel distance to bill or reimburse.', 'After a client visit.'),
  t('time:billing', 'Billing', 'बिलिंग', 'Unbilled time and expenses, turned into an invoice.', 'At the end of a billing period.', { statutory: ca(['G7', 'T25']) }),
  t('time:projects', 'Projects', 'प्रोजेक्ट', 'Projects with budgets, tasks and progress.', 'When work runs over weeks.'),
  t('time:retainers', 'Retainers', 'रिटेनर', 'Fixed monthly fees with included hours and overage.', 'For retainer clients.', { statutory: ca(['T26']) }),
  t('time:settings', 'Time settings', 'समय सेटिंग', 'Rates, rounding and work types.', 'Once, when you start tracking time.'),
  t('pos', 'POS counter', 'POS काउंटर', 'Fast counter billing with barcode, held bills and cash / UPI tender.', 'At the shop counter.', {
    steps: ['Scan or type the item.', 'F9 saves the bill; F1 recalls held bills.', 'Alt+P opens POS from anywhere.'],
    statutory: ca(['G12']),
  }),
  t('tables', 'Tables & KOT', 'टेबल और KOT', 'Restaurant floor: tables, running orders and kitchen order tickets.', 'During service.', { statutory: ca(['I31', 'I32', 'I33']) }),
  t('order-pad', 'Order pad', 'ऑर्डर पैड', "A salesman's offline order list that becomes sales orders.", 'On the beat, without a connection.'),
  t('pos-display', 'Customer display', 'ग्राहक डिस्प्ले', 'A second screen showing the customer their bill at the counter.', 'Open it on a second monitor or tablet.'),
  t('share-target', 'Shared to the app', 'ऐप में साझा', 'Files shared to the app from another app land here (bills, photos).', 'After you share a file to Mr. Chartist Invoice.'),
  t('design', 'Design Studio', 'डिज़ाइन स्टूडियो', 'Change the look of your invoices: template, colours, fonts and layout.', 'Once, then whenever you want a new look.', { related: rel(['New invoice', '/invoice']) }),
  // R8-A (TR-A4; topic written by TR-C)
  t('receivables:interest', 'Interest', 'ब्याज', 'Interest on overdue bills for every party, and one interest invoice per party in a single run.', 'Month end.', { statutory: ca(['G6', 'TR18']) }),
  // R9 (RT-A3)
  t('receivables:deliveries', 'Deliveries', 'डिलीवरी', 'Home-delivery and phone orders by status and rider, the run sheet, cash on delivery collected by riders and the rider\'s cash settlement.', 'Through the day; settle each rider at night.', {
    steps: ['On the POS bill, tick Home delivery and fill the address and rider.', 'Move the order: packed, out for delivery, delivered.', 'Delivered with cash on delivery records the rider\'s cash.', 'At night, settle the rider: count the cash, any shortage goes to a ledger you pick.'],
    statutory: ca(['RT6']),
  }),
];
