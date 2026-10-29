# Mr Chartist button system

_29 Oct 2026. The rulebook for every button on mrchartist.com and the ecosystem sites. Read it before you add, change or
style anything a person can press. It is written as instructions: follow them as they stand._

Code: `src/styles/buttons.css` (every rule), `src/components/ui/Button.tsx` (React). Spec page: `docs/theme/buttons.html`.

## The prompt

> Every pressable thing on the site is one of the kinds below, drawn by `buttons.css`. Never hand-style a button with your
> own background, border, radius or shadow. Pick the kind, the intent and the size; the shape, the finish, the states and
> the motion come with it. Buttons are pure black and pure white, with iOS glass: a sheen from the top, a crisp rim, a short
> soft shadow. Only Buy and Sell are coloured. A small button is a capsule; a rounded rectangle is used only where the place
> asks for one. Hover fades, a press settles and springs back, and nothing ever lifts or slides. Every label reads at
> 4.5:1, every target is 44px, and every edge is drawn once.

## 1. Pick the kind

| Kind | Class / component | Use it for | Never for |
|---|---|---|---|
| Button | `.btn` / `<Button>` | An action (`<button>`) or a destination (`asChild` with `<Link>` or `<a>`) | Plain text links |
| Connected bar | `.join` around `.btn`s | Two or three actions that belong together (Investology, search and theme; Buy and Sell; a guide and its GitHub page) | Choices that replace each other |
| Segmented control | `.seg` / `SegmentedControl` | Choices that replace each other (filters, views), with their counts inside | Independent tags |
| Chip | `.chip` | Independent filters or tags that can each be on or off | Actions |
| Icon button | `.btn.icon` / `.btn.round` | One icon with an `aria-label` (search, theme, close, share) | Anything with a word |
| Link | `.lk` | A destination inside text or under a card | Anything that should look pressable |

A choice between two to seven things that replace each other is one connected `.seg`, never separate chips. Seven or
fewer items never need a search field.

## 2. Pick the intent (six only)

| Intent | Looks | Use it for |
|---|---|---|
| `primary` | The ink: pure black on light, pure white on dark | The one main action of a section |
| `secondary` | The page colour (pure white on light, pure black on dark) with a hairline | Every other action; the default |
| `quiet` | No fill until hover | Toolbars, dismiss, low-stakes actions |
| `glass` | Translucent glass | The one control floating over a picture or a chart |
| `buy` | Gain green, white label on light, black on dark | The trade decision: buy |
| `sell` | Loss red, white label on light, black on dark | The trade decision: sell |

No wine, gold, tint or any other colour on a button, ever. A button that names a company's platform (GitHub, Amazon,
Flipkart, YouTube, X, Claude) leads with that company's mark (`BrandMark`); never a mark for a stock or listed company.

## 3. Pick the size

| Size | Height | Label | Icon | Rectangle radius |
|---|---|---|---|---|
| `xs` | 30px | 12.5px | 14px | 6px |
| `sm` | 36px | 13px | 16px | 8px |
| default | 44px | 14px | 16px | 10px |
| `lg` | 52px | 15px | 16px | 12px |
| `xl` | 64px | 17px | 20px | 14px |
| `stack` | 64px tile | 12.5px | 16px | 16px |

Every size still reaches a 44px touch target (an invisible area outside the painted edge). Labels are Chartist Sans Flex
at 600, the same in every size.

## 4. The shape follows the need

- **A capsule by default,** however long the label. A small button inside a long card or a long bar stays a capsule
  ("Create a free account" in the access card is a capsule).
- **A rounded rectangle only where the place asks for one:**
  - the big ones: `lg` and `xl` (hero calls to action, book buy buttons);
  - a full-width button: `full`;
  - a button set beside an input or a rectangle search bar: `rect`, so the corners match the field;
  - a connected bar that is long, by asking for it: `.join.rect` (the header's Investology, search and theme bar);
  - the footer's author button (`rect`), with the photo as a rounded square inside (inner radius = outer radius minus
    the 3px inset).
- **Never force a big button into a capsule, and never turn a small one into a rectangle because its label is long.**
- The header: the longer tools bar is a rounded rectangle; Sign in and the account button are capsules.
- Icon and round buttons are always circles. A connected bar is one shape: its ends follow the bar.
- The radius of a rectangle is 22% of the height (table above). Inner corners follow: inner = outer minus inset.

