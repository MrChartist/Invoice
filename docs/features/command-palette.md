# Command palette, notifications and shortcuts

Module: `palette-notifications`. Keyboard-first navigation (Tally style), a
notification centre and a shortcuts overlay. Offline, localStorage only.

- Route: none (global overlays mounted once in the shell).
- Nav label: none. The bell and a "Search  Ctrl K" trigger go in the app header.
  Suggested icons: `Search` (palette trigger), `Bell` (already used by the bell), `Keyboard` (shortcuts link).

## Files

| File | Purpose |
| --- | --- |
| `src/lib/search.ts` | Pure fuzzy scorer, `searchAll`, recents |
| `src/lib/notifications.ts` | Provider registry, built-in providers, snooze/dismiss/read state |
| `src/hooks/useHotkeys.ts` | Declarative hotkeys, combo formatting, `GLOBAL_SHORTCUTS` |
| `src/components/command/CommandPalette.tsx` | Palette dialog |
| `src/components/command/NotificationBell.tsx` | Bell + popover |
| `src/components/command/ShortcutsOverlay.tsx` | `?` overlay |
| `tests/search.test.ts`, `tests/notifications.test.ts` | node:test suites |

## Exported symbols

`search.ts`: `fuzzyMatch(query, text)`, `searchAll(query, {perGroup, data, now})`,
`groupResults`, `numberSequence`, `matchNumberToken`, `fold`, `addRecent`,
`getRecentSearches`, `pushRecentSearch`, `clearRecentSearches`,
`RECENT_SEARCHES_KEY` (`mrchartist_inv_recent_searches`, at most 8), `DEFAULT_PAGES`,
types `SearchResult`, `SearchGroup`, `StaticEntry`.

Search behaviour: every whitespace-separated token must match (AND). Digit-only
tokens match a document number's trailing sequence numerically, so `0007`, `7`
and `inv 7` all find `INV/FY25-26/0007`. Invoices are matched on number, client
name/company, effective status and amount; clients on name, company, GSTIN, city;
catalogue items on name and HSN/SAC. Results carry `ranges` (half-open) for
highlighting the title.

`notifications.ts`: `registerNotificationProvider(fn)` (returns unregister),
`collectNotifications(ctx, providers?)`, `BUILTIN_PROVIDERS`, individual providers,
state helpers `markRead`, `markAllRead`, `snooze(states, id, 1|7, now)`, `dismiss`,
`applyState`, `pruneState`, `unreadCount`, storage helpers `loadNotifState`,
`saveNotifState`, `buildContext`, `loadVisibleNotifications`, `recordBackup`,
`getLastBackup`, and constants (`DUE_SOON_DAYS=3`, `STALE_DRAFT_DAYS=7`,
`BACKUP_STALE_DAYS=14`, `STORAGE_WARN_RATIO=0.8`, `LARGE_INVOICE_THRESHOLD=50000`).

A provider is `(ctx: NotificationContext) => AppNotification[]` where
`AppNotification = {id, severity: 'info'|'warning'|'critical', title, detail, href?, cta?, at}`.
Ids must be stable while the condition is unchanged. Built-in ids embed a
fingerprint (for example `overdue:<count>:<total>`), so a dismissed notice
returns when the situation changes.

`useHotkeys.ts`: `useHotkeys(map, enabled?)`, `formatCombo(combo)`, `parseCombo`,
`isApplePlatform`, `isReservedCombo`, `GLOBAL_SHORTCUTS`, type `ShortcutInfo`.
Combo syntax: `mod+k` (`mod` is Cmd on Apple, Ctrl elsewhere), `/`, `?`,
two-key sequences like `g d`. Combos without a modifier are ignored while typing
in inputs. `mod+s` and `mod+p` are refused on purpose (the invoice editor owns them).

## Props

```ts
interface PaletteAction { id: string; title: string; subtitle?: string; icon?: ReactNode;
  keywords?: string[]; shortcut?: string; run: () => void }
interface PaletteNavItem { label: string; to: string; icon?: LucideIcon-like; keywords?: string[] }

<CommandPalette open onClose navItems?: PaletteNavItem[] actions?: PaletteAction[] onNavigate(href) />
<NotificationBell onNavigate(href) pollMs?=60000 className? />
<ShortcutsOverlay open onClose extra?: ShortcutInfo[] />
```

