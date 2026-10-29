# Mr. Chartist type system

Version 2, 29 October 2026. One type system for every Mr. Chartist site: mrchartist.com, NISMExams, IPO Decode, the FII/DII data site and any site added later. This file is complete on its own. A developer or an AI agent can apply it to a site with nothing else.

---

## Summary (read this first)

**Goal.** Text that is familiar and easy to read, in the style of the AI and SaaS sites people already use. Calm weights, clear numbers, nothing loud.

**Three fonts, one job each. Never a fourth.** We use them under Chartist names.

| Chartist name | Made from | Job | Weights used |
|---|---|---|---|
| Chartist Sans | Plus Jakarta Sans (Tokotype) | Headings | 600 only |
| Chartist Sans Flex | Google Sans Flex (Google) | Everything you read or click: text, menus, labels, buttons, numbers, dashboards | 350 to 600 |
| Chartist Serif | Instrument Serif (Instrument), italic | One accent word in the page headline, in the brand wine colour | 400 italic |

**Licence.** All three fonts are under the SIL Open Font License 1.1 and stay under it: keep each original copyright notice and `OFL.txt` beside the font file, mark our copies as modified by Mr. Chartist, never sell the fonts on their own. The type system and tokens are © 2026 Mr. Chartist for all Mr. Chartist sites; the code snippets are MIT. Full text in `docs/theme/type/LICENSE.md` and in section 1.4.

**Weight map.** Reading text 400. Interface text (menus, lists, buttons) 400 to 500. Labels 500. Numbers and dashboards 350. Headings 600. Nothing on any site is heavier than 600.

**Number rules.** Tabular figures in tables and dashboards. No separators: write 10948210 and ₹49944.00, never 1,09,48,210. A plain zero, never the crossed zero. A true minus sign (−). Fixed decimals: prices 2, percentages 2, counts 0.

**Writing rule.** No em dashes (the long dash, U+2014) in visible text.

**Readability floor.** No text below 12px. Body text at least 16px. Lesson lines 60 to 75 characters. Every text colour at least 4.5:1 contrast. Nothing breaks at 200% zoom.

**Speed.** Self-host the fonts, preload the text font, and use a size-matched fallback so nothing jumps while fonts load.

**To apply it:** follow the 11 steps in "Implementation to-do list", then tick the "Done when" checklist at the end.

---

## 1. The fonts

### 1.1 Chartist Sans, from Plus Jakarta Sans (headings)

- Job: every heading (h1 to h4, card titles that act as headings, the hero headline).
- Weight: 600 only. Declare a single face at 600 so any rule asking for 700, 800 or 900 still draws 600.
- Source: Google Fonts repository, `https://github.com/google/fonts/tree/main/ofl/plusjakartasans`, file `PlusJakartaSans[wght].ttf`.
- Licence: SIL Open Font License 1.1, `OFL.txt` in the same folder. Copyright 2020 The Plus Jakarta Sans Project Authors. No Reserved Font Name.
- Never set running text in Chartist Sans.

### 1.2 Chartist Sans Flex, from Google Sans Flex (text, interface, numbers)

- Job: everything that is not a heading or the one accent word.
- Weights: 350 to 600. Optical size on (the browser sets it from the text size).
- Source: `https://github.com/google/fonts/tree/main/ofl/googlesansflex`, file `GoogleSansFlex[ROND,opsz,slnt,wdth,wght].ttf`.
- Licence: SIL Open Font License 1.1, `OFL.txt` in the same folder. Copyright 2015 The Google Sans Flex Authors. No Reserved Font Name.
- Size adjust: Google Sans Flex has shorter small letters than most sans faces (x-height 0.510 of the size). Declare it with `size-adjust: 107%` so 17px reads like 17px of a typical sans and existing layouts keep their line lengths.
- Missing symbols: Google Sans Flex has no arrows (← ↑ → ↓ ↗ ↘), no tick (✓), no bullet (●), no dagger (†) and no primes (′ ″). If a site uses them, add a small cut of Inter that holds only those characters, under the same family name with a `unicode-range` (see step 2). Inter is OFL 1.1 with no Reserved Font Name: `https://github.com/rsms/inter`.
- What the font does not have: there is no grade (GRAD) axis in Google's release, and no alternate I or l. Dark mode uses a small weight step instead of grade (see the weight map).

