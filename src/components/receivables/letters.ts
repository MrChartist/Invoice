/** Browser helpers for confirmation-of-accounts letters (WP-4); the model + HTML are pure in `lib/confirmation-letter.ts`. */
import type { PartyReceivable } from '../../lib/receivables';
import { buildConfirmationLetter, confirmationLettersHtml } from '../../lib/confirmation-letter';
import { printHtmlDocument } from '../../lib/voucher-print';
import { downloadText } from '../../lib/download';
import { todayInput } from '../../lib/utils';
import type { Client, SenderProfile } from '../../types/invoice';

export function clientFor(party: PartyReceivable, clients: readonly Client[]): Client | undefined {
  return clients.find((c) => (party.clientId && c.id === party.clientId) || c.name?.trim().toLowerCase() === party.name.trim().toLowerCase());
}

/** Print confirmation-of-accounts letters (one per page) in a script-free window; a blocked pop-up downloads the HTML. */
export function printConfirmationLetters(parties: readonly PartyReceivable[], clients: readonly Client[], sender: SenderProfile | null, from: string, to: string, currency: string): void {
  const letters = parties.map((p) => buildConfirmationLetter(p, from, to, { client: clientFor(p, clients), currency }));
  const html = confirmationLettersHtml(letters, sender, todayInput());
  printHtmlDocument(html, (h) => downloadText(`Confirmation_of_accounts_${to || todayInput()}.html`, h, 'text/html'));
}
