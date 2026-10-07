# QA: shell + settings

Tested in Chromium (Playwright) against the production build, at 1440/1024/768/390 wide, light and dark.

## Verified working
- Register, lock, unlock. Wrong PIN: the 5th wrong attempt starts a 30 s lockout. The countdown survives a reload. Forgot PIN: the button stays disabled until the phrase matches, then the wipe returns to the register screen.
- Command palette (Ctrl+K, `/`): focus goes to the input, arrows and Enter work, Esc restores focus. All 13 pages and the 5 actions tested navigate correctly. Invoice number search (`0003`) finds the invoice.
- Notification bell: snooze, dismiss and mark read persist across a reload. Esc closes it and returns focus to the bell.
- Shortcuts overlay and Help modal: Esc closes them, Tab stays inside them, focus returns to the opener.
- Theme: persists, the `dark` class is set before first paint, and the theme-color meta follows.
- Settings validation toasts for GSTIN, PAN, IFSC and UPI. Logo upload: a PNG works, and a >3 MB file, a corrupt file and a .txt file each show a message. Unsaved-changes bar, `beforeunload` guard, and profile add/delete/discard.
- Backup download, wipe, restore: invoices, clients and settings come back. The PIN is not in the backup and is kept on wipe (the UI says "Your PIN stays").
- Encrypted backup: a wrong passphrase shows an error, and the right passphrase proceeds to the restore confirmation. Auto-backup panel shows "Not connected" with no folder in Chromium.

## Defects found and fixed
1. The mobile drawer was focusable while closed and had no trap, no Esc, and no scroll lock. It is now `inert` when closed. It has a focus trap, Esc closes it, focus returns to the opener, and scroll is locked. The menu and icon buttons are 44 px on mobile.
2. The sidebar hid Exports, Design studio and Settings at 700 px tall. It now compacts under 820 px and 740 px tall, so the nav no longer needs to scroll (it overflowed by 16 px at 700 px tall before the second step).
3. `useTheme` kept separate state per component. Changing the theme in Settings left the top-bar icon stale. It is now a shared `useSyncExternalStore`.
4. The theme-color meta was dark in light mode before React mounted. `index.html` now sets it.
5. There was no skip link. Added "Skip to content", and `<main>` is now focusable.
6. The unknown-route catch-all silently redirected to `/`. It now shows a NotFound page.
7. The Settings tabs had no tabpanel and no arrow-key support. Added `aria-controls`, a tabpanel, roving tabindex, and Arrow/Home/End keys. Tabs are 40 px tall.
8. Added a Duplicate profile button. You asked to verify duplicate, and it did not exist.
9. The file inputs for logo and signature had no label. Added `aria-label`s. A corrupt image now shows a friendly message instead of a raw DOMException.
10. The unsaved-changes bar put Save under the bottom-right toast, so the toast hid the button. The actions now sit on the left.
11. "Back up now" and storage notifications opened Settings on the Business tab. They now open `/settings?tab=data`. Settings reads `?tab=`.
12. The command palette input drew a double focus box. Fixed.
13. The shortcuts overlay called Invoices "Transactions". It also said Ctrl+P prints, but it opens the preview. Labels fixed.
14. Smaller fixes:
    - The "Lock after inactivity" icon sat above its label.
    - The "Default profile" tag icon sat above its text.
    - The round-off checkbox sat misaligned in Defaults.
    - The unread notification tint was too heavy, so it is now subtle with an accent bar.
    - The login title read "Welcome back, " with a blank name.
    - `aria-describedby` on the login PIN pointed at a missing id.
    - Notification buttons are 40 px on touch devices.

## Found but not fixed (outside my ownership)
- `lib/search`: invoice results show the total unformatted (`₹29500`).
- The Dashboard "Payments to chase" card header stacks its icon above the title (global `svg{display:block}`). The same pattern may appear elsewhere.
- `ui/Toast` is fixed bottom-right and can cover page-level action bars on mobile.
- Dashboard bar-chart grid lines look odd on empty months.

## Not verified (time)
- Design Studio: the page loads and I reviewed its screenshot, but I did not exercise every control, the paper-size `page.pdf()` page counts, or saving per profile.
- PWA offline and the update toast, the ErrorBoundary recovery screen, print stylesheet emulation, and the full keyboard-only audit of other pages.
- Idle lock.

## Visual changes
Compact sidebar on short windows, NotFound page, subtler unread notifications, the corrected icon alignments above, and a cleaner save bar.