### 1.3 Chartist Serif, from Instrument Serif (one accent word)

- Job: one word or short phrase in the page headline, italic, in the brand wine colour (`#9B255C` on light, `#E66EA3` on dark), on a clear glass pane. Once per page.
- Weight: 400 italic only. Never bold.
- Source: `https://github.com/google/fonts/tree/main/ofl/instrumentserif`, file `InstrumentSerif-Italic.ttf`.
- Licence: SIL Open Font License 1.1, `OFL.txt`. Copyright 2022 The Instrument Serif Project Authors. No Reserved Font Name.

### 1.4 Licences

**Fonts: SIL Open Font License 1.1.**

- None of the original fonts declares a Reserved Font Name (checked 29 October 2026 in each OFL.txt), so the Chartist names are allowed.
- Every font file keeps its original copyright notice, and the original `OFL.txt` ships beside it (for example `public/fonts/chartist-sans-flex/OFL.txt`).
- Our copies carry the Chartist family name and this line in the font's description: "Modified by Mr. Chartist (subset and renamed), 2026. Original: <original name> by <original authors>, SIL Open Font License 1.1." Step 1 shows how.
- Our copies stay under the OFL. The fonts are never sold on their own.
- Credit line for each site's credits or about page: "Type: Chartist Sans Flex (from Google Sans Flex by Google), Chartist Sans (from Plus Jakarta Sans by Tokotype) and Chartist Serif (from Instrument Serif by Instrument), under the SIL Open Font License 1.1."

**The type system and tokens:** © 2026 Mr. Chartist, for use on all Mr. Chartist ecosystem sites.

**The code snippets in this file:** MIT License, © 2026 Mr. Chartist.

Full text: `docs/theme/type/LICENSE.md`.

---

## 2. The type scale

Every piece of text uses one of these steps. No other sizes, line heights or weights.

| Step | Font | Weight | Desktop size | Phone size | Line height | Tracking | Use |
|---|---|---|---|---|---|---|---|
| `display` | Chartist Sans | 600 | 64px | 40px | 1.04 | −0.035em | Page hero headline |
| `title-1` | Chartist Sans | 600 | 40px | 30px | 1.12 | −0.025em | Section heading (h2) |
| `title-2` | Chartist Sans | 600 | 26px | 22px | 1.2 | −0.02em | Sub heading (h3) |
| `title-3` | Chartist Sans Flex | 500 | 19px | 18px | 1.3 | 0 | Card title |
| `lead` | Chartist Sans Flex | 400 | 20px | 19px | 1.5 | 0 | Text under a heading |
| `body` | Chartist Sans Flex | 400 | 17px | 17px | 1.7 | 0 | Reading text |
| `ui` | Chartist Sans Flex | 400 | 15px | 18px | 1.25 | 0 | Menus, lists, fields (rows 38px desktop, 44px phone) |
| `small` | Chartist Sans Flex | 400 | 15px | 15px | 1.55 | 0 | Card text, notes |
| `label` | Chartist Sans Flex | 500 | 13px | 13px | 1.3 | 0 | Labels, eyebrows, chips (sentence case) |
| `caption` | Chartist Sans Flex | 400 | 12px | 12px | 1.45 | 0 | Captions, chart axes, fine print (the floor) |
| `num` | Chartist Sans Flex | 350 | inherits | inherits | inherits | 0 | Any figure, tabular |
| `num-hero` | Chartist Sans Flex | 350 | 40px | 32px | 1 | −0.01em | Big KPI figure |
| `table` | Chartist Sans Flex | 350 | 13.5px | 14px | 1.4 | 0 | Table and dashboard cells, tabular |
| `table-head` | Chartist Sans Flex | 400 | 12.5px | 13px | 1.3 | 0 | Table headers, 78% ink |
| `button` | Chartist Sans Flex | 500 | 16px | 16px | 1 | 0 | Buttons |

