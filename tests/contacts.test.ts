import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import {
  addShipToAddressBook, addressToShipTo, attentionText, clientsCsv, contactSearchFields, contactToAttention, defaultShipTo, mergeImported,
  normalizeAddresses, normalizeContacts, partyRecipients, primaryContact, setDefaultShipTo, setPrimary,
} from '../src/lib/contacts.ts';
import { clientExtras, suggest } from '../src/lib/suggest.ts';
import { buildPreview, createLocalSink } from '../src/lib/importers.ts';
import { guessMapping } from '../src/lib/import-mapping.ts';
import { parseTable } from '../src/lib/csv.ts';
import { localDb } from '../src/lib/localDb.ts';
import type { Client, InvoiceRecord } from '../src/types/invoice.ts';

const party = (over: Partial<Client> = {}): Client => ({
  id: 'c1', name: 'Tata Motors', company: 'Tata Motors Ltd', email: 'ap@tata.example', address: 'Pimpri', city: 'Pune', zip: '411018', state_code: '27',
  contacts: [
    { id: 'k1', name: 'R. Iyer', role: 'Accounts', phone: '98200 11111', email: 'iyer@tata.example', statements: true },
    { id: 'k2', name: 'S. Rao', role: 'Purchase', phone: '98200 22222', primary: true },
  ],
  addresses: [
    { id: 'a1', label: 'Plant 2 — Chakan', address: 'Plot 7, MIDC', city: 'Chakan', zip: '410501', state_code: '27' },
    { id: 'a2', label: 'Sanand', address: 'GIDC', city: 'Sanand', zip: '382110', gstin: '24AAACT2727Q1ZV', default_ship_to: true },
  ],
  ...over,
});

test('contacts: blank names dropped, at most one primary; primary falls back to the first', () => {
  const list = normalizeContacts([{ name: ' A ', primary: true }, { name: '' }, { name: 'B', primary: true, email: ' b@x.in ' }]);
  assert.deepEqual(list.map((c) => [c.name, !!c.primary, c.email]), [['A', true, undefined], ['B', false, 'b@x.in']]);
  assert.equal(primaryContact(party())?.name, 'S. Rao');
  assert.equal(primaryContact({ contacts: [{ id: 'x', name: 'Only' }] })?.name, 'Only');
  assert.deepEqual(setPrimary(party().contacts!, 'k1').map((c) => !!c.primary), [true, false]);
});

test('addresses: default ship-to, state code from the unit GSTIN → place of supply', () => {
  const p = party();
  const def = defaultShipTo(p)!;
  assert.equal(def.label, 'Sanand');
  const ship = addressToShipTo(def, p);
  assert.deepEqual(ship, { name: 'Tata Motors Ltd', address: 'GIDC', city: 'Sanand', zip: '382110', state_code: '24', gstin: '24AAACT2727Q1ZV' });
  const norm = normalizeAddresses([{ label: '', address: 'Line one\nLine two', gstin: '29aaacb1234c1zv', default_ship_to: true }, { label: 'B', default_ship_to: true }]);
  assert.equal(norm[0].label, 'Line one');
  assert.equal(norm[0].state_code, '29');
  assert.deepEqual(norm.map((a) => !!a.default_ship_to), [true, false]);
  assert.deepEqual(setDefaultShipTo(p.addresses!, 'a1').map((a) => !!a.default_ship_to), [true, false]);
  const added = addShipToAddressBook(p, { address: 'New godown', city: 'Nashik', state_code: '27' });
  assert.equal(added.added, true);
  assert.equal(added.addresses.length, 3);
  assert.equal(addShipToAddressBook(p, { address: 'plot 7,  midc', zip: '410501' }).added, false, 'same address is not added twice');
});

test('Kind attn. snapshot and recipients for reminders', () => {
  const att = contactToAttention(party().contacts![0]);
  assert.deepEqual(att, { name: 'R. Iyer', role: 'Accounts', phone: '98200 11111', email: 'iyer@tata.example' });
  assert.equal(attentionText(att), 'R. Iyer, Accounts');
  assert.equal(attentionText(undefined), '');
  assert.deepEqual(partyRecipients(party()).map((r) => r.name), ['R. Iyer']);
  assert.deepEqual(partyRecipients(party({ contacts: [{ id: 'z', name: 'P', primary: true, phone: '1' }] })).map((r) => r.name), ['P']);
  assert.deepEqual(partyRecipients(party({ contacts: [] })), [{ name: 'Tata Motors', email: 'ap@tata.example' }]);
});