## Tables and keys

- `notif_state` table (`mrchartist_inv_notif_state`): `{id, dismissed_until?, read_at?}`.
  Rows for notifications that no longer exist are pruned automatically.
- `mrchartist_inv_recent_searches`: JSON string array, newest first, max 8.
- `mrchartist_inv_last_backup`: ISO string. READ by the backup provider.
  The lead must write it after a successful backup/export (see wiring).

## Wiring the lead must add

1. Backup timestamp. In the code path that downloads or saves a backup
   (`src/lib/backup.ts` caller, for example the Settings export handler):

```ts
import { recordBackup } from '../lib/notifications';
// ...after the file was written successfully
recordBackup();
```

2. Shell (`src/layouts/DashboardLayout.tsx`). Mount once, inside the router:

```tsx
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CommandPalette, type PaletteAction } from '../components/command/CommandPalette';
import { ShortcutsOverlay } from '../components/command/ShortcutsOverlay';
import { NotificationBell } from '../components/command/NotificationBell';
import { useHotkeys } from '../hooks/useHotkeys';

const navigate = useNavigate();
const [paletteOpen, setPaletteOpen] = useState(false);
const [helpOpen, setHelpOpen] = useState(false);

useHotkeys({
  'mod+k': () => setPaletteOpen(true),
  '/': () => setPaletteOpen(true),
  '?': () => setHelpOpen(true),
  'g d': () => navigate('/'),
  'g i': () => navigate('/invoice'),
  'g t': () => navigate('/transactions'),
  'g c': () => navigate('/clients'),
  'g s': () => navigate('/settings'),
});

const actions = useMemo<PaletteAction[]>(() => [
  { id: 'new-invoice', title: 'New invoice', keywords: ['create', 'bill'], run: () => navigate('/invoice') },
  { id: 'new-quotation', title: 'New quotation', keywords: ['estimate'], run: () => navigate('/invoice?type=QUOTATION') },
  { id: 'add-client', title: 'Add client', run: () => navigate('/clients?new=1') },
  { id: 'record-payment', title: 'Record payment…', keywords: ['receipt'], run: () => navigate('/transactions') },
  { id: 'settings', title: 'Go to Settings', run: () => navigate('/settings') },
  { id: 'theme', title: 'Toggle theme', keywords: ['dark', 'light'], run: toggleTheme },
  { id: 'lock', title: 'Lock app', run: handleLogout },
  { id: 'backup', title: 'Download backup', keywords: ['export'], run: downloadBackup },
], [navigate]);

<NotificationBell onNavigate={navigate} />
<CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)}
  navItems={navItems.map(n => ({ label: n.label, to: n.to ?? n.path, icon: n.icon }))}
  actions={actions} onNavigate={navigate} />
<ShortcutsOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
```

The query-string routes above (`?type=QUOTATION`, `?new=1`) are suggestions;
point them at whatever the quotation and client modules expose. Optionally add a
visible search button that calls `setPaletteOpen(true)` with a `Search` icon and a
`formatCombo('mod+k')` hint, and a "Keyboard shortcuts" link calling `setHelpOpen(true)`.

3. Other modules can add notices without touching this module:

```ts
import { registerNotificationProvider } from '../lib/notifications';
const off = registerNotificationProvider((ctx) => [/* AppNotification[] */]);
```

4. Cross-links: clicking a client search result opens `/clients`; an invoice
   result opens `/invoice/:id`. If a client detail route is added later, change
   the `href` in `searchAll` (clients branch).

## Accessibility

Palette: `role="dialog"` with an `aria-modal` label, input `role="combobox"` with
`aria-controls` and `aria-activedescendant`, `role="listbox"` containing labelled
`role="group"` sections of `role="option"` rows, a polite live region for result
counts, Tab trap, Esc closes, focus restored to the opener. The bell is a
disclosure button with a labelled popover (Esc closes, outside click closes).
All colours come from design tokens, so dark mode follows automatically.