Notes:
- Phone sizes apply below 760px wide.
- Labels are in sentence case. If a site keeps capitals, use 12px or more and letter-spacing no wider than 0.02em, because Chartist Sans Flex capitals run wide.
- A figure inside a heading takes the heading's weight, so a number in a bold title stays as bold as the words around it.

---

## 3. Weight map, light and dark

| Role | Light | Dark | Why |
|---|---|---|---|
| Reading text | 400 | 380 | Light text on black looks bolder, so dark mode steps down 20 |
| Interface text | 400 | 400 | |
| Labels | 500 | 500 | |
| Numbers and dashboards | 350 | 350 | Checked readable at 12.5px on 1x, 2x and 3x screens |
| Headings | 600 | 600 | |
| Maximum anywhere | 600 | 600 | Declared in `@font-face`, so nothing can draw heavier |

The owner may choose a lighter reading setting later (proposed: 350 with −0.01em tracking, 370 on dark). Until then reading text is 400.

---

## 4. Number rules

1. **No separators.** Write numbers whole: `1248.60`, `10948210`, `₹49944.00`. No commas, no spaces, no dots between groups.
2. **Tabular figures** in tables, dashboards, prices and any column of numbers (`font-variant-numeric: tabular-nums`). Normal (proportional) figures inside sentences.
3. **Plain zero.** Never turn on the font's slashed zero (`"zero"` feature or `slashed-zero`).
4. **True minus.** Negative numbers use the minus sign U+2212 (−), not a hyphen: `−2.35%`, `−₹1235.40`.
5. **Fixed decimals per context:** prices 2 (`1248.60`), percentages 2 (`2.35%`), counts 0 (`10948210`), crores and lakhs as the source gives them (`₹49.6 tn`, `1021.4 mn`).
6. **Rupee sign** directly before the number with no space: `₹1248.60`. A sign goes before the rupee sign: `−₹1235.40`, `+₹10514 Cr`. Units follow with one space: `₹10514 Cr`.
7. **Right-align** number columns.

---

## 5. Writing rules

- No em dashes (the long dash, U+2014) in visible text. Use a comma, a colon, a full stop or brackets. A range uses "to" (`10 to 20`) or an en dash only inside a number range in a table (`2019–2026`).
- Sentence case for labels, buttons and headings.

---

## 6. Readability

- Nothing below 12px, anywhere: labels, captions, chart axes, table headers, badges, on phone and desktop.
- Body text at least 16px (reading text is 17px).
- Lesson and article lines 60 to 75 characters (`max-width: 66ch` on the text column), line height 1.6 to 1.7.
- Contrast at least 4.5:1 for every text colour, in both themes. Measured on white and black grounds: full ink 19.7:1, 86% ink 13.8:1, 64% ink 6.0:1, gain green `#1F7F37` 5.1:1, loss red `#D70015` 5.4:1 (light); gain `#30D158` 10.4:1, loss `#FF6961` 7.4:1 (dark). 55% ink on white fails (4.4:1): secondary text never goes below 64% ink.
- Nothing breaks or overlaps at 200% browser zoom.

---

## 7. Speed

- Self-host the fonts as `woff2`, subset to Latin plus ₹ (U+20B9).
- Preload the text font (Chartist Sans Flex) and the heading font (Chartist Sans).
- Use `font-display: swap` with a size-matched fallback (step 2), so text does not shift when the fonts arrive.
- Load only the weights in the map. Chartist Serif: italic only.

---

## Implementation to-do list

Work through the steps in order. Each step says what to change and how to check it.

### Step 1. Add the font files and licences

What to do:

```bash
mkdir -p public/fonts/chartist-sans-flex public/fonts/chartist-sans public/fonts/chartist-serif
curl -L -o /tmp/gsf.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/googlesansflex/GoogleSansFlex%5BROND%2Copsz%2Cslnt%2Cwdth%2Cwght%5D.ttf"
curl -L -o public/fonts/chartist-sans-flex/OFL.txt https://raw.githubusercontent.com/google/fonts/main/ofl/googlesansflex/OFL.txt
curl -L -o /tmp/pjs.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/plusjakartasans/PlusJakartaSans%5Bwght%5D.ttf"
curl -L -o public/fonts/chartist-sans/OFL.txt https://raw.githubusercontent.com/google/fonts/main/ofl/plusjakartasans/OFL.txt
curl -L -o /tmp/is-italic.ttf https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentserif/InstrumentSerif-Italic.ttf
curl -L -o public/fonts/chartist-serif/OFL.txt https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentserif/OFL.txt
```

