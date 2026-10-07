# Recurring invoices (subscriptions / retainers)

## Summary
Schedules that generate invoices automatically (weekly, monthly, quarterly, half-yearly, yearly, every N days). Generation happens on app start and tab focus; missed occurrences are caught up (max 12, oldest overflow counted as skipped). Fully local, idempotent.

- Route: `/recurring` (page `Recurring`, named export from `src/pages/Recurring.tsx`; also accepts `?from=<invoiceId>` to open the create modal prefilled, or prop `fromInvoiceId`)
- Nav label: **Recurring**, suggested lucide icon: `Repeat`
- Table: `recurring` (via `getTable/setTable`, key `mrchartist_inv_recurring`)
- Additive fields stamped on generated invoices: `recurring_id`, `recurring_date` (used for idempotency; harmless to other code)

## Files
- `src/lib/recurring.ts` — pure date math + schedule logic + storage helpers
- `src/hooks/useRecurringRunner.ts` — `useRecurringRunner(): { generated: InvoiceRecord[]; dismiss(); message: string }`
- `src/pages/Recurring.tsx` (+ `.module.css`)
- `src/components/recurring/` — `RecurringButton`, `RecurringEditor`, `ScheduleCard`, `index.ts`
- `tests/recurring.test.ts`

## Exported symbols (lib)
`Frequency`, `RecurringSchedule`, `RecurringTemplate`, `RecurringHistoryEntry`, `addDays`, `addMonths` (month-end clamping), `occurrenceDate`, `nextOccurrence`, `firstOccurrenceOnOrAfter`, `previewOccurrences`, `dueRuns`, `dueRunsDetailed`, `scheduleStatus`, `isEnded`, `createSchedule`, `templateFromInvoice`, `templateTotals`, `monthlyValue`, `buildInvoiceFromSchedule` (pure), `generateInvoiceFromSchedule`, `runDueSchedules(today)`, `runNow`, `pauseSchedule`, `resumeSchedule` (no back-fill), `skipNext`, `stopSchedule`, `recurringDb`, `recurringToastMessage`, `describeFrequency`, `applyTokens`.

Item names / notes / terms support `{month}`, `{mon}`, `{year}`, `{period}`, `{date}` tokens, replaced per occurrence.

## Components
- `RecurringButton` props: `{ invoice: InvoiceRecord; className?: string; onCreated?(s: RecurringSchedule): void }` — outline "Make recurring" button; owns its modal and toast. Works with unsaved invoices.
- `RecurringEditor` props: `{ open; onClose; schedule?; fromInvoiceId?; sourceInvoice?; onSaved(s) }`.

## Wiring the lead must add

Route (`src/App.tsx`):
```tsx
import { Recurring } from './pages/Recurring';
// inside the protected routes:
<Route path="/recurring" element={<Recurring />} />
```

Nav (`src/layouts/DashboardLayout.tsx`):
```tsx
import { Repeat } from 'lucide-react';
{ to: '/recurring', label: 'Recurring', icon: Repeat }
```

Runner + toast in the app shell (once, inside the Router, e.g. DashboardLayout):
```tsx
import { useRecurringRunner } from '../hooks/useRecurringRunner';
import { useToast } from '../components/ui/useToast';

const { generated, dismiss, message } = useRecurringRunner();
const { notify, toastNode } = useToast();
useEffect(() => {
  if (generated.length) { notify(message, 'info'); dismiss(); }
}, [generated, message, notify, dismiss]);
// render {toastNode}
```
(After generation, refresh any open ledger/dashboard list — they already reload on focus/mount.)

Cross-links:
```tsx
import { RecurringButton } from '../components/recurring';
<RecurringButton invoice={currentInvoiceRecord} />   // creator actions bar / ledger row (use a saved InvoiceRecord)
```
Ledger row alternative (no component): `<Link to={`/recurring?from=${inv.id}`}>Make recurring</Link>`.
Optional ledger badge: invoices with `(inv as {recurring_id?: string}).recurring_id` came from a schedule.

## Behaviour notes
- Idempotency: before creating, looks up an invoice with the same `recurring_id` + `recurring_date`; if found it is reused and the schedule is healed. A `navigator.locks` lock additionally serialises tabs.
- Numbering: `localDb.invoices.nextNumber(issueDate, doc_type)`, so a 1 Apr occurrence starts the new FY series (tested: 31 Mar vs 1 Apr). Date is passed as `T12:00:00` local to avoid UTC parsing shifting the FY in western timezones.
- Mode `draft` creates status Draft (with number); `issue` creates status Sent.
- Resume jumps `next_run` to the first occurrence on/after today (paused period is not back-filled). Skip-next and catch-up overflow increment `skipped_count`, which counts toward `max_runs`.
- Delete removes the schedule only; generated invoices stay.
