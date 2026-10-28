/**
 * R18-C3 society reminders: the template set never threatens to withhold a common service or amenity — water,
 * electricity / power, lift, access, parking, gas, disconnection (KA Bill s.20(6) proviso, HS33) — in English or
 * Hinglish; it uses only known placeholders, covers every scheduled stage, and goes into the R2-A5 schedule.
 */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOCIETY_TEMPLATES } from '../src/lib/society/hs-reminders.ts';
import { SCHEDULED_STAGES } from '../src/lib/reminders.ts';
import { unknownPlaceholders } from '../src/lib/reminder-schedule.ts';
import { applySocietyWording } from '../src/lib/society/hs-dues-io.ts';
import { loadReminderSchedule } from '../src/lib/reminder-settings.ts';

const THREAT = /water|paani|pani|jal|electric|power|bijli|light|lift|elevator|access|entry|gate|parking|gas|supply|disconnect|cut[ -]?off|band kar|kaat|withh?old|stop|amenit|service|facilit/i;

test('no template threatens an essential service (KA s.20(6), HS33)', () => {
  for (const lang of ['en', 'hinglish'] as const) for (const st of SCHEDULED_STAGES) {
    const t = SOCIETY_TEMPLATES[lang]![st]!;
    assert.ok(t?.subject && t.body, `${lang} ${st}`);
    assert.doesNotMatch(`${t.subject}\n${t.body}`, THREAT, `${lang} ${st}`);
    assert.deepEqual(unknownPlaceholders(`${t.subject} ${t.body}`), [], `${lang} ${st}`);
  }
});

test('"Use society reminder wording" stores the set in the company reminder schedule', () => {
  applySocietyWording();
  assert.deepEqual(loadReminderSchedule().templates?.en?.overdue_firm, SOCIETY_TEMPLATES.en!.overdue_firm);
});