Subset to Latin plus ₹ and keep only the axes in use (needs Python with `fonttools` and `brotli`: `pip install fonttools brotli`):

```bash
# Chartist Sans Flex (from Google Sans Flex): weight 300 to 600, optical size 12 to 32; roundness, slant and width fixed
fonttools varLib.instancer /tmp/gsf.ttf ROND=0 slnt=0 wdth=100 wght=300:600 opsz=12:32 -o /tmp/gsf-cut.ttf
pyftsubset /tmp/gsf-cut.ttf --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+20B9,U+2122,U+2212" \
  --layout-features='*' --flavor=woff2 --output-file=public/fonts/chartist-sans-flex/chartist-sans-flex.woff2
# Chartist Sans (from Plus Jakarta Sans): weight 600 only is used, keep 400 to 600 for safety
fonttools varLib.instancer /tmp/pjs.ttf wght=400:600 -o /tmp/pjs-cut.ttf
pyftsubset /tmp/pjs-cut.ttf --unicodes="U+0000-00FF,U+2000-206F,U+20B9,U+2190-2199,U+2212" --layout-features='*' --flavor=woff2 \
  --output-file=public/fonts/chartist-sans/chartist-sans.woff2
# Chartist Serif (from Instrument Serif), italic
pyftsubset /tmp/is-italic.ttf --unicodes="U+0000-00FF,U+2000-206F,U+20B9" --layout-features='*' --flavor=woff2 \
  --output-file=public/fonts/chartist-serif/chartist-serif-italic.woff2
```


Rename each subset to its Chartist name and mark it as modified (the OFL allows this because none of the fonts reserves its name):

```bash
cat > /tmp/chartist-rename.py <<'PY'
import sys
from fontTools.ttLib import TTFont
path, family, original, authors = sys.argv[1:5]
f = TTFont(path)
name = f["name"]
style = name.getDebugName(2) or "Regular"
note = f"Modified by Mr. Chartist (subset and renamed), 2026. Original: {original} by {authors}, SIL Open Font License 1.1."
for rec in list(name.names):
    if rec.nameID in (1, 3, 4, 6, 16, 21, 25):   # family, unique ID, full name, PostScript name, typographic family, WWS family, variations prefix
        name.removeNames(nameID=rec.nameID)
ps = family.replace(" ", "")
name.setName(family, 1, 3, 1, 0x409); name.setName(family, 16, 3, 1, 0x409)
name.setName(f"{family} {style}", 4, 3, 1, 0x409); name.setName(f"{ps}-{style}".replace(" ", ""), 6, 3, 1, 0x409)
name.setName(f"{ps};MrChartist;2026", 3, 3, 1, 0x409)
name.setName(note, 10, 3, 1, 0x409)               # description; the copyright (ID 0) and licence (IDs 13, 14) are kept as they are
f.save(path)
PY
python3 /tmp/chartist-rename.py public/fonts/chartist-sans-flex/chartist-sans-flex.woff2 "Chartist Sans Flex" "Google Sans Flex" "The Google Sans Flex Authors"
python3 /tmp/chartist-rename.py public/fonts/chartist-sans/chartist-sans.woff2 "Chartist Sans" "Plus Jakarta Sans" "The Plus Jakarta Sans Project Authors"
python3 /tmp/chartist-rename.py public/fonts/chartist-serif/chartist-serif-italic.woff2 "Chartist Serif" "Instrument Serif" "The Instrument Serif Project Authors"
```

Check: `ls public/fonts/*/` shows a `.woff2` and an `OFL.txt` in each folder (the Chartist Sans Flex file is about 100 to 120 KB), and
`python3 -c "from fontTools.ttLib import TTFont; n=TTFont('public/fonts/chartist-sans-flex/chartist-sans-flex.woff2')['name']; print(n.getDebugName(1)); print(n.getDebugName(0)); print(n.getDebugName(10))"`
prints "Chartist Sans Flex", the original Google copyright and the "Modified by Mr. Chartist" line.

