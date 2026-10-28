/**
 * R18-C3 society reminder wording (pure data; family `f-society`): one template set (English / Hinglish) for the
 * existing reminder schedule (R2-A5 `reminder_settings.templates`), applied from the Dues view. A reminder asks for the
 * maintenance dues and mentions interest under the bye-laws — it NEVER threatens to withhold any common service or
 * amenity of the building (KA Bill s.20(6) proviso, HS33); `tests/hs-reminders.test.ts` greps every text for those
 * words. The notice-board list carries unit and amount only (no phone numbers; DPDP minimisation).
 */
import type { ReminderTemplates } from '../reminders';

const sign = '\n\nRegards,\nManaging committee, {business}\n{phone}';
const en = (subject: string, ask: string) => ({ subject, body: `Dear {client},\n\nMaintenance bill {number} for {balance} ${ask}\n{upi_line}${sign}` });
const hi = (subject: string, ask: string) => ({ subject, body: `Namaste {client} ji,\n\nMaintenance bill {number} ({balance}) ${ask}\n{upi_line}\nDhanyavaad,\nManaging committee, {business}\n{phone}` });

export const SOCIETY_TEMPLATES: ReminderTemplates = {
  en: {
    upcoming: en('Maintenance bill {number} due on {due}', 'is due on {due} ({days}).'),
    due_today: en('Maintenance bill {number} is due today', 'is due today ({due}).'),
    overdue_polite: en('Reminder: maintenance bill {number}', 'was due on {due} ({days}). If you have paid, please share the reference with the office.'),
    overdue_firm: en('Maintenance dues outstanding: {balance}', 'was due on {due} and is {days}. Interest on arrears applies as per the bye-laws. Please pay within 7 days or speak to the treasurer.'),
    overdue_final: en('Final reminder: maintenance dues {balance}', 'is {days} despite earlier reminders. Interest on arrears applies as per the bye-laws, and the managing committee may take the dues up under the bye-laws. Please pay or meet the treasurer this week.'),
  },
  hinglish: {
    upcoming: hi('Maintenance bill {number} {due} ko due hai', '{due} ko due hai ({days}).'),
    due_today: hi('Maintenance bill {number} aaj due hai', 'aaj ({due}) due hai.'),
    overdue_polite: hi('Reminder: maintenance bill {number}', '{due} ko due tha ({days}). Payment ho gaya ho to office ko reference bhej dijiye.'),
    overdue_firm: hi('Maintenance baaki: {balance}', '{due} ko due tha, ab {days}. Bye-laws ke anusaar baaki par byaaj lagta hai. Kripya 7 din mein payment kijiye ya treasurer se baat kijiye.'),
    overdue_final: hi('Final reminder: maintenance baaki {balance}', 'pehle ke reminders ke baad bhi baaki hai ({days}). Bye-laws ke anusaar byaaj lagta hai aur managing committee bye-laws ke tahat aage kaarvaai kar sakti hai. Kripya is hafte payment kijiye.'),
  },
};