## 5. Connected buttons (`.join`)

- The halves sit edge to edge and overlap by exactly their 1px edge, so **every seam is one line**. Their highlight rims
  stop a full pixel short of the seams. Never give a half its own extra border or margin.
- The bar answers as one: hovering either half raises both; pressing either settles the whole bar to 98.5% and springs it
  back. A half never moves on its own.
- Halves keep their own width (`flex: none`) in the header; elsewhere they share the width evenly.
- A bar is a capsule unless it is `full`, holds `lg` halves, or asks for `rect`.
- Buy and Sell together: same height, same width, 8px apart; inside a `.join` they share one bar.

## 6. Finish: iOS glass

- `--fin: 1` (glass) is the default since 29 Oct 2026, to match the tinted-glass chips: a sheen across the top 46%, a
  crisp specular rim, a one-pixel inner shade along the base and a short soft shadow. The fill is always exactly black or
  exactly white; the glass is light laid on top, never a grey body.
- A wide button (`full`, `rect`) takes 60% of the finish, so a long bar never looks big and 3D. `lg` keeps all of it.
- Other finishes exist for special places: `data-finish="flat"`, `"soft"` (.5) or `"deep"` (2) on a container.

## 7. Motion

- **Hover fades:** the glass, the shadow, the edge and the label colour cross-fade over .15s. Nothing moves on hover.
- **A press settles and springs back:** the button eases to 97% in .1s and springs back over .4s with a 2% overshoot.
  `lg`, `xl` and `full` settle to 98.5%, so a wide bar never visibly shrinks. A connected bar settles as one piece.
- A segmented control's thumb slides to the chosen segment; holding it squeezes the thumb and letting go springs it back.
- Chips, choices, segments and cards never move. Nothing lifts, swells or slides on hover.
- `prefers-reduced-motion` and `data-motion="still"` make every answer instant.

## 8. High resolution

- Edges are 1px; on a 2x or 3x screen the highlight rim is half a pixel, a crisp line of light, never a grey frame.
- Line icons (`lucide`) are stroked at 2.1 on the 24 grid (about 1.4px at 16px) to match the 600 label.
- Icons sit at the size's icon width (table above), never scaled with `transform`.
- Labels never clip: `.trunc` keeps one line with an ellipsis (wrap the text in a span); otherwise labels balance.

## 9. States

| State | How it looks |
|---|---|
| Focus | A 2px ring in the button's own ink, drawn inside the shape. No outer ring anywhere. |
| Disabled | The fill stays pure; the label and edge dim. Buy and Sell dim as a whole. |
| Loading | The label gives way to a turning ring; the width does not change. |
| Pressed toggle | `aria-pressed="true"` draws the ink button. |
| Count | A small round number inside the button, in the button's ink, inverted. |

## 10. Code

```tsx
<Button>Save</Button>                                         {/* secondary, default size, capsule */}
<Button variant="primary" size="lg" asChild><Link to="/learn">Start learning</Link></Button>   {/* big: rectangle */}
<Button variant="secondary" size="sm" asChild><Link to="/about">The full story <ArrowRight /></Link></Button>
<Button variant="primary" full>Create account</Button>       {/* full width: rectangle */}
<div className="join rect"><Button>Investology</Button><Button size="icon" aria-label="Search"><Search /></Button></div>
<Button variant="buy">Buy</Button> <Button variant="sell">Sell</Button>
```

## 11. Never

- Hand-styled buttons: your own background, border, radius, shadow, gradient, hover lift or colour.
- A button in wine, gold or a tint; a thick coloured edge; an outer focus ring.
- A rectangle for a small button because its label is long; a capsule forced on a big one.
- A filled chip or pill behind a price or percentage change (figures are plain coloured text).
- Two borders at a seam, or a margin between connected halves.
- Hover that moves, grows or lifts anything.

## 12. Before you ship

1. Every pressable thing is one of the kinds in section 1.
2. Shapes follow section 4; no rectangle without a reason from that list.
3. Labels read at 4.5:1; targets reach 44px; the focus ring shows inside the shape.
4. Connected bars show one line per seam in light and dark, at 1x and 3x.
5. Look at it on a real page, light and dark, desktop and phone, before it is pushed.

---

© 2026 Mr Chartist (Investology). All rights reserved. Not open source; for the Mr Chartist ecosystem's own sites only.