### Step 2. Add the @font-face rules, the preload and the fallback

Add to the global stylesheet, before anything else:

```css
/* Nothing on the site is heavier than 600, and the browser never fakes a bolder weight. */
:root { font-synthesis-weight: none; }

@font-face {
  font-family: 'Chartist Sans Flex';
  src: url('/fonts/google-sans-flex/chartist-sans-flex.woff2') format('woff2');
  font-weight: 300 600;
  font-style: normal;
  font-display: swap;
  size-adjust: 107%;
}
@font-face {
  font-family: 'Chartist Sans';
  src: url('/fonts/plus-jakarta/chartist-sans.woff2') format('woff2');
  font-weight: 600;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Chartist Serif';
  src: url('/fonts/instrument-serif/chartist-serif-italic.woff2') format('woff2');
  font-weight: 400;
  font-style: italic;
  font-display: swap;
}

/* Size-matched fallbacks: Arial drawn to the same width and line height, so nothing shifts while the fonts load. */
@font-face {
  font-family: 'Chartist Sans Flex Fallback';
  src: local('Arial'), local('ArialMT'), local('Liberation Sans');
  size-adjust: 109.4%;
  ascent-override: 94.5%;
  descent-override: 28%;
  line-gap-override: 0%;
}
@font-face {
  font-family: 'Chartist Sans Fallback';
  src: local('Arial Bold'), local('Arial-BoldMT'), local('Arial');
  size-adjust: 106.7%;
  ascent-override: 97.2%;
  descent-override: 20.8%;
  line-gap-override: 0%;
}
```

Add to the HTML `<head>`:

```html
<link rel="preload" href="/fonts/google-sans-flex/chartist-sans-flex.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/plus-jakarta/chartist-sans.woff2" as="font" type="font/woff2" crossorigin>
```

Check: open the site, then in the browser console run
`[...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight)`.
It lists Chartist Sans Flex (300 600) and Chartist Sans (600), and Chartist Serif once a page shows the accent word. In the Network panel, no font loads from fonts.googleapis.com.

### Step 3. Add the tokens and the Tailwind config

```css
:root {
  --font-heading: 'Chartist Sans', 'Chartist Sans Fallback', system-ui, sans-serif;
  --font-body: 'Chartist Sans Flex', 'Chartist Sans Flex Fallback', system-ui, sans-serif;
  --font-accent: 'Chartist Serif', Georgia, serif;

  --fw-body: 400; --fw-ui: 400; --fw-label: 500; --fw-num: 350; --fw-heading: 600;

  /* step: weight size/line-height family, and tracking */
  --t-display: var(--fw-heading) 64px/1.04 var(--font-heading);   --tk-display: -0.035em;
  --t-title-1: var(--fw-heading) 40px/1.12 var(--font-heading);   --tk-title-1: -0.025em;
  --t-title-2: var(--fw-heading) 26px/1.2 var(--font-heading);    --tk-title-2: -0.02em;
  --t-title-3: 500 19px/1.3 var(--font-body);
  --t-lead: var(--fw-body) 20px/1.5 var(--font-body);
  --t-body: var(--fw-body) 17px/1.7 var(--font-body);
  --t-ui: var(--fw-ui) 15px/1.25 var(--font-body);
  --t-small: var(--fw-body) 15px/1.55 var(--font-body);
  --t-label: var(--fw-label) 13px/1.3 var(--font-body);
  --t-caption: var(--fw-body) 12px/1.45 var(--font-body);
  --t-num-hero: var(--fw-num) 40px/1 var(--font-body);           --tk-num-hero: -0.01em;
  --t-table: var(--fw-num) 13.5px/1.4 var(--font-body);
  --t-table-head: var(--fw-ui) 12.5px/1.3 var(--font-body);
  --t-button: 500 16px/1 var(--font-body);
}
@media (max-width: 759px) {
  :root {
    --t-display: var(--fw-heading) 40px/1.08 var(--font-heading);
    --t-title-1: var(--fw-heading) 30px/1.12 var(--font-heading);
    --t-title-2: var(--fw-heading) 22px/1.2 var(--font-heading);
    --t-title-3: 500 18px/1.3 var(--font-body);
    --t-lead: var(--fw-body) 19px/1.5 var(--font-body);
    --t-ui: var(--fw-ui) 18px/1.25 var(--font-body);
    --t-num-hero: var(--fw-num) 32px/1 var(--font-body);
    --t-table: var(--fw-num) 14px/1.4 var(--font-body);
    --t-table-head: var(--fw-ui) 13px/1.3 var(--font-body);
  }
}
.dark { --fw-body: 380; }

body { font: var(--t-body); }
h1 { font: var(--t-display); letter-spacing: var(--tk-display); }
h2 { font: var(--t-title-1); letter-spacing: var(--tk-title-1); }
h3 { font: var(--t-title-2); letter-spacing: var(--tk-title-2); }
.accent { font-family: var(--font-accent); font-style: italic; font-weight: 400; }
table, .tabular, [data-numeric] { font-variant-numeric: tabular-nums; }
td { font: var(--t-table); }
th { font: var(--t-table-head); }
```

