/** R7-A1 hotel pack: switch, shell wiring, registries for every hotel table, record keys, first-paint isolation. */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { PACK_TABS, activePacks, isPackOn } from '../src/lib/industry-packs.ts';
import { BUSINESS_DEFAULTS, PRESETS, applyBusinessType } from '../src/lib/shop-presets.ts';
import { enabledModules, impliedPacks, isPathVisible } from '../src/lib/shop-mode.ts';
import { HOTEL_SETTINGS_KEY, HOTEL_TABLES, hotelDb } from '../src/lib/hotel/hotel-store.ts';
import { BACKUP_RECORD_TABLES } from '../src/lib/backup.ts';
import { WATCHED_TABLES } from '../src/lib/audit-edits.ts';
import { TABLE_MEANING } from '../src/lib/trust/open-export-schema.ts';
import { requireTableWrite, setActorProvider } from '../src/lib/access.ts';
import { docNumberKey, touchesLock } from '../src/lib/sync-engine.ts';
import { DB_PREFIX, setReadTrace } from '../src/lib/storage.ts';
import { RECORD_KEYS } from '../src/store/useInvoiceStore.ts';
import { normalizeRecord } from '../src/store/invoice-defaults.ts';
import { PACK_FIRST_TABLE } from '../src/lib/checklist-steps.ts';
import { localDb } from '../src/lib/localDb.ts';

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
afterEach(() => setActorProvider(null));

test('type → pack; an explicit list (even empty) beats the type; existing companies unchanged', () => {
  assert.deepEqual(activePacks({ business_type: 'hotel' }), ['hotel']);
  assert.deepEqual(activePacks({ business_type: 'hotel', industry_packs: [] }), []);
  assert.equal(isPackOn({ industry_packs: ['hotel'] }, 'hotel'), true);
  assert.equal(isPackOn({ business_type: 'restaurant' }, 'hotel'), false);
  assert.deepEqual(impliedPacks({ business_type: 'hotel' }), ['hotel']);
  assert.equal(BUSINESS_DEFAULTS.hotel.landing, '/tables?tab=frontdesk');
  assert.ok(PRESETS.hotel.includes('pos'));
  assert.equal(PACK_FIRST_TABLE.hotel, 'hotel_reservations');
});

test('PACK_TABS hotel rows live on /tables; /tables stays visible for a hotel even with POS hidden', () => {
  const rows = PACK_TABS.filter((t) => t.pack === 'hotel');
  assert.ok(rows.length >= 10);
  for (const r of rows) assert.match(r.path, /^\/tables\?tab=frontdesk/);
  const hotel = applyBusinessType('hotel');
  assert.equal(isPathVisible('/tables', enabledModules(hotel), impliedPacks(hotel)), true);
  const noPos = { ...hotel, modules: PRESETS.hotel.filter((m) => m !== 'pos') };
  assert.equal(isPathVisible('/tables', enabledModules(noPos)), false);
  assert.equal(isPathVisible('/tables', enabledModules(noPos), impliedPacks(noPos)), true);
});

test('registries: every hotel table is backed up, edit-logged (recycle bin), role-guarded, described; RES numbered; dated for the lock', () => {
  assert.deepEqual([...HOTEL_TABLES].sort(), ['hotel_folios', 'hotel_guests', 'hotel_night_audits', 'hotel_rate_plans', 'hotel_reservations', 'hotel_room_types', 'hotel_rooms']);
  const backup = src('src/lib/backup.ts');
  for (const t of HOTEL_TABLES) {
    assert.ok(BACKUP_RECORD_TABLES.includes(t), `${t} backed up`);
    assert.equal(backup.split(`'${t}'`).length - 1, 2, `${t} in RECORD_TABLES and ID_TABLES`);
    assert.ok(WATCHED_TABLES[t], `${t} watched`);
    assert.ok(TABLE_MEANING[t], `${t} described`);
  }
  assert.ok(TABLE_MEANING.hotel_settings);
  setActorProvider(() => ({ id: 'v', name: 'V', role: 'viewer' }));
  for (const t of HOTEL_TABLES) assert.throws(() => requireTableWrite(t), /cannot/i, t);
  setActorProvider(() => ({ id: 'c', name: 'C', role: 'clerk' }));
  for (const t of ['hotel_reservations', 'hotel_folios', 'hotel_guests', 'hotel_night_audits']) assert.doesNotThrow(() => requireTableWrite(t), t);
  setActorProvider(null);
  assert.equal(docNumberKey(`${DB_PREFIX}hotel_reservations`, { number: 'RES/FY26-27/0001' }) !== '', true);
  for (const [t, f] of [['hotel_reservations', 'arrival'], ['hotel_folios', 'opened_on'], ['hotel_night_audits', 'business_date']]) {
    assert.equal(touchesLock('2026-06-30', `${DB_PREFIX}${t}`, null, { id: 'x', [f]: '2026-06-01' }), true, t);
    assert.equal(touchesLock('2026-06-30', `${DB_PREFIX}${t}`, null, { id: 'x', [f]: '2026-07-01' }), false, t);
  }
});