test('typeahead matches contact names and phones', () => {
  const rows = [party(), party({ id: 'c2', name: 'Bajaj Auto', contacts: [], company: '' })];
  assert.ok(contactSearchFields(party()).includes('9820011111'));
  const hit = suggest<Client>('Iyer', rows, { label: (c) => c.name, extra: clientExtras });
  assert.equal(hit[0]?.row.id, 'c1');
  const byPhone = suggest<Client>('9820022222', rows, { label: (c) => c.name, extra: clientExtras });
  assert.equal(byPhone[0]?.row.id, 'c1');
});

test('client CSV round-trip carries the first contact and address', () => {
  resetStorage();
  const csv = clientsCsv([party()]);
  assert.match(csv, /contact_name,contact_role/);
  assert.match(csv, /S\. Rao,Purchase/);
  const table = parseTable(csv);
  const { mapping } = guessMapping('clients', table.headers, table.rows);
  assert.equal(table.headers[mapping.contact_name!], 'contact_name');
  assert.equal(table.headers[mapping.phone!], 'Phone');
  const preview = buildPreview({ kind: 'clients', table, mapping, existing: { clients: [], items: [], invoices: [] } });
  const rec = preview.rows[0].record as Client;
  assert.equal(rec.contacts?.[0].name, 'S. Rao');
  assert.equal(rec.contacts?.[0].primary, true);
  assert.equal(rec.addresses?.[0].label, 'Sanand');
  assert.equal(rec.addresses?.[0].state_code, '24');
  // Importing again onto an existing party adds, never replaces.
  localDb.clients.upsert({ ...party(), addresses: [party().addresses![0]], contacts: [party().contacts![0]] });
  const id = localDb.clients.getAll()[0].id!;
  createLocalSink().clients([{ record: rec, matchId: id }]);
  const saved = localDb.clients.getById(id)!;
  assert.deepEqual(saved.contacts!.map((c) => c.name), ['R. Iyer', 'S. Rao']);
  assert.equal(saved.addresses!.length, 2);
  assert.deepEqual(mergeImported(undefined, {}), {});
});

test('a document keeps its attention snapshot when the contact is edited later (Critical Rule 3)', () => {
  resetStorage();
  localDb.clients.upsert(party());
  const inv = {
    id: 'i1', invoice_number: 'INV/FY26-27/0001', doc_type: 'TAX_INVOICE', issue_date: '2026-06-01', due_date: '2026-06-15', status: 'Sent', currency: 'INR', template_id: 't',
    client: { name: 'Tata Motors', email: '', address: '', city: '', zip: '' }, sender: null, items: [{ id: 'l', name: 'X', type: 'goods', quantity: 1, rate: 10, amount: 10 }],
    gst_mode: 'NONE', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false,
    amount_paid: 0, notes: '', terms: '', subtotal: 10, discount_amount: 0, taxable_value: 10, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, tax_amount: 0, round_off: 0, total: 10, balance_due: 10,
    attention: contactToAttention(party().contacts![0]),
  } as InvoiceRecord;
  localDb.invoices.save(inv);
  const master = localDb.clients.getAll()[0];
  localDb.clients.upsert({ ...master, contacts: [{ ...master.contacts![0], name: 'R. Iyer (moved)', role: 'Finance' }] });
  assert.equal(attentionText(localDb.invoices.getById('i1')!.attention), 'R. Iyer, Accounts');
  // The invoice's client snapshot never carries the address book back into the master.
  assert.equal(localDb.invoices.getById('i1')!.client.contacts, undefined);
  assert.equal(localDb.clients.getAll()[0].contacts![0].name, 'R. Iyer (moved)');
});

test('templates print Kind attn. in the party block of every layout (incl. GST)', () => {
  const src = (f: string) => readFileSync(new URL(`../src/components/templates/parts/${f}`, import.meta.url), 'utf8');
  assert.match(src('PartyPanel.tsx'), /<AttentionLine invoice=\{invoice\} \/>/);
  assert.match(src('GstBody.tsx'), /<AttentionLine invoice=\{invoice\} \/>/);
  assert.match(src('AttentionLine.tsx'), /Kind attn\./);
});