Tailwind (`tailwind.config.ts`, inside `theme.extend`):

```ts
fontFamily: {
  sans: ['Chartist Sans Flex', 'Chartist Sans Flex Fallback', 'system-ui', 'sans-serif'],
  display: ['Chartist Sans', 'Chartist Sans Fallback', 'system-ui', 'sans-serif'],
  accent: ['Chartist Serif', 'Georgia', 'serif'],
},
fontSize: {
  caption: ['12px', { lineHeight: '1.45' }],
  label: ['13px', { lineHeight: '1.3', fontWeight: '500' }],
  small: ['15px', { lineHeight: '1.55' }],
  ui: ['15px', { lineHeight: '1.25' }],
  body: ['17px', { lineHeight: '1.7' }],
  lead: ['20px', { lineHeight: '1.5' }],
  'title-3': ['19px', { lineHeight: '1.3', fontWeight: '500' }],
  'title-2': ['26px', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '600' }],
  'title-1': ['40px', { lineHeight: '1.12', letterSpacing: '-0.025em', fontWeight: '600' }],
  display: ['64px', { lineHeight: '1.04', letterSpacing: '-0.035em', fontWeight: '600' }],
},
fontWeight: { num: '350', normal: '400', medium: '500', semibold: '600' },
```

Check: a page renders with headings in Chartist Sans at 600 and text in Chartist Sans Flex. In the console, `getComputedStyle(document.body).fontFamily` starts with "Chartist Sans Flex".

### Step 4. Replace old families, sizes and weights with the tokens

Find what to replace (run from the project root; install ripgrep as `rg` if needed):

```bash
rg -n "font-family" src --glob '*.{css,scss}' | rg -v "var\(--font-"          # families not using the tokens
rg -n "Inter|Roboto|Poppins|Montserrat|Open Sans|Lato|DM Sans|Helvetica" src  # old font names
rg -n "font(-size)?:\s*[^;]*\b[0-9.]+px" src --glob '*.{css,scss}'            # raw pixel sizes
rg -n "font-weight:\s*(7|8|9)00|font-bold|font-extrabold|font-black" src      # weights above 600
rg -n "text-\[[0-9.]+px\]" src --glob '*.{tsx,jsx,ts,js,html}'                # Tailwind arbitrary sizes
rg -n "fonts.googleapis.com" .                                                # fonts loaded from Google
```

Change each hit to a step from the scale (`font: var(--t-…)` in CSS, or the Tailwind names). Remove old `@font-face` blocks and Google Fonts links for any other font.

Check: each search above returns nothing, or only lines you decided to keep on purpose (write the reason in a comment next to them).

### Step 5. Raise everything below 12px

```bash
rg -n "font-size:\s*([0-9]|1[01])(\.[0-9]+)?px|font:\s*[0-9]+\s+([0-9]|1[01])(\.[0-9]+)?px" src --glob '*.{css,scss}'
rg -n "text-\[(9|10|11)(\.[0-9]+)?px\]|text-\[0?\.[0-9]+rem\]|text-xs" src
```

Change every hit to `caption` (12px) or a larger step. Text inside SVG artwork that scales with its `viewBox` must also come out at 12px or more on screen at the smallest width it is shown.