test('invoice record keys: folio_id, reservation_id, stay, hotel_band survive normalizeRecord', () => {
  for (const k of ['folio_id', 'reservation_id', 'stay', 'hotel_band'] as const) assert.ok((RECORD_KEYS as readonly string[]).includes(k), k);
  const stay = { arrival: '2026-10-20', departure: '2026-10-22', rooms: ['101'], nights: 2, adults: 2, children: 0 };
  const r = normalizeRecord({ id: 'i', folio_id: 'f', reservation_id: 'r', stay, hotel_band: 'mixed' });
  assert.deepEqual([r.folio_id, r.reservation_id, r.stay, r.hotel_band], ['f', 'r', stay, 'mixed']);
  assert.equal('folio_id' in normalizeRecord({ id: 'j' }), false, 'absent for ordinary invoices');
});

test('starter masters show until the first save; settings default (business date = today until the first audit)', () => {
  resetStorage();
  installSettings({ industry_packs: ['hotel'] } as never);
  assert.equal(hotelDb.rooms().length, 10);
  assert.equal(hotelDb.roomTypes()[0].name, 'Standard');
  const s = hotelDb.settings();
  assert.deepEqual([s.checkin_time, s.checkout_time, s.sac_room, s.sac_fnb, s.interim_days, s.interim_year_end], ['12:00', '11:00', '996311', '996331', 30, true]);
  assert.match(s.business_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(HOTEL_SETTINGS_KEY, 'mrchartist_inv_hotel_settings');
});

test('/tables without tab=frontdesk never loads hotel code; first-paint files never import it', () => {
  const tables = src('src/pages/Tables.tsx').replace(/^import type [^;]*;/gm, '');
  assert.ok(!/^import [^;]*(components\/hotel|lib\/hotel)/m.test(tables), 'no static hotel import in Tables.tsx');
  assert.match(tables, /lazy\(\(\) => import\('\.\.\/components\/hotel\/FrontDesk'\)\)/);
  assert.match(tables, /params\.get\('tab'\) === 'frontdesk'/);
  for (const f of ['src/main.tsx', 'src/App.tsx', 'src/layouts/DashboardLayout.tsx', 'src/pages/Dashboard.tsx', 'src/store/useInvoiceStore.ts', 'src/store/invoice-defaults.ts', 'src/components/command/NotificationBell.tsx']) {
    const text = src(f).replace(/^import type [^;]*;/gm, '');
    assert.ok(!/^import [^;]*(lib\/hotel|components\/hotel|hotel-rules)/m.test(text), f);
  }
  assert.ok(!/ACCOMMODATION_RATE_RULES/.test(src('src/lib/tax-rules.ts')), 'hotel rules stay out of first-paint tax-rules.ts');
});

test('pack off: the floor’s pack check reads settings only — no hotel table', () => {
  resetStorage();
  installSettings({ industry_packs: [] } as never);
  const seen = new Set<string>();
  const prev = setReadTrace(seen);
  try {
    assert.equal(isPackOn(localDb.settings.get(), 'hotel'), false);
  } finally {
    setReadTrace(prev);
  }
  assert.ok(![...seen].some((k) => k.includes('hotel_')));
});