Check: both searches return nothing, and in the browser console on each main page:
`[...document.querySelectorAll('body *')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 12).length` returns 0.

### Step 6. Apply the weight map, light and dark

- Reading text 400 (380 in dark), interface 400, labels 500, numbers 350, headings 600.
- The `@font-face` declarations in step 2 already cap every weight at 600.

Check: in the console, `getComputedStyle(document.querySelector('h1')).fontWeight` is 600, `getComputedStyle(document.querySelector('p')).fontWeight` is 400 (380 in dark), and a table cell is 350.

### Step 7. Apply the number rules

Add one shared helper and use it for every number on the site:

```ts
// src/lib/number-format.ts
const MINUS = "\u2212";
export type NumberKind = "price" | "percent" | "count";
const DECIMALS: Record<NumberKind, number> = { price: 2, percent: 2, count: 0 };

/** No separators, fixed decimals per kind, a true minus sign. */
export function formatNumber(value: number, kind: NumberKind = "count", decimals = DECIMALS[kind]): string {
  const s = new Intl.NumberFormat("en-IN", { useGrouping: false, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Math.abs(value));
  const sign = value < 0 ? MINUS : "";
  return kind === "percent" ? `${sign}${s}%` : `${sign}${s}`;
}
export const formatRupees = (value: number, decimals = 2) =>
  (value < 0 ? MINUS : "") + "₹" + formatNumber(Math.abs(value), "price", decimals);
```

Make every other number format follow the same rule, once, before the app renders:

```ts
// first lines of the app entry (main.tsx or index.js)
(() => {
  if (typeof window === "undefined") return;
  const orig = Number.prototype.toLocaleString;
  Number.prototype.toLocaleString = function (locale?: Intl.LocalesArgument, opts?: Intl.NumberFormatOptions) {
    return orig.call(this, locale, Object.assign({}, opts, { useGrouping: false }));
  };
  const OrigNF = Intl.NumberFormat;
  const Patched = function (locale?: Intl.LocalesArgument, opts?: Intl.NumberFormatOptions) {
    return new OrigNF(locale, Object.assign({}, opts, { useGrouping: false }));
  };
  Patched.prototype = OrigNF.prototype;
  Patched.supportedLocalesOf = OrigNF.supportedLocalesOf.bind(OrigNF);
  Intl.NumberFormat = Patched as unknown as typeof Intl.NumberFormat;
})();
```

Find the rest:

```bash
rg -n '\\B\(\?=\(\\d\{(2|3)\}\)\+' src                            # hand-written comma grouping
rg -n '"zero"\s*1|slashed-zero' src                              # crossed zero switched on
rg -n '[0-9],[0-9]{2,3}' src --glob '*.{ts,tsx,js,jsx,json,md,html}' # numbers typed with commas in content
rg -n '(^|[^0-9a-zA-Z])-[0-9]' src --glob '*.{json,md}'          # hyphen used as a minus in content
```

Remove the commas from typed numbers in content (only inside visible text: never in code, coordinates, dates or IDs). Turn on `tabular-nums` for tables and dashboards.

Check: on a page full of numbers, nothing shows `1,248` or `1 248`; negative values start with `−`; columns line up; the zero has no slash.

### Step 8. Remove em dashes from visible text

```bash
rg -n "—" src public --glob '*.{ts,tsx,js,jsx,json,md,html,mdx}'
```

Replace each em dash in visible text with a comma, a colon, a full stop or brackets. Comments in code may keep them.

Check: the search returns only code comments; in the console, `document.body.innerText.includes('—')` is false on every main page.

### Step 9. Readability and contrast

- Text column: `max-width: 66ch` on lesson and article text, line height 1.6 to 1.7.
- Body text 16px or more.
- Contrast: check every text colour against its ground in both themes with a contrast checker (for example the browser's DevTools colour picker) and keep 4.5:1 or more. Keep secondary text at 64% ink or more.
- Zoom the browser to 200% on phone and desktop widths.

Check: no text colour below 4.5:1; at 200% zoom nothing overlaps, nothing is cut off, and the page does not scroll sideways (except tables inside their own scroll box).

### Step 10. Add the lock-in tests

Add this test (Vitest shown; the same logic works in Jest). It fails the build if a font outside the three appears, if any text is set below 12px, or if any weight is above 600.

```ts
// src/test/type-system.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const files = (dir: string, out: string[] = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(css|scss|tsx|ts|jsx|js|html)$/.test(name)) out.push(p);
  }
  return out;
};
const ALLOWED = ["Chartist Sans", "Chartist Sans Flex", "Chartist Serif", "Chartist Sans Flex Fallback", "Chartist Sans Fallback", "system-ui", "sans-serif", "serif", "Georgia", "inherit", "-apple-system", "BlinkMacSystemFont", "Arial", "ArialMT", "Liberation Sans"];
const all = files("src").map((f) => [f, readFileSync(f, "utf8")] as const);

describe("type system", () => {
  it("uses only the three fonts", () => {
    const bad: string[] = [];
    for (const [f, s] of all) for (const m of s.matchAll(/font-family\s*:\s*([^;}{]+)/g)) {
      for (const fam of m[1].split(",").map((x) => x.trim().replace(/^['"]|['"]$/g, ""))) {
        if (fam && !fam.startsWith("var(") && !ALLOWED.includes(fam)) bad.push(`${f}: ${fam}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it("sets nothing below 12px", () => {
    const bad: string[] = [];
    for (const [f, s] of all) {
      for (const m of s.matchAll(/font-size\s*:\s*([0-9.]+)px|(?<![-\w])font\s*:\s*(?:[^;{}]*?\s)?([0-9.]+)px\s*(?:\/|\s)|text-\[([0-9.]+)px\]/g)) {
        const v = parseFloat(m[1] ?? m[2] ?? m[3]);
        if (v < 12) bad.push(`${f}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it("draws nothing heavier than 600", () => {
    const bad: string[] = [];
    for (const [f, s] of all) for (const m of s.matchAll(/font-weight\s*:\s*([0-9]{3})|(?<![-\w])font\s*:\s*([0-9]{3})\s/g)) {
      if (parseInt(m[1] ?? m[2], 10) > 600) bad.push(`${f}: ${m[0]}`);
    }
    expect(bad).toEqual([]);
  });
});
```

Check: `npx vitest run src/test/type-system.test.ts` passes. To prove it works, add `font-size: 10px` to any rule, run the test, see it fail, then remove it.

### Step 11. Final visual check

On a phone (375px wide) and a desktop (1280px wide), in light and dark, open the home page, one article or lesson, one page with a table or dashboard, and the menu.

Check, on each:
- Headings in Chartist Sans at 600; the one accent word in Chartist Serif italic.
- Text, menus and labels in Chartist Sans Flex; nothing looks bold or loud.
- No text smaller than 12px; body text 16px or more.
- Numbers line up, have no separators, use a true minus, and the zero is plain.
- No em dashes.
- Nothing shifts while the page loads; nothing scrolls sideways; nothing breaks at 200% zoom.

---

## Done when

- [ ] Each Chartist font's `.woff2` (renamed, marked as modified, original copyright kept) and `OFL.txt` are in `public/fonts/`, and the credit line is on the site.
- [ ] Only Chartist Sans, Chartist Sans Flex and Chartist Serif load, all self-hosted, with the text and heading fonts preloaded and size-matched fallbacks declared.
- [ ] Every text style uses a step from the type scale; no raw sizes or weights remain.
- [ ] Nothing is below 12px; body text is 16px or more; lesson lines are 60 to 75 characters.
- [ ] Weights follow the map: text 400 (380 dark), labels 500, numbers 350, headings 600, nothing above 600.
- [ ] Numbers have no separators, tabular figures in tables, a true minus, fixed decimals and a plain zero.
- [ ] No em dashes in visible text.
- [ ] Every text colour is 4.5:1 or more in both themes; nothing breaks at 200% zoom.
- [ ] `src/test/type-system.test.ts` is in place and passes.
- [ ] The final visual check passed on phone and desktop, in light and dark.

---

Source of truth: the Mr. Chartist type study (decisions and history) and `docs/theme/TYPE-SYSTEM.md` in the mrchartist.com repository.
